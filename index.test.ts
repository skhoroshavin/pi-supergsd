import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  createAutoCommand,
} from './index.js';

// ── Registration ─────────────────────────────────────────────────

describe('registration', () => {
  it('registers the push-task tool and all five task commands', () => {
    const registered: Array<{ type: string; name: string; description?: string }> = [];
    const pi = {
      registerTool: (tool: { name: string; label: string; description: string }) =>
        registered.push({ type: 'tool', name: tool.name, description: tool.description }),
      registerCommand: (name: string, opts: { description: string }) =>
        registered.push({ type: 'command', name, description: opts.description }),
      on: () => {},
    } as unknown as ExtensionAPI;

    registerTaskCommands(pi);

    assert.deepStrictEqual(registered, [
      { type: 'tool', name: 'push-task', description: 'Store a task prompt for a user-started navigation branch.' },
      { type: 'command', name: 'start-task', description: 'Navigate to a fresh context and inject the active task prompt' },
      { type: 'command', name: 'discard-task', description: 'Discard the active task without executing it' },
      { type: 'command', name: 'finish-task', description: 'Finish the current task and return to the task start point' },
      { type: 'command', name: 'abort-task', description: 'Abort the current task without finishing' },
      { type: 'command', name: 'auto', description: 'Automatically run pushed task branches' },
    ]);
  });
});

// ── Integration: /start-task ─────────────────────────────────────

describe('integration: /start-task fresh context', () => {
  it('completes /start-task → work → /finish-task with last-response injection', async () => {
    const { sm, sentMessages, sentCustomMessages, notifications, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working on main...'));

    await runPushTask('Analyze performance.');
    await runStartTask();

    assert.deepStrictEqual(sentMessages, ['Analyze performance.']);

    sm.appendMessage(assistantMessage('Found 3 bottlenecks: ...'));

    await runFinishTask();

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Found 3 bottlenecks: ...');

    assertLastNotification(notifications, 'info', 'Task finished. Last response attached.');
    assertNoActiveTask(sm);
  });
});

describe('integration: /start-task branch context', () => {
  it('completes /start-task branch → work → /finish-task with last-response injection', async () => {
    const { sm, sentMessages, sentCustomMessages, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working...'));

    await runPushTask('Quick fix.', 'branch');
    await runStartTask();

    assert.deepStrictEqual(sentMessages, ['Quick fix.']);

    sm.appendMessage(assistantMessage('Fixed the bug.'));

    await runFinishTask();

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Fixed the bug.');
  });
});

// ── Integration: /auto ───────────────────────────────────────────

describe('integration: /auto fresh context', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const { sm, sentCustomMessages, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working on main...'));

    await runPushTask('Analyze performance.');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();

    sm.appendMessage(assistantMessage('Found 3 bottlenecks: ...'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Found 3 bottlenecks: ...');
    assertNoActiveTask(sm);
  });
});

function assertNoActiveTask(sm: SessionManager): void {
  const task = getActiveTask(sm);
  assert.strictEqual(task, null, `Expected no active task, but found: ${JSON.stringify(task)}`);
}

describe('integration: /auto branch context', () => {
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { sm, sentCustomMessages, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendMessage(assistantMessage('working...'));

    await runPushTask('Quick fix.', 'branch');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();

    sm.appendMessage(assistantMessage('Fixed the bug.'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Fixed the bug.');
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const { sm, setCancelNextNav, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });

    await runPushTask('Analyze performance.');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;

    assert.strictEqual(countCustomEntries(sm, TASK_DONE_ENTRY_TYPE), 0);
    assert.ok(getActiveTask(sm), 'Expected an active task to remain.');
  });
});

function getActiveTask(sm: SessionManager): TaskShape | null {
  const branch = sm.getBranch();
  let skip = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (e.type === 'custom' && e.customType === 'task') {
      if (skip === 0) return e.data as TaskShape;
      skip--;
    }
  }
  return null;
}

// ── Assertion helpers ───────────────────────────────────────────

interface TaskShape { prompt: string; context?: string }

// ── createAutoCommand ────────────────────────────────────────────

describe('createAutoCommand', () => {
  it('waits when started with no task, then starts work after a later push-task', async () => {
    const { sm, sentMessages, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();

    await runPushTask('Review spec.');
    await releaseNextIdle();

    assert.deepStrictEqual(sentMessages, ['Review spec.']);

    sm.appendMessage(assistantMessage('Done.'));
    await releaseNextIdle();
    await releaseNextIdle();
    await running;
  });

  it('warns and returns when /auto is already running', async () => {
    const { pi, notifications, releaseNextIdle, flushMicrotasks, emitSessionShutdown, runAuto } =
      makeHarness();
    registerTaskCommands(pi);

    const firstRun = runAuto();
    await flushMicrotasks();

    await runAuto();
    assertLastNotification(notifications, 'warning', 'Auto is already running.');

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
  });

  it('stops instead of finishing the task when the last assistant message was aborted', async () => {
    const { sm, sentCustomMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    await runPushTask('Implement phase 1.', 'branch');
    await runStartTask();
    sm.appendMessage(abortedAssistantMessage('Stopped by user.'));

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;

    assert.strictEqual(sentCustomMessages.length, 0);
    assert.strictEqual(countCustomEntries(sm, TASK_DONE_ENTRY_TYPE), 0);
  });

  it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { sm, sentCustomMessages, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    await runPushTask('Quick fix.', 'branch');
    await runStartTask();
    sm.appendMessage(assistantMessage('Fixed the bug.'));

    let resolved = false;
    const running = runAuto().then(() => {
      resolved = true;
    });

    await flushMicrotasks();
    setPendingMessages(true);
    await releaseNextIdle();
    await releaseNextIdle();

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(resolved, false);

    setPendingMessages(false);
    await releaseNextIdle();
    await running;
    assert.strictEqual(resolved, true);
  });
});

const TASK_DONE_ENTRY_TYPE = 'task-done';

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const navigations: Array<{ targetId: string; opts?: unknown }> = [];
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  let cancelNextNav = false;
  let pendingMessages = false;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      sentMessages.push(text);
    },
    sendMessage(
      message: { customType: string; content: unknown; display?: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ) {
      sentCustomMessages.push({ customType: message.customType, content: message.content, options });
      sm.appendCustomMessageEntry(
        message.customType,
        message.content as string,
        message.display ?? true,
        message.details,
      );
    },
    on(eventName: string, handler: () => unknown) {
      if (eventName === 'session_shutdown') sessionShutdownHandlers.push(handler);
    },
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => pendingMessages,
    sessionManager: sm,
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    navigateTree: async (targetId: string, opts?: unknown) => {
      navigations.push({ targetId, opts });
      if (cancelNextNav) {
        cancelNextNav = false;
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  // ── Plumbing helpers ──────────────────────────────────────────

  async function releaseNextIdle() {
    const next = idleWaiters.shift();
    assert.ok(next, 'Expected a pending waitForIdle call.');
    next();
    // Drain microtasks so anything awaiting the released idle can proceed.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function emitSessionShutdown() {
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }
  }

  function setPendingMessages(value: boolean) {
    pendingMessages = value;
  }

  function setCancelNextNav(v: boolean) {
    cancelNextNav = v;
  }

  // ── Convenience wrappers (pre-bound to pi / ctx) ───────────────

  async function runPushTask(prompt: string, context?: 'fresh' | 'branch') {
    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
  }

  async function runStartTask() {
    const handlerP = createStartTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runFinishTask() {
    const handlerP = createFinishTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runDiscardTask() {
    const handlerP = createDiscardTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  async function runAbortTask() {
    const handlerP = createAbortTaskCommand(pi).handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  function runAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }

  return {
    sm,
    pi,
    ctx,
    sentMessages,
    sentCustomMessages,
    notifications,
    navigations,
    releaseNextIdle,
    flushMicrotasks,
    emitSessionShutdown,
    setPendingMessages,
    setCancelNextNav,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
}

function assistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
  } as AppendMessageInput;
}

function abortedAssistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
    stopReason: 'aborted',
  } as AppendMessageInput;
}

// ── Assistant message builders ───────────────────────────────────

type AppendMessageInput = Parameters<SessionManager['appendMessage']>[0];

function countCustomEntries(sm: SessionManager, customType: string): number {
  return sm
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
}

function assertLastNotification(
  notifications: Notification[],
  type?: string,
  expectedMessage?: string,
): Notification {
  const n = getLastNotification(notifications, type);
  assert.ok(n, `Expected notification${type ? ` of type '${type}'` : ''}, found none.`);
  if (expectedMessage !== undefined) {
    assert.strictEqual(n.message, expectedMessage);
  }
  return n;
}

function getLastNotification(
  notifications: Notification[],
  type?: string,
): Notification | null {
  for (let i = notifications.length - 1; i >= 0; i--) {
    if (type === undefined || notifications[i].type === type) {
      return notifications[i];
    }
  }
  return null;
}

interface Notification {
  message: string;
  type?: string;
}
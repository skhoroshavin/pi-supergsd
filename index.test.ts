import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  buildSessionContext,
} from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  createAutoCommand,
} from './index.js';

// ── Integration: /start-task ─────────────────────────────────────

describe('integration: /start-task fresh context', () => {
  it('completes /start-task → work → /finish-task with last-response injection', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    // Fresh context branches from the first visible entry, so 'main work' is included
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'Analyze performance.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Found 3 bottlenecks: ...');

    await runFinishTask();
    assert.deepStrictEqual(getLlmHistory(), [
      'main work',
      'working on main...',
      'Found 3 bottlenecks: ...',
    ]);
    assert.ok(isLlmTriggered());
    assert.ok(getLastHint()?.includes('Task finished'));
  });
});

describe('integration: /start-task branch context', () => {
  it('completes /start-task branch → work → /finish-task with last-response injection', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', 'branch');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Fixed the bug.');

    await runFinishTask();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
    assert.ok(isLlmTriggered());
    assert.ok(getLastHint()?.includes('Task finished'));
  });
});

// ── Integration: /auto ───────────────────────────────────────────

describe('integration: /auto fresh context', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'Analyze performance.']);

    appendAssistantMessage('Found 3 bottlenecks: ...');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assert.deepStrictEqual(getLlmHistory(), [
      'main work',
      'working on main...',
      'Found 3 bottlenecks: ...',
    ]);
    assert.ok(isLlmTriggered());
    assert.ok(getLastHint()?.includes('Task finished'));
  });
});

function assertNoActiveTask(sm: SessionManager): void {
  const task = getActiveTask(sm);
  assert.strictEqual(task, null, `Expected no active task, but found: ${JSON.stringify(task)}`);
}

describe('integration: /auto branch context', () => {
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', 'branch');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);

    appendAssistantMessage('Fixed the bug.');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
    assert.ok(isLlmTriggered());
    assert.ok(getLastHint()?.includes('Task finished'));
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const { appendUserMessage, getLlmHistory, isLlmTriggered, getLastHint, setCancelNextNav, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    setCancelNextNav(true);

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
    assert.deepStrictEqual(getLlmHistory(), ['main work']);
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

// ── discardTask ──────────────────────────────────────────────────

describe('discardTask', () => {
  it('discards a pending task without triggering the LLM', async () => {
    const { appendUserMessage, getLlmHistory, isLlmTriggered, getLastHint, runPushTask, runDiscardTask } =
      makeHarness();

    appendUserMessage('main work');
    await runPushTask('Quick fix.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runDiscardTask();
    assert.strictEqual(getLastHint(), 'Task discarded.');
    assert.ok(!isLlmTriggered());
    assert.deepStrictEqual(getLlmHistory(), ['main work']);
  });
});

// ── abortTask ───────────────────────────────────────────────────

describe('abortTask', () => {
  it('aborts an in-progress task and returns to the original branch', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, runPushTask, runStartTask, runAbortTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', 'branch');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Partial work...');

    await runAbortTask();
    assert.strictEqual(getLastHint(), 'Task aborted. Branch abandoned without summary.');
    assert.ok(!isLlmTriggered());
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...']);
  });
});

// ── createAutoCommand ────────────────────────────────────────────

describe('createAutoCommand', () => {
  it('waits when started with no task, then starts work after a later push-task', async () => {
    const { appendAssistantMessage, getLlmHistory, getLastHint, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();

    await runPushTask('Review spec.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await releaseNextIdle();
    assert.deepStrictEqual(getLlmHistory(), ['Review spec.']);

    appendAssistantMessage('Done.');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
  });

  it('warns and returns when /auto is already running', async () => {
    const { pi, getLastHint, releaseNextIdle, flushMicrotasks, emitSessionShutdown, runAuto } =
      makeHarness();
    registerTaskCommands(pi);

    const firstRun = runAuto();
    await flushMicrotasks();

    await runAuto();
    assert.strictEqual(getLastHint(), 'Auto is already running.');

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
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
  const triggeredCustomMessages = new Set<string>();
  const triggeredUserMessages = new Set<string>();
  let hints: Array<{ text: string }> = [];
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
      const branch = sm.getBranch();
      const last = branch[branch.length - 1];
      if (last) triggeredUserMessages.add(last.id);
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
      if (options?.triggerTurn) {
        const branch = sm.getBranch();
        const last = branch[branch.length - 1];
        if (last) triggeredCustomMessages.add(last.id);
      }
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
        hints.push({ text: message });
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

  function isLlmTriggered(): boolean {
    const branch = sm.getBranch();
    if (branch.length === 0) return false;
    // Walk backwards past 'custom' entries (data-only bookkeeping, invisible to LLM)
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === 'custom') continue;
      if (entry.type === 'message' && entry.message.role === 'user') return triggeredUserMessages.has(entry.id);
      if (entry.type === 'message' && entry.message.role === 'assistant') return false;
      if (entry.type === 'custom_message') return triggeredCustomMessages.has(entry.id);
      return false;
    }
    return false;
  }

  function appendUserMessage(text: string): void {
    sm.appendMessage({ role: 'user', content: text, timestamp: 0 });
  }

  function appendAssistantMessage(text: string): void {
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: 0,
      model: 'test',
      provider: 'test',
    });
  }

  function getLastHint(): string | undefined {
    if (hints.length === 0) return undefined;
    const last = hints[hints.length - 1];
    hints = [];
    return last.text;
  }

  function getLlmHistory(): string[] {
    const ctx = buildSessionContext(sm.getEntries(), sm.getLeafId());
    return ctx.messages.map(m => {
      if (typeof m.content === 'string') return m.content;
      if (!Array.isArray(m.content)) return '';
      return m.content
        .filter((b): b is { type: 'text'; text: string } =>
          typeof b === 'object' && b !== null && 'type' in b && b.type === 'text'
        )
        .map(b => b.text)
        .join('');
    });
  }

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
    const result = await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
    const content = result.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? (content[0] as { text: string })?.text ?? ''
        : '';
    if (text) hints.push({ text });
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
    getLlmHistory,
    isLlmTriggered,
    getLastHint,
    appendUserMessage,
    appendAssistantMessage,
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
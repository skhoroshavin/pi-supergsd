import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  buildSessionContext,
  type Theme,
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
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getStatus(), 'pending task: analyze-performance');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: analyze-performance');
    // Fresh context branches from the first visible entry, so 'main work' is included
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'Analyze performance.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Found 3 bottlenecks: ...');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
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
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getStatus(), 'pending task: quick-fix');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: quick-fix');
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Fixed the bug.');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
    assert.ok(isLlmTriggered());
    assert.ok(getLastHint()?.includes('Task finished'));
  });
});

// ── Integration: /auto ───────────────────────────────────────────

describe('integration: /auto fresh context', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getStatus(), 'pending task: analyze-performance');
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

describe('integration: /auto branch context', () => {
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, runAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getStatus(), 'pending task: quick-fix');
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

// ── Registration ─────────────────────────────────────────────────

describe('registration', () => {
  it('registers the push-task tool and all five task commands', () => {
    const registered: Array<{ type: string; name: string; description?: string }> = [];
    const pi = {
      registerTool: (tool: { name: string; label: string; description: string }) =>
        registered.push({ type: 'tool', name: tool.name, description: tool.description }),
      registerCommand: (name: string, opts: { description: string }) =>
        registered.push({ type: 'command', name, description: opts.description }),
      registerMessageRenderer: () => {},
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

// ── discardTask ──────────────────────────────────────────────────

describe('discardTask', () => {
  it('discards a pending task without triggering the LLM', async () => {
    const { appendUserMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, runPushTask, runDiscardTask } =
      makeHarness();

    appendUserMessage('main work');
    await runPushTask('Quick fix.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runDiscardTask();
    assert.strictEqual(getStatus(), undefined);
    assert.strictEqual(getLastHint(), 'Task discarded.');
    assert.ok(!isLlmTriggered());
    assert.deepStrictEqual(getLlmHistory(), ['main work']);
  });
});

// ── abortTask ───────────────────────────────────────────────────

describe('abortTask', () => {
  it('aborts an in-progress task and returns to the original branch', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, getStatus, runPushTask, runStartTask, runAbortTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
    assert.ok(isLlmTriggered());
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Partial work...');

    await runAbortTask();
    assert.strictEqual(getStatus(), undefined);
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
    const { getLastHint, releaseNextIdle, flushMicrotasks, emitSessionShutdown, runAuto } =
      makeHarness();

    const firstRun = runAuto();
    await flushMicrotasks();

    await runAuto();
    assert.strictEqual(getLastHint(), 'Auto is already running.');

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
  });

  it('stops when the last assistant message was aborted', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, getLastHint, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Implement phase 1.', true);
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Stopped by user.', 'aborted');

    const running = runAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
  });

  it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, getLastHint, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.strictEqual(getLastHint(), undefined);

    appendAssistantMessage('Fixed the bug.');

    let resolved = false;
    const running = runAuto().then(() => {
      resolved = true;
    });

    await flushMicrotasks();
    setPendingMessages(true);
    await releaseNextIdle();
    await releaseNextIdle();
    assert.ok(isLlmTriggered());
    assert.strictEqual(resolved, false);

    setPendingMessages(false);
    await releaseNextIdle();
    await running;
    assert.strictEqual(resolved, true);
  });
});

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  const idleWaiters: Array<() => void> = [];
  const sessionShutdownHandlers: Array<() => unknown> = [];
  const triggeredCustomMessages = new Set<string>();
  const triggeredUserMessages = new Set<string>();
  const hints: Array<{ text: string }> = [];
  let cancelNextNav = false;
  let pendingMessages = false;
  let taskStatus: string | undefined;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      const branch = sm.getBranch();
      const last = branch[branch.length - 1];
      if (last) triggeredUserMessages.add(last.id);
    },
    sendMessage(
      message: { customType: string; content: unknown; display?: boolean; details?: unknown },
      options?: { triggerTurn?: boolean },
    ) {
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
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  const ctx = {
    hasUI: true,
    waitForIdle: async () => {
      await new Promise<void>((resolve) => {
        idleWaiters.push(resolve);
      });
    },
    hasPendingMessages: () => pendingMessages,
    sessionManager: sm,
    ui: {
      notify(message: string) {
        hints.push({ text: message });
      },
      setStatus(key: string, value: string | undefined) {
        if (key === 'task') taskStatus = value;
      },
      theme: {
        fg: (_key: string, text: string) => text,
        bg: (_key: string, text: string) => text,
        bold: (text: string) => text,
      } as unknown as Theme,
    },
    navigateTree: async (targetId: string) => {
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

  function appendAssistantMessage(text: string, stopReason?: string): void {
    sm.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: 0,
      model: 'test',
      provider: 'test',
      ...(stopReason ? { stopReason } : {}),
    } as Parameters<typeof sm.appendMessage>[0]);
  }

  function getLastHint(): string | undefined {
    if (hints.length === 0) return undefined;
    const last = hints[hints.length - 1];
    hints.length = 0;
    return last.text;
  }

  function getLlmHistory(): string[] {
    const ctx = buildSessionContext(sm.getEntries(), sm.getLeafId());
    return ctx.messages.map(m => {
      const msg = m as { content?: string | Array<{ type: string; text?: string }> };
      if (typeof msg.content === 'string') return msg.content;
      if (!Array.isArray(msg.content)) return '';
      return msg.content
        .filter((b): b is { type: 'text'; text: string } =>
          typeof b === 'object' && b !== null && 'type' in b && b.type === 'text'
        )
        .map(b => b.text ?? '')
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

  async function runPushTask(prompt: string, inherit_context?: boolean) {
    const tool = createPushTaskTool(pi);
    await tool.execute('call-1', { prompt, inherit_context }, undefined, undefined, ctx);
  }

  async function runTaskCommand(command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<unknown> }) {
    const handlerP = command.handler('', ctx);
    await releaseNextIdle();
    await handlerP;
  }

  const runStartTask = () => runTaskCommand(createStartTaskCommand(pi));
  const runFinishTask = () => runTaskCommand(createFinishTaskCommand(pi));
  const runDiscardTask = () => runTaskCommand(createDiscardTaskCommand(pi));
  const runAbortTask = () => runTaskCommand(createAbortTaskCommand(pi));

  // Auto-register commands so the shutdown handler is set up
  registerTaskCommands(pi);

  function runAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }

  function getStatus(): string | undefined {
    return taskStatus;
  }

  return {
    getLlmHistory,
    isLlmTriggered,
    getLastHint,
    getStatus,
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


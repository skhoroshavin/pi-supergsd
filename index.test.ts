import assert from 'node:assert';

import { describe, it } from 'node:test';

import { SessionManager, type CustomEntry, type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

import registerTaskCommands, {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  pendingTask,
  currentTask,
  startTask,
  finishTask,
} from './index.js';

import {
  TASK_START_ENTRY_TYPE,
  TASK_DONE_ENTRY_TYPE,
  TASK_ENTRY_TYPE,
  type TaskStartData,
  type TaskData,
} from './index.js';

describe('createPushTaskTool', () => {
  it('returns terminate=true with the /auto-aware instruction text', async () => {
    const { pi, ctx, sm } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const tool = createPushTaskTool(pi);
    const result = await tool.execute('call-1', { prompt: 'Review the spec.' }, undefined, undefined, ctx);

    assert.strictEqual(result.terminate, true);
    assert.deepStrictEqual(result.content, [
      { type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' },
    ]);
  });
});

describe('createStartTaskCommand', () => {
  it('notifies when there is no pending task', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 0 });

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No pending task. Use push-task first.');
  });

  it('navigates to fresh context and injects task prompt', async () => {
    const { pi, ctx, sentMessages, navigations } = makeHarness();

    const rootUserMsgId = ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working...'));
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec for issues.' });
    const departureLeafId = ctx.sessionManager.getLeafId()!;

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, rootUserMsgId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, false);

    const taskStart = assertTaskStart(ctx.sessionManager);
    assert.strictEqual(taskStart.returnTo, departureLeafId);

    assert.deepStrictEqual(sentMessages, ['Review spec for issues.']);
  });

  it('stays on branch and creates task start', async () => {
    const { pi, ctx, sentMessages, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Quick fix.', context: 'branch' });
    const leafBefore = ctx.sessionManager.getLeafId()!;

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 0);

    const taskStart = assertTaskStart(ctx.sessionManager);
    assert.strictEqual(taskStart.returnTo, leafBefore);

    assert.deepStrictEqual(sentMessages, ['Quick fix.']);
  });

  it('defaults to fresh context when task has no explicit context', async () => {
    const { pi, ctx, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Default context task.' });

    const cmd = createStartTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    const taskStart = assertTaskStart(ctx.sessionManager);
    assert.ok(taskStart);
  });
});

describe('createDiscardTaskCommand', () => {
  it('notifies when there is no pending task', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'hello', timestamp: 0 });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No pending task.');
  });

  it('appends task-done to consume the active task', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'first task');
  });

  it('clears the only pending task so no task remains', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'only task' });

    const cmd = createDiscardTaskCommand(pi);
    await cmd.handler('', ctx);

    assertNoActiveTask(ctx.sessionManager);
  });
});

describe('createFinishTaskCommand', () => {
  it('notifies without navigating when there is no task start on the current branch', async () => {
    const { pi, ctx, sm, notifications } = makeHarness();
    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No task start point.');
  });

  it('navigates to the task start return target and appends task-done', async () => {
    const { pi, ctx, sm, navigations } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    sm.appendMessage(assistantMessage('Ready.'));

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    sm.appendMessage({ role: 'user', content: 'Implement phase 1.', timestamp: 0 });
    sm.appendMessage(assistantMessage('Done.'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, leafId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, false);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);

    assertNoActiveTask(ctx.sessionManager);
  });

  it('does not append task-done when tree navigation is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const rootId = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    const taskId = sm.getLeafId()!;
    sm.branch(taskId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: rootId });

    const entriesBefore = ctx.sessionManager.getEntries().length;

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(ctx.sessionManager.getEntries().length, entriesBefore);
  });

  it('supports a complete start-task → work → finish-task roundtrip', async () => {
    const { pi, ctx, sm, sentMessages, sentCustomMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'Write tests first.' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);
    assert.deepStrictEqual(sentMessages, ['Write tests first.']);

    sm.appendMessage(assistantMessage('Tests and implementation are complete.'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);

    assertNoActiveTask(ctx.sessionManager);
  });

  it('injects last assistant message', async () => {
    const { pi, ctx, sm, sentCustomMessages, notifications } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage(assistantMessage('Here is my analysis...'));

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    sm.appendMessage({ role: 'user', content: 'work', timestamp: 0 });
    sm.appendMessage(assistantMessage('Working on it...'));

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    assert.strictEqual((sentCustomMessages[0].options as { triggerTurn?: boolean } | undefined)?.triggerTurn, true);

    assertLastNotification(notifications, 'info', 'Task finished. Last response attached.');
  });

  it('filters out thinking blocks from injected last-response content', async () => {
    const { pi, ctx, sm, sentCustomMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    sm.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Internal reasoning...' },
        { type: 'text', text: 'Public response.' },
      ],
      timestamp: 0,
      model: 'test',
      provider: 'test',
    } as Parameters<SessionManager['appendMessage']>[0]);

    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    sm.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });
    sm.appendMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Processing...' },
        { type: 'text', text: 'Task result here.' },
      ],
      timestamp: 0,
      model: 'test',
      provider: 'test',
    } as Parameters<SessionManager['appendMessage']>[0]);

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    const content = sentCustomMessages[0].content as Array<{ type: string; text: string }>;
    assert.strictEqual(content.length, 1);
    assert.strictEqual(content[0].type, 'text');
    assert.strictEqual(content[0].text, 'Task result here.');
  });

  it('navigates without injecting when no assistant message exists on branch', async () => {
    const { pi, ctx, sm, sentCustomMessages, notifications } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const leafId = sm.getLeafId()!;
    sm.branch(leafId);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });

    const cmd = createFinishTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 0);
    assertLastNotification(notifications, 'info', 'Task finished. No last response to attach.');
  });
});

describe('createAbortTaskCommand', () => {
  it('notifies without navigating when no task start exists', async () => {
    const { pi, ctx, notifications } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assertLastNotification(notifications, 'warning', 'No task start point.');
    assertNoTaskStart(ctx.sessionManager);
  });

  it('navigates back without summary and appends task-done', async () => {
    const { pi, ctx, navigations } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    ctx.sessionManager.appendMessage(assistantMessage('Ready.'));

    const leafId = ctx.sessionManager.getLeafId()!;
    ctx.sessionManager.branch(leafId);
    ctx.sessionManager.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });
    ctx.sessionManager.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('Working...'));

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(navigations.length, 1);
    assert.strictEqual(navigations[0].targetId, leafId);
    assert.strictEqual((navigations[0].opts as { summarize?: boolean })?.summarize, false);

    const entries = ctx.sessionManager.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.strictEqual(lastEntry.type, 'custom');
    assert.strictEqual((lastEntry as CustomEntry).customType, TASK_DONE_ENTRY_TYPE);
  });

  it('does not append task-done when navigation is cancelled', async () => {
    const { pi, ctx, setCancelNextNav } = makeHarness();
    setCancelNextNav(true);

    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    const leafId = ctx.sessionManager.getLeafId()!;
    ctx.sessionManager.branch(leafId);
    ctx.sessionManager.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: leafId });

    const entriesBefore = ctx.sessionManager.getEntries().length;

    const cmd = createAbortTaskCommand(pi);
    await cmd.handler('', ctx);

    assert.strictEqual(ctx.sessionManager.getEntries().length, entriesBefore);
  });
});

describe('pendingTask', () => {
  it('returns null once a task-start exists on the current branch', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Branch task', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });
    sm.appendMessage({ role: 'user', content: 'task work', timestamp: 0 });

    assert.strictEqual(pendingTask(sm), null);
  });

  it('ignores task entries on sibling forks', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    const rootId = sm.getLeafId()!;

    sm.branch(rootId);
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Sibling task', context: 'branch' });

    sm.branch(rootId);
    sm.appendMessage({ role: 'user', content: 'active branch', timestamp: 0 });

    assert.strictEqual(pendingTask(sm), null);
    assert.strictEqual(currentTask(sm), null);
  });
});

describe('currentTask', () => {
  it('returns the task-start on the active branch', () => {
    const { sm } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'root', timestamp: 0 });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });

    const taskStart = currentTask(sm);
    assert.ok(taskStart);
    assert.strictEqual(taskStart.data.returnTo, returnTo);
  });
});

describe('startTask', () => {
  it('returns cancelled when fresh navigation is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav, sentMessages } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec.' });

    const result = await startTask(pi, ctx);

    assert.strictEqual(result, 'cancelled');
    assert.deepStrictEqual(sentMessages, []);
    assertNoTaskStart(ctx.sessionManager);
  });

  it('returns without duplicating task-start when a task is already in progress', async () => {
    const { pi, ctx, sm, sentMessages } = makeHarness();

    sm.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Review spec.', context: 'branch' });
    const returnTo = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo });

    const result = await startTask(pi, ctx);

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(sentMessages, []);
    assert.strictEqual(countCustomEntries(sm, TASK_START_ENTRY_TYPE), 1);
  });
});

describe('finishTask', () => {
  it('returns cancelled when navigation back to the return point is cancelled', async () => {
    const { pi, ctx, sm, setCancelNextNav, sentCustomMessages } = makeHarness();
    setCancelNextNav(true);

    sm.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    const rootId = sm.getLeafId()!;
    sm.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Implement phase 1.' });
    sm.branch(sm.getLeafId()!);
    sm.appendCustomEntry(TASK_START_ENTRY_TYPE, { returnTo: rootId });

    const result = await finishTask(pi, ctx);

    assert.strictEqual(result, 'cancelled');
    assert.strictEqual(sentCustomMessages.length, 0);
  });
});

describe('registration', () => {
  it('registers the push-task tool and all four task commands', () => {
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
    ]);
  });
});

describe('integration: /start-task fresh context', () => {
  it('completes /start-task → work → /finish-task with last-response injection', async () => {
    const { pi, ctx, sentMessages, sentCustomMessages, notifications } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working on main...'));

    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Analyze performance.' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);

    assert.deepStrictEqual(sentMessages, ['Analyze performance.']);

    ctx.sessionManager.appendMessage(assistantMessage('Found 3 bottlenecks: ...'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content[0].text, 'Found 3 bottlenecks: ...');

    assertLastNotification(notifications, 'info', 'Task finished. Last response attached.');

    assertNoActiveTask(ctx.sessionManager);
  });
});

describe('integration: /start-task branch context', () => {
  it('completes /start-task branch → work → /finish-task with last-response injection', async () => {
    const { pi, ctx, sentMessages, sentCustomMessages } = makeHarness();

    ctx.sessionManager.appendMessage({ role: 'user', content: 'main work', timestamp: 0 });
    ctx.sessionManager.appendMessage(assistantMessage('working...'));

    ctx.sessionManager.appendCustomEntry(TASK_ENTRY_TYPE, { prompt: 'Quick fix.', context: 'branch' });

    const startCmd = createStartTaskCommand(pi);
    await startCmd.handler('', ctx);

    assert.deepStrictEqual(sentMessages, ['Quick fix.']);

    ctx.sessionManager.appendMessage(assistantMessage('Fixed the bug.'));

    const finishCmd = createFinishTaskCommand(pi);
    await finishCmd.handler('', ctx);

    assert.strictEqual(sentCustomMessages.length, 1);
    assert.strictEqual(sentCustomMessages[0].customType, 'branch-result');
    const content2 = sentCustomMessages[0].content as Array<{ text: string }>;
    assert.strictEqual(content2[0].text, 'Fixed the bug.');
  });
});

describe('task stacking', () => {
  it('task called twice - second task is the active one (closest to leaf)', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'second task');
  });

  it('after clearing second task, first task becomes active', async () => {
    const { pi, ctx } = makeHarness();
    ctx.sessionManager.appendMessage({ role: 'user', content: 'start', timestamp: 0 });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'first task' });
    pi.appendEntry(TASK_ENTRY_TYPE, { prompt: 'second task' });

    const discardCmd = createDiscardTaskCommand(pi);
    await discardCmd.handler('', ctx);

    const task = assertActiveTask(ctx.sessionManager);
    assert.strictEqual(task.prompt, 'first task');
  });
});

// ── Test harness ─────────────────────────────────────────────────

function makeHarness() {
  const sm = SessionManager.inMemory();
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  const navigations: Array<{ targetId: string; opts?: unknown }> = [];
  let cancelNextNav = false;

  const pi = {
    appendEntry(customType: string, data?: unknown) {
      sm.appendCustomEntry(customType, data);
    },
    sendUserMessage(content: string | Array<{ type: string; text: string }>) {
      const text = typeof content === 'string' ? content : content.map((b) => b.text).join('');
      sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
      sentMessages.push(text);
    },
    sendMessage(message: { customType: string; content: unknown; display?: boolean; details?: unknown }, options?: { triggerTurn?: boolean }) {
      sentCustomMessages.push({ customType: message.customType, content: message.content, options });
      sm.appendCustomMessageEntry(message.customType, message.content as string, message.display ?? true, message.details);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    waitForIdle: async () => {},
    sessionManager: sm,
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
    },
    navigateTree: async (targetId: string, opts?: unknown) => {
      navigations.push({ targetId, opts });
      if (cancelNextNav) {
        return { cancelled: true };
      }
      sm.branch(targetId);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext & { sessionManager: SessionManager };

  return {
    sm,
    pi,
    ctx,
    sentMessages,
    sentCustomMessages,
    notifications,
    navigations,
    setCancelNextNav(v: boolean) {
      cancelNextNav = v;
    },
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

type AppendMessageInput = Parameters<SessionManager['appendMessage']>[0];

// ── Assertion helpers ───────────────────────────────────────────

function assertTaskStart(sm: SessionManager): TaskStartData {
  const ts = getTaskStart(sm);
  assert.ok(ts, 'Expected task start, found none.');
  return ts;
}

function assertNoTaskStart(sm: SessionManager): void {
  const ts = getTaskStart(sm);
  assert.strictEqual(ts, null, `Expected no task start, but found one: ${JSON.stringify(ts)}`);
}

function getTaskStart(sm: SessionManager): TaskStartData | null {
  const branch = sm.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_START_ENTRY_TYPE) {
      return e.data as TaskStartData;
    }
  }
  return null;
}

function assertActiveTask(sm: SessionManager): TaskData {
  const task = getActiveTask(sm);
  assert.ok(task, 'Expected active task, found none.');
  return task;
}

function countCustomEntries(sm: SessionManager, customType: string): number {
  return sm
    .getEntries()
    .filter((entry) => entry.type === 'custom' && entry.customType === customType)
    .length;
}

function assertNoActiveTask(sm: SessionManager): void {
  const task = getActiveTask(sm);
  assert.strictEqual(task, null, `Expected no active task, but found: ${JSON.stringify(task)}`);
}

function getActiveTask(sm: SessionManager): TaskData | null {
  const branch = sm.getBranch();
  let skip = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e.type === 'custom' && e.customType === TASK_DONE_ENTRY_TYPE) {
      skip++;
    } else if (e.type === 'custom' && e.customType === TASK_ENTRY_TYPE) {
      if (skip === 0) return e.data as TaskData;
      skip--;
    }
  }
  return null;
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

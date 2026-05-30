import assert from 'node:assert';

import { describe, it } from 'node:test';

import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';

import {
  createAutoCommand,
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
} from './index.js';

import {
  assistant,
  makeHarness,
  notification,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userRunsAuto,
} from './test-helpers/index.js';

describe('automated workflow', () => {
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working on main...');
    await h.runPushTask('Analyze performance.');
    assert.strictEqual(h.getStatus(), 'pending task: analyze-performance');
    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await h.runAuto({
      reactions: [[user('Analyze performance'), assistant('Found 3 bottlenecks: ...')]],
    });

    h.assertTaskStatusHistoryIncludes('[auto] pending task: analyze-performance');
    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    // Status line should be clean — no stale [auto] prefix remains.
    assert.strictEqual(h.getStatus(), undefined);
  });

  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working...');
    await h.runPushTask('Quick fix.', true);
    assert.strictEqual(h.getStatus(), 'pending task: quick-fix');
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await h.runAuto({
      reactions: [[user('Quick fix'), assistant('Fixed the bug.')]],
    });

    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      taskResult('quick-fix', 'Fixed the bug.'),
      notification('Task finished. Last response attached.'),
    );
  });

  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('main work');
    await h.runPushTask('Analyze performance.');

    await h.runAuto({
      reactions: [[task('Analyze performance.'), userEsc()]],
    });

    h.assertBranchHistory(
      user('main work'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );
  });

  it('notifies and exits when started with no pending tasks', async () => {
    const h = makeHarness(implementation);
    await h.runAuto({ reactions: [] });
    h.assertBranchHistory(
      notification('No pending tasks to run.'),
    );
  });

  it('still enters the auto loop after a prior session shutdown event', async () => {
    const sm = SessionManager.inMemory();
    sm.appendThinkingLevelChange('off');

    const idleWaiters: Array<() => void> = [];
    const sessionShutdownHandlers: Array<() => unknown> = [];
    const notifications: string[] = [];

    const pi = {
      appendEntry() {},
      sendUserMessage() {},
      sendMessage() {},
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
      hasPendingMessages: () => false,
      sessionManager: sm,
      ui: {
        notify(message: string) {
          notifications.push(message);
        },
        setStatus() {},
        theme: {
          fg: (_key: string, text: string) => text,
          bg: (_key: string, text: string) => text,
          bold: (text: string) => text,
        } as unknown as Theme,
      },
      navigateTree: async () => ({ cancelled: false }),
    } as unknown as ExtensionCommandContext;

    const auto = createAutoCommand(pi);
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }

    let settled = false;
    const autoPromise = auto.handler('', ctx).finally(() => {
      settled = true;
    });

    await Promise.resolve();

    assert.strictEqual(idleWaiters.length, 1);
    assert.strictEqual(settled, false);

    const waiter = idleWaiters.shift();
    assert.ok(waiter);
    waiter();

    await autoPromise;
    assert.deepStrictEqual(notifications, ['No pending tasks to run.']);
  });

  it('warns and returns when /auto is already running', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('start');
    await h.runPushTask('first task');

    await h.runAuto({
      reactions: [
        [user('first task'), assistant('done')],
        [assistant('done'), userRunsAuto()],
      ],
    });

    h.assertNotifications('Auto is already running.');
    h.assertBranchHistory(
      user('start'),
      task('first task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('first-task', 'done'),
      notification('Task finished. Last response attached.'),
    );
    assert.strictEqual(h.getStatus(), undefined);
  });

  it('stops when the last assistant message was aborted', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('start');
    await h.runPushTask('Implement phase 1.', true);

    await h.runAuto({
      reactions: [
        [user('Implement phase 1'), assistant('Stopped by user.', 'aborted')],
      ],
    });

    h.assertBranchHistory(
      user('start'),
      task('Implement phase 1.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      user('Implement phase 1.'),
      assistant('Stopped by user.', 'aborted'),
    );
    assert.strictEqual(h.getStatus(), 'current task: implement-phase-1');
  });

  it('processes a subtask pushed during a task', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('main work');
    h.appendAssistantMessage('working...');
    await h.runPushTask('parent task');

    await h.runAuto({
      reactions: [
        [user('parent task'), assistant('working on parent...')],
        [assistant('working on parent...'), task('subtask')],
        [user('subtask'), assistant('sub done')],
      ],
    });

    h.assertSessionContains(
      user('subtask'),
      assistant('sub done'),
      taskResult('subtask', 'sub done'),
    );

    // Parent finishes last. Only original-branch entries appear on the final
    // branch (subtask entries live elsewhere in the session tree).
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('parent task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('parent-task', 'working on parent...'),
      notification('Task finished. Last response attached.'),
    );
  });

  it('continues processing when user queues a steering message during auto', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('start');
    await h.runPushTask('Quick fix.', true);

    await h.runAuto({
      reactions: [
        [user('Quick fix'), assistant('thinking...')],
        [assistant('thinking...'), user('steer it')],
        [user('steer it'), assistant('adjusted response')],
      ],
    });

    // Auto processes: start task → assistant thinks → user steers →
    // assistant adjusts → finish task with final response.
    // Only original-branch entries appear (same pattern as test #2).
    h.assertBranchHistory(
      user('start'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('quick-fix', 'adjusted response'),
      notification('Task finished. Last response attached.'),
    );
  });

  it('stops when session is shut down during auto', async () => {
    const h = makeHarness(implementation);

    h.appendUserMessage('start');
    await h.runPushTask('Shutdown task', true);

    await h.runAuto({
      reactions: [
        [user('Shutdown task'), assistant('working...')],
        [assistant('working...'), userCtrlC()],
      ],
    });

    // Auto started task (inherit, no navigation), injected assistant,
    // then session shutdown fired. No navigation back — task-branch
    // entries remain visible. No taskResult — task was never finished.
    h.assertBranchHistory(
      user('start'),
      task('Shutdown task', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      user('Shutdown task'),
      assistant('working...'),
    );
    assert.strictEqual(h.getStatus(), 'current task: shutdown-task');
  });
});

const implementation = {
  createPushTaskTool,
  createStartTaskCommand,
  createFinishTaskCommand,
  createAbortTaskCommand,
  createDiscardTaskCommand,
  createAutoCommand,
};
# Test harness refactoring: user-perspective API

## Goal

Rewrite the `push-task` extension test harness and tests to use a "user perspective" API: tests verify the full LLM-visible message history, whether the last entry would trigger the LLM, and notifications from commands. Internal message-sending mechanics (`sentMessages`, `sentCustomMessages`) are no longer asserted.

## Removals

### From tests

- Entire `describe('registration', ...)` block
- Test: "stops instead of finishing the task when the last assistant message was aborted" — removed

### From harness

- `sentMessages[]`, `sentCustomMessages[]`, `navigations[]` arrays
- `abortedAssistantMessage()` helper
- `assertNoActiveTask()`, `getActiveTask()`, `countCustomEntries()` — task-internal, not user-visible
- `assertLastNotification()`, old `getLastNotification()`, `Notification` interface
- `TaskShape` interface, `TASK_DONE_ENTRY_TYPE` constant
- `pi`, `ctx`, `sm` — no longer exposed; harness owns them fully

### Retained from harness

- `releaseNextIdle()`, `flushMicrotasks()`, `emitSessionShutdown()`
- `setPendingMessages()`, `setCancelNextNav()`
- `runPushTask()`, `runStartTask()`, `runFinishTask()`, `runDiscardTask()`, `runAbortTask()`, `runAuto()`

## New public API (`makeHarness()` return)

```ts
// Message builders — append directly to session
appendUserMessage(text: string): void
appendAssistantMessage(text: string): void

// LLM perspective
getLlmHistory(): string[]       // buildSessionContext at current leaf, text blocks only
isLlmTriggered(): boolean       // would the last entry on the branch trigger the LLM?

// Notifications (consume-on-read: returns most recent since last call, clears on read)
getLastNotification(): string | undefined
```

## Implementation details

### Mock `pi` / `ctx` — internal only

The harness creates `pi` and `ctx` mocks internally and calls `registerTaskCommands(pi)` during construction. Tests never touch `pi`, `ctx`, or `sm` directly.

### `pi.sendUserMessage()` mock behavior

```ts
pi.sendUserMessage = (content, _options) => {
  const text = typeof content === 'string' ? content : content.map(b => b.text).join('');
  sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
};
```

### `pi.sendMessage()` mock behavior

```ts
const triggeredCustomMessages = new Set<string>();

pi.sendMessage = (message, options) => {
  const entryId = sm.appendCustomMessageEntry(
    message.customType,
    message.content as string,
    message.display ?? true,
    message.details,
  );
  if (options?.triggerTurn) {
    triggeredCustomMessages.add(entryId);
  }
};
```

### `appendUserMessage(text)`

Appends `{ role: 'user', content: text, timestamp: 0 }` via `sm.appendMessage()`.

### `appendAssistantMessage(text)`

Appends `{ role: 'assistant', content: [{ type: 'text', text }], timestamp: 0, model: 'test', provider: 'test' }` via `sm.appendMessage()`.

### `getLlmHistory()`

Uses `buildSessionContext` imported from `@earendil-works/pi-coding-agent`:

```ts
import { buildSessionContext } from '@earendil-works/pi-coding-agent';

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
```

`buildSessionContext` converts `custom_message` entries (branch results) to messages. Live function — each call reads the current branch.

Initial state: `[]`.

### `isLlmTriggered()`

Derives trigger state from the last entry on the branch:

```ts
function isLlmTriggered(): boolean {
  const branch = sm.getBranch();
  const last = branch[branch.length - 1];
  if (!last) return false;
  if (last.type === 'message' && last.message.role === 'user') return true;
  if (last.type === 'message' && last.message.role === 'assistant') return false;
  if (last.type === 'custom_message') return triggeredCustomMessages.has(last.id);
  return false;
}
```

| Last entry type | Triggered? |
|---|---|
| User message | `true` |
| Assistant message | `false` |
| Custom message (with `triggerTurn`) | `true` |
| Custom message (without `triggerTurn`) | `false` |
| Custom entry, compaction, etc. | `false` |

### `getLastNotification()`

Consume-on-read: returns the most recent `ctx.ui.notify()` message since the last call, then clears the internal buffer. Returns `undefined` if no notification since last read.

```ts
let pendingNotifications: string[] = [];

ctx.ui.notify = (message, _type) => {
  pendingNotifications.push(message);
};

function getLastNotification(): string | undefined {
  const last = pendingNotifications[pendingNotifications.length - 1];
  pendingNotifications = [];
  return last;
}
```

Only the most recent notification is returned (not all accumulated ones). This way each `getLastNotification()` call returns what the most recent command/tool emitted, then resets for the next phase.

## Production change: push-task notification

`createPushTaskTool` in `index.ts` must be updated to accept and use the `ctx` parameter, and call `ctx.ui.notify()`:

```ts
async execute(_toolCallId, params, signal, _update, ctx) {
  if (signal?.aborted) throw new Error('Task storage aborted.');
  pi.appendEntry(TASK_ENTRY_TYPE, { prompt: params.prompt, context: params.context ?? 'fresh' });
  ctx.ui.notify('Task pushed, use /start-task or /auto to execute it');
  return {
    content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
    details: {},
    terminate: true,
  };
},
```

## Test formatting convention

Empty lines separate test phases where a pause/waitForIdle boundary occurs. Assertions for a phase come immediately after the command that triggers that phase, followed by the empty line before the next phase.

## Tests

### discardTask

```ts
appendUserMessage('main work');
await runPushTask('Quick fix.');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await runDiscardTask();
assert.strictEqual(getLastNotification(), 'Task discarded.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work']);
```

### abortTask

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await runStartTask();
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastNotification(), undefined);

appendAssistantMessage('Partial work...');

await runAbortTask();
assert.strictEqual(getLastNotification(), 'Task aborted. Branch abandoned without summary.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...']);
```

### `integration: /start-task fresh context` — completes start → work → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await runStartTask();
// Fresh context: navigated to new root, only the task prompt is visible
assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastNotification(), undefined);

appendAssistantMessage('Found 3 bottlenecks: ...');
assert.strictEqual(getLastNotification(), undefined);

await runFinishTask();
// Navigated back + branch result injected
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastNotification()?.includes('Task finished'));
```

### `integration: /start-task branch context` — completes start → work → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await runStartTask();
// Branch context: stays on current branch, history includes prior messages
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastNotification(), undefined);

appendAssistantMessage('Fixed the bug.');
assert.strictEqual(getLastNotification(), undefined);

await runFinishTask();
// Navigated back + branch result injected
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
assert.ok(isLlmTriggered());
assert.ok(getLastNotification()?.includes('Task finished'));
```

### `integration: /auto fresh context` — completes push-task → auto → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

const running = runAuto();

await flushMicrotasks();
await releaseNextIdle();
// Auto ran start-task: fresh navigation, only task prompt visible
assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);

appendAssistantMessage('Found 3 bottlenecks: ...');

await releaseNextIdle();
await releaseNextIdle();
await running;
// Auto ran finish-task: navigated back + branch result
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastNotification()?.includes('Task finished'));
```

### `integration: /auto branch context` — returns branch result to original leaf

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

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
assert.ok(getLastNotification()?.includes('Task finished'));
```

### `integration: /auto branch context` — stops when navigation is cancelled

```ts
appendUserMessage('main work');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

setCancelNextNav(true);

const running = runAuto();

await flushMicrotasks();
await releaseNextIdle();
await running;
// Navigation cancelled: no messages added, history unchanged
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work']);
```

### `createAutoCommand` — waits when started with no task, then starts after push

```ts
const running = runAuto();

await flushMicrotasks();
await releaseNextIdle();
// Auto is waiting — no task yet

await runPushTask('Review spec.');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await releaseNextIdle();
// Auto picked up the task, sent user message
assert.deepStrictEqual(getLlmHistory(), ['Review spec.']);

appendAssistantMessage('Done.');

await releaseNextIdle();
await releaseNextIdle();
await running;
```

### `createAutoCommand` — warns when /auto is already running

```ts
const firstRun = runAuto();

await flushMicrotasks();

await runAuto();
assert.strictEqual(getLastNotification(), 'Auto is already running.');

await emitSessionShutdown();
await releaseNextIdle();
await firstRun;
```

### `createAutoCommand` — keeps waiting while follow-up work is pending

```ts
appendUserMessage('start');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastNotification(), 'Task pushed, use /start-task or /auto to execute it');

await runStartTask();
assert.strictEqual(getLastNotification(), undefined);

appendAssistantMessage('Fixed the bug.');

let resolved = false;
const running = runAuto().then(() => { resolved = true; });

await flushMicrotasks();
setPendingMessages(true);
await releaseNextIdle();
await releaseNextIdle();
// Finish happened but pending messages prevent auto from stopping
assert.ok(isLlmTriggered());
assert.strictEqual(resolved, false);

setPendingMessages(false);
await releaseNextIdle();
await running;
assert.strictEqual(resolved, true);
```

## Files changed

- `index.ts` — `createPushTaskTool` updated to accept `ctx` parameter and call `ctx.ui.notify()`
- `index.test.ts` — harness rewrite + all tests rewritten + 2 new tests (discardTask, abortTask)

## Things intentionally not covered

- `lastAssistantWasAborted` logic untested after test removal (low-value edge case)
- Notification type (`info`/`warning`) not distinguished — message text alone suffices

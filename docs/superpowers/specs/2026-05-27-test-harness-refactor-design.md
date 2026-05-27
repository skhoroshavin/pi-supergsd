# Test harness refactoring: user-perspective API

## Goal

Rewrite the `push-task` extension test harness and tests to use a "user perspective" API: tests verify the full LLM-visible message history, whether the last entry would trigger the LLM, and user-visible hints (notifications + tool outputs). Internal message-sending mechanics (`sentMessages`, `sentCustomMessages`) are no longer asserted.

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

// User-visible hints (notifications + tool outputs — both LLM-invisible)
getLastHint(): string | undefined  // most recent hint since last call, consume-on-read
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

### `getLastHint()`

Consume-on-read: returns the most recent hint since the last call, then clears. Hints come from two sources:

1. **Notifications** — `ctx.ui.notify(message, _type)` calls
2. **Tool outputs** — tool `execute()` return text (captured by `runPushTask` wrapper)

Both are user-visible but LLM-invisible. The function returns whichever is most recent, or `undefined` if none since last read.

```ts
interface Hint { text: string; sequence: number }
let hints: Hint[] = [];
let hintSeq = 0;

ctx.ui.notify = (message, _type) => {
  hints.push({ text: message, sequence: hintSeq++ });
};

async function runPushTask(prompt: string, context?: 'fresh' | 'branch') {
  const tool = createPushTaskTool(pi);
  const result = await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
  // Capture tool output as a hint
  const text = typeof result.content === 'string'
    ? result.content
    : (result.content as Array<{ text: string }>)[0]?.text ?? '';
  if (text) hints.push({ text, sequence: hintSeq++ });
}

function getLastHint(): string | undefined {
  if (hints.length === 0) return undefined;
  const last = hints[hints.length - 1];
  hints = [];
  return last.text;
}
```

Only the most recent hint is returned (not all accumulated). Each `getLastHint()` call drains the buffer.

## Production code

No changes to `index.ts`. The push-task tool result is captured by the harness `runPushTask` wrapper — the real tool already returns content that appears in the UI.

## Test formatting convention

Empty lines separate test phases where a pause/waitForIdle boundary occurs. Assertions for a phase come immediately after the command that triggers that phase, followed by the empty line before the next phase.

## Tests

### discardTask

```ts
appendUserMessage('main work');
await runPushTask('Quick fix.');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

await runDiscardTask();
assert.strictEqual(getLastHint(), 'Task discarded.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work']);
```

### abortTask

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

await runStartTask();
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastHint(), undefined);

appendAssistantMessage('Partial work...');
assert.strictEqual(getLastHint(), undefined);

await runAbortTask();
assert.strictEqual(getLastHint(), 'Task aborted. Branch abandoned without summary.');
assert.ok(!isLlmTriggered());
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...']);
```

### `integration: /start-task fresh context` — completes start → work → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

await runStartTask();
// Fresh context: navigated to new root, only the task prompt is visible
assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastHint(), undefined);

appendAssistantMessage('Found 3 bottlenecks: ...');
assert.strictEqual(getLastHint(), undefined);

await runFinishTask();
// Navigated back + branch result injected
assert.deepStrictEqual(getLlmHistory(), [
  'main work',
  'working on main...',
  'Found 3 bottlenecks: ...',
]);
assert.ok(isLlmTriggered());
assert.ok(getLastHint()?.includes('Task finished'));
```

### `integration: /start-task branch context` — completes start → work → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working...');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

await runStartTask();
// Branch context: stays on current branch, history includes prior messages
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Quick fix.']);
assert.ok(isLlmTriggered());
assert.strictEqual(getLastHint(), undefined);

appendAssistantMessage('Fixed the bug.');
assert.strictEqual(getLastHint(), undefined);

await runFinishTask();
// Navigated back + branch result injected
assert.deepStrictEqual(getLlmHistory(), ['main work', 'working...', 'Fixed the bug.']);
assert.ok(isLlmTriggered());
assert.ok(getLastHint()?.includes('Task finished'));
```

### `integration: /auto fresh context` — completes push-task → auto → finish

```ts
appendUserMessage('main work');
appendAssistantMessage('working on main...');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

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
assert.ok(getLastHint()?.includes('Task finished'));
```

### `integration: /auto branch context` — returns branch result to original leaf

```ts
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
```

### `integration: /auto branch context` — stops when navigation is cancelled

```ts
appendUserMessage('main work');
await runPushTask('Analyze performance.');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

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
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

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
assert.strictEqual(getLastHint(), 'Auto is already running.');

await emitSessionShutdown();
await releaseNextIdle();
await firstRun;
```

### `createAutoCommand` — keeps waiting while follow-up work is pending

```ts
appendUserMessage('start');
await runPushTask('Quick fix.', 'branch');
assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

await runStartTask();
assert.strictEqual(getLastHint(), undefined);

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

- `index.test.ts` — harness rewrite + all tests rewritten + 2 new tests (discardTask, abortTask)
- `index.ts` — no changes

## Things intentionally not covered

- `lastAssistantWasAborted` logic untested after test removal (low-value edge case)
- Hint type (`info`/`warning`, notification vs tool output) not distinguished — text alone suffices

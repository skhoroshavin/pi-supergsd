# Test Harness Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite test harness and tests to use a "user perspective" API — checking LLM history, trigger state, and user-visible hints.

**Architecture:** New harness helpers (`getLlmHistory`, `isLlmTriggered`, `getLastHint`, `appendUserMessage`, `appendAssistantMessage`) coexist alongside old tracking arrays during the rewrite. Each test is converted one at a time. `pi`/`ctx`/`sm` exposure is removed only after all tests are rewritten. Dead code is cleaned up last.

**Tech Stack:** TypeScript, Node 20+, `tsx` test runner, `@earendil-works/pi-coding-agent` SDK

**Roadmap:** None

**Phase:** Single-plan implementation

---

### Task 1: Add `buildSessionContext` import

**Files:**
- Modify: `index.test.ts` (imports section)

- [ ] **Step 1: Add import**

Add `buildSessionContext` to the import from `@earendil-works/pi-coding-agent`:

```ts
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  buildSessionContext,
} from '@earendil-works/pi-coding-agent';
```

- [ ] **Step 2: Verify tests still pass**

Run: `npm test`
Expected: all tests pass (import adds no behavioral change)

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: add buildSessionContext import"
```

---

### Task 2: Add `getLlmHistory()` helper

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

- [ ] **Step 1: Write `getLlmHistory` inside `makeHarness`, before the return statement**

```ts
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

- [ ] **Step 2: Expose `getLlmHistory` in the harness return object**

Add `getLlmHistory,` to the return statement.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all pass (helper exists but no test uses it yet)

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add getLlmHistory helper"
```

---

### Task 3: Add `isLlmTriggered()` helper with triggerTurn tracking

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

- [ ] **Step 1: Add `triggeredCustomMessages` set before the `pi` object**

```ts
const triggeredCustomMessages = new Set<string>();
```

- [ ] **Step 2: Update `pi.sendMessage` mock to track `triggerTurn`**

Find the current mock:
```ts
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
```

Replace with (using `sm.getBranch()` to get the entry ID since `appendCustomMessageEntry` may return `void`):
```ts
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
```

- [ ] **Step 3: Write `isLlmTriggered` inside `makeHarness`, before the return statement**

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

- [ ] **Step 4: Expose `isLlmTriggered` in the return object**

Add `isLlmTriggered,` to the return statement.

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: add isLlmTriggered helper with triggerTurn tracking"
```

---

### Task 4: Add `getLastHint()` with consume-on-read

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

- [ ] **Step 1: Add hint tracking array before the `pi` object**

```ts
const hints: Array<{ text: string }> = [];
```

- [ ] **Step 2: Update `ctx.ui.notify` to push to hints**

Find:
```ts
ui: {
  notify(message: string, type?: string) {
    notifications.push({ message, type });
  },
},
```

Replace with:
```ts
ui: {
  notify(message: string, type?: string) {
    notifications.push({ message, type });
    hints.push({ text: message });
  },
},
```

- [ ] **Step 3: Write `getLastHint` inside `makeHarness`, before the return statement**

```ts
function getLastHint(): string | undefined {
  if (hints.length === 0) return undefined;
  const last = hints[hints.length - 1];
  hints = [];
  return last.text;
}
```

- [ ] **Step 4: Expose `getLastHint` in the return object**

Add `getLastHint,` to the return statement.

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: all pass (no test uses `getLastHint` yet)

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "test: add getLastHint with consume-on-read"
```

---

### Task 5: Add `appendUserMessage` and `appendAssistantMessage` helpers

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

- [ ] **Step 1: Write helpers inside `makeHarness`, before the return statement**

```ts
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
```

- [ ] **Step 2: Expose both in the return object**

Add `appendUserMessage,` and `appendAssistantMessage,` to the return statement.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add appendUserMessage and appendAssistantMessage helpers"
```

---

### Task 6: Update `runPushTask` to capture tool output as hint

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

- [ ] **Step 1: Update the `runPushTask` wrapper**

Replace:
```ts
async function runPushTask(prompt: string, context?: 'fresh' | 'branch') {
  const tool = createPushTaskTool(pi);
  await tool.execute('call-1', { prompt, context }, undefined, undefined, ctx);
}
```

With:
```ts
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
```

- [ ] **Step 2: Verify tests still pass**

Run: `npm test`
Expected: all pass (no test uses `getLastHint` yet, so hints are just accumulated)

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: capture push-task tool output as hint"
```

---

### Task 7: Add `discardTask` test (new)

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add the test in a new describe block near the top**

Add after the existing describe blocks:

```ts
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
```

- [ ] **Step 2: Run the new test**

Run: `npm test -- --test-name-pattern='discardTask'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add discardTask test"
```

---

### Task 8: Add `abortTask` test (new)

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Add the test**

```ts
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
```

- [ ] **Step 2: Run the new test**

Run: `npm test -- --test-name-pattern='abortTask'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add abortTask test"
```

---

### Task 9: Rewrite `integration: /start-task fresh context` test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the existing test body**

Find the test inside `describe('integration: /start-task fresh context', ...)`. Replace its body with:

```ts
describe('integration: /start-task fresh context', () => {
  it('completes /start-task → work → /finish-task with last-response injection', async () => {
    const { appendUserMessage, appendAssistantMessage, getLlmHistory, isLlmTriggered, getLastHint, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getLastHint(), 'Task stored. Use `/start-task` or `/auto` to start it.');

    await runStartTask();
    assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='integration: /start-task fresh context'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite fresh-context start-task test with user-perspective API"
```

---

### Task 10: Rewrite `integration: /start-task branch context` test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the existing test body**

Find the test inside `describe('integration: /start-task branch context', ...)`. Replace with:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='integration: /start-task branch context'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite branch-context start-task test with user-perspective API"
```

---

### Task 11: Rewrite `integration: /auto fresh context` test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the existing test body**

Find the test inside `describe('integration: /auto fresh context', ...)`. Replace with:

```ts
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
    assert.deepStrictEqual(getLlmHistory(), ['Analyze performance.']);

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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='integration: /auto fresh context'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite auto fresh-context test with user-perspective API"
```

---

### Task 12: Rewrite `integration: /auto branch context` — returns branch result

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the first test in `describe('integration: /auto branch context', ...)`**

Find the test `'returns the branch result to the original leaf for branch-context tasks'`. Replace with:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='returns the branch result to the original leaf'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite auto branch-context test with user-perspective API"
```

---

### Task 13: Rewrite `integration: /auto branch context` — cancelled navigation

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the second test in the same describe block**

Find the test `'stops when navigation is cancelled and does not mark the task done'`. Replace with:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='stops when navigation is cancelled'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite cancelled-navigation test with user-perspective API"
```

---

### Task 14: Delete `describe('registration', ...)` block

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Remove the entire registration describe block**

Delete everything from `// ── Registration ──────────` through the closing `});` of the `describe('registration', ...)` block.

- [ ] **Step 2: Verify tests pass**

Run: `npm test`
Expected: all remaining tests pass

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: remove registration describe block"
```

---

### Task 15: Rewrite `createAutoCommand` — waits for task test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the test body**

Find the test `'waits when started with no task, then starts work after a later push-task'` inside `describe('createAutoCommand', ...)`. Replace with:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='waits when started with no task'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite auto-waits-for-task test with user-perspective API"
```

---

### Task 16: Rewrite `createAutoCommand` — already running test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the test body**

Find the test `'warns and returns when /auto is already running'`. Replace with:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='warns and returns when /auto is already running'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite auto-already-running test with user-perspective API"
```

---

### Task 17: Remove aborted assistant test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Delete the test**

Find and remove the entire test:
```ts
it('stops instead of finishing the task when the last assistant message was aborted', async () => {
    const { sm, sentCustomMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();
    ...
  });
```

- [ ] **Step 2: Verify tests pass**

Run: `npm test`
Expected: all remaining tests pass

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "test: remove aborted assistant test"
```

---

### Task 18: Rewrite `createAutoCommand` — pending messages test

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Replace the test body**

Find the test `'keeps waiting while follow-up work is pending after finishTask'`. Replace with:

```ts
it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, getLastHint, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Quick fix.', 'branch');
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --test-name-pattern='keeps waiting while follow-up work is pending'`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: rewrite pending-messages test with user-perspective API"
```

---

### Task 19: Auto-register commands internally, stop exposing `pi`, `ctx`, `sm`

**Files:**
- Modify: `index.test.ts` (inside `makeHarness`)

**Note:** All tests have been rewritten at this point and no longer destructure `pi`, `ctx`, or `sm`. It is now safe to remove them.

- [ ] **Step 1: Add `registerTaskCommands(pi)` at the end of `makeHarness`**

Add after all internal functions are defined, before the `return` statement:

```ts
registerTaskCommands(pi);
```

- [ ] **Step 2: Remove `pi`, `ctx`, `sm` from the return object**

Remove these lines from the return object:
```ts
pi,
ctx,
sm,
```

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: auto-register commands, stop exposing pi/ctx/sm"
```

---

### Task 20: Remove dead code — old helpers, types, and tracking arrays

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Remove `sentMessages` and `sentCustomMessages` arrays**

Delete these declarations from `makeHarness`:
```ts
const sentMessages: string[] = [];
const sentCustomMessages: Array<{ customType: string; content: unknown; options?: unknown }> = [];
```

And remove `sentMessages,` and `sentCustomMessages,` from the return object. Also remove the `sentCustomMessages.push(...)` line from the `pi.sendMessage` mock (the mock should now only append the entry and track `triggerTurn`):

```ts
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
```

- [ ] **Step 2: Remove `navigations` array**

Delete:
```ts
const navigations: Array<{ targetId: string; opts?: unknown }> = [];
```
And remove `navigations,` from the return object.

- [ ] **Step 3: Remove `abortedAssistantMessage` function**

Delete the function:
```ts
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
```

- [ ] **Step 4: Remove old `assistantMessage` factory function**

Delete:
```ts
function assistantMessage(text: string): AppendMessageInput {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 0,
    model: 'test',
    provider: 'test',
  } as AppendMessageInput;
}
```

- [ ] **Step 5: Remove `AppendMessageInput` type alias**

Delete:
```ts
type AppendMessageInput = Parameters<SessionManager['appendMessage']>[0];
```

- [ ] **Step 6: Remove `assertNoActiveTask`, `getActiveTask`, `countCustomEntries`**

Delete these three functions:
```ts
function assertNoActiveTask(sm: SessionManager): void { ... }
function getActiveTask(sm: SessionManager): TaskShape | null { ... }
function countCustomEntries(sm: SessionManager, customType: string): number { ... }
```

- [ ] **Step 7: Remove `TaskShape` interface and `TASK_DONE_ENTRY_TYPE` constant**

Delete:
```ts
interface TaskShape { prompt: string; context?: string }
```
Delete:
```ts
const TASK_DONE_ENTRY_TYPE = 'task-done';
```

- [ ] **Step 8: Remove `assertLastNotification`, old `getLastNotification`, `Notification` interface**

Delete these three items:
```ts
function assertLastNotification(notifications: Notification[], ...): Notification { ... }
function getLastNotification(notifications: Notification[], ...): Notification | null { ... }
interface Notification { message: string; type?: string; }
```

- [ ] **Step 9: Remove `notifications` array and update `ctx.ui.notify` mock**

Delete the declaration:
```ts
const notifications: Array<{ message: string; type?: string }> = [];
```

Update the `ctx.ui.notify` mock to remove the `notifications.push(...)` line:
```ts
ui: {
  notify(message: string, type?: string) {
    hints.push({ text: message });
  },
},
```

Remove `notifications,` from the return object.

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: all pass

- [ ] **Step 11: Run full verification**

```bash
npm run verify
```
Expected: all pass (lint, typecheck, tests, updater, drift, pack)

- [ ] **Step 12: Commit**

```bash
git add index.test.ts
git commit -m "test: remove dead code — old helpers, types, and tracking arrays"
```

---

### Task 21: Final cleanup — verify and lint

**Files:**
- Modify: `index.test.ts` (minor cleanup)

- [ ] **Step 1: Run lint with autofix**

```bash
npm run fix
```

- [ ] **Step 2: Run full verification**

```bash
npm run verify
```

Expected: all pass

- [ ] **Step 3: Review test file for unused imports**

Check that `SessionManager`, `ExtensionAPI`, `ExtensionCommandContext` are still needed (they are used in `makeHarness`). Remove any imports that are no longer used.

- [ ] **Step 4: Final commit if any changes**

```bash
git add index.test.ts
git commit -m "chore: final lint fixes after test refactor"
```

If no lint changes, skip.

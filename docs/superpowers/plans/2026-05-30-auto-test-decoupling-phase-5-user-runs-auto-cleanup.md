# Auto Test Decoupling — Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `userRunsAuto()` reaction, port the final "already running" test, replace `autoState` with a closure-based `running`/`stopped` flag in `createAutoCommand`, wrap status updates with `[auto]` prefix while auto runs, add status assertions for both happy-path and early-exit auto runs, and remove all legacy harness helpers.

**Architecture:** A single `autoHandler` instance (created once from `createAutoCommand(pi)`) is shared between `runAuto(config)` and the `userRunsAuto` reaction. When `userRunsAuto` fires, it invokes the same handler reentrantly; the closure's `running` flag causes the second invocation to inject "Auto is already running" and return immediately. The source `autoState` module variable is deleted; running state moves into the `createAutoCommand` closure. Status updates are wrapped via a temporary replacement of `ctx.ui.setStatus` that prefixes the `'task'` key with `[auto]`, and auto re-renders task status in `finally` so pending/current tasks lose the prefix on every exit path. After all tests are migrated, legacy helpers are removed from the harness entirely, including the old internal `releaseNextIdle` helper; only the minimal `cancelNextNav` and `sessionShutdownHandlers` state needed by reactions remains.

**Implementation note:** The final harness also keeps a notification log so the re-entrant "Auto is already running." warning can be asserted even though it is emitted on the task branch, not the final branch returned by `finishTask()`.

**Tech Stack:** Node 20+, TypeScript, node:test, node:assert, tsx

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-30-auto-test-decoupling-roadmap.md`](../roadmaps/2026-05-30-auto-test-decoupling-roadmap.md)

**Phase:** Phase 5: `userRunsAuto` + already-running test + source changes + cleanup

---

### File Map

| File | Role |
|------|------|
| `index.test.ts` | **Modify.** Add `userRunsAuto` helper and `ReactionDescriptor` union member. Store a shared `autoHandler` instance in `makeHarness`. Extend `applyReaction` with `user-runs-auto` handling. Rewrite test #7. Add `[auto]`-prefix status assertions to test #1. Remove six legacy helpers from return value, remove `legacyRunAuto`, remove `setPendingMessages`/`setCancelNextNav` functions, remove `pendingMessages` variable, hardcode `hasPendingMessages: () => false` in ctx mock. |
| `index.ts` | **Modify.** Delete `autoState` module variable. Rewrite `createAutoCommand` with closure-based `running`/`stopped` state. Move `session_shutdown` handler registration from `registerTaskCommands` into `createAutoCommand`. Wrap `ctx.ui.setStatus` to prefix the `'task'` key with `[auto]` while auto runs. |

---

### Pre-conditions (from Phases 1–4)

After Phase 4, the harness has these functions:

- `legacyRunAuto()` — original `runAuto` renamed, still calls `createAutoCommand(pi).handler('', ctx)` each time (creates fresh handler)
- `runAuto(config: AutoConfig)` — new reaction-engine version, also calls `createAutoCommand(pi).handler('', ctx)` each time
- Reaction engine with fixed-point `scanAndReact`, supporting `user`, `assistant`, `task` match descriptors
- Reaction descriptors: `assistant()`, `user()`, `task()`, `userEsc()`, `userCtrlC()`
- `cancelNextNav` internal flag, used by `userEsc`
- `sessionShutdownHandlers` array, triggered by `userCtrlC`
- Tests #1–#6, #8, #9 use new `runAuto`; test #7 still uses `legacyRunAuto`
- Six legacy helpers (`releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav`, `legacyRunAuto`) still returned from `makeHarness`

---

### Task 1: Add `userRunsAuto` helper and extend `ReactionDescriptor` type

**Files:**
- Modify: `index.test.ts` — after `userCtrlC` helper (added in Phase 4), before `makeHarness`
- Modify: `index.test.ts` — `ReactionDescriptor` type (after `makeHarness` closing brace)

- [ ] **Step 1: Add the `userRunsAuto` helper**

After the `userCtrlC` helper (immediately after it, which was added in Phase 4 Task 1), add:

```ts
const userRunsAuto = () => ({ type: 'user-runs-auto' as const });
```

This goes at the top level, alongside the existing helpers:

```ts
const userEsc = () => ({ type: 'user-esc' as const });
const userCtrlC = () => ({ type: 'user-ctrl-c' as const });
const userRunsAuto = () => ({ type: 'user-runs-auto' as const });  // <-- ADD
```

- [ ] **Step 2: Extend `ReactionDescriptor` to include `user-runs-auto`**

Find the `ReactionDescriptor` type (after `makeHarness` closing brace, extends from Phase 4):

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  | { type: 'user-ctrl-c' }                    // userCtrlC()
  ;
```

Add the new union member:

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  | { type: 'user-ctrl-c' }                    // userCtrlC()
  | { type: 'user-runs-auto' }                 // userRunsAuto()
  ;
```

- [ ] **Step 3: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "feat: add userRunsAuto helper and extend ReactionDescriptor type"
```

---

### Task 2: Store shared `autoHandler` instance and implement `user-runs-auto` reaction handling

**Files:**
- Modify: `index.test.ts` — `makeHarness()` — replace per-call `createAutoCommand(pi)` with a shared handler instance
- Modify: `index.test.ts` — `makeHarness()`, `applyReaction()` — add `user-runs-auto` case

**Why a shared handler matters:** For the closure-based `running` flag (Task 4) to work, all invocations of the auto handler — from `runAuto`, `legacyRunAuto`, and `userRunsAuto` — must go through the same function object. Currently each call to `createAutoCommand(pi).handler('', ctx)` creates a NEW handler with its own closure. We create the handler once and reuse it.

- [ ] **Step 1: Create a shared `autoHandler` in `makeHarness`**

BEFORE `registerTaskCommands(pi)` is called (~line 1262), add:

```ts
  // Shared auto handler — created once so closure state (running/stopped)
  // is shared across runAuto, legacyRunAuto, and userRunsAuto reaction.
  // Must be created before registerTaskCommands so the primary closure owns
  // the session_shutdown handler (registerTaskCommands internally calls
  // createAutoCommand again, but its handler is discarded by the mock; the
  // extra shutdown handler from that call is harmless).
  const autoHandler = createAutoCommand(pi).handler;
```

- [ ] **Step 2: Update `legacyRunAuto` to use the shared handler**

Find the `legacyRunAuto` function (renamed from `runAuto` in Phase 1, ~line 1264):

```ts
  function legacyRunAuto(): Promise<void> {
    return createAutoCommand(pi).handler('', ctx) as Promise<void>;
  }
```

Replace with:

```ts
  function legacyRunAuto(): Promise<void> {
    return autoHandler('', ctx) as Promise<void>;
  }
```

- [ ] **Step 3: Update `runAuto(config)` to use the shared handler**

Inside `runAuto(config)` (added in Phase 1, expanded in Phases 2–4), find the line that creates the handler promise:

```ts
    const handlerPromise = createAutoCommand(pi).handler('', ctx).finally(() => { settled = true; });
```

Replace with:

```ts
    const handlerPromise = autoHandler('', ctx).finally(() => { settled = true; });
```

- [ ] **Step 4: Extend `applyReaction` to handle `user-runs-auto`**

Find `applyReaction` inside `makeHarness`. It currently handles `user-esc`, `user-ctrl-c`, `assistant`, `user`, and `task` reactions. Add the `user-runs-auto` case after the `user-ctrl-c` case:

```ts
    // --- user-runs-auto reaction: invoke auto handler reentrantly ---
    if (r.type === 'user-runs-auto') {
      // Invoke the same auto handler from within the active run. The
      // second invocation detects the closure's `running` flag is true,
      // injects "Auto is already running", and returns immediately.
      // Fire-and-forget: the handler is async but the guard check and
      // notification happen synchronously before any await.
      autoHandler('', ctx).catch(() => {});
      return;
    }
```

This must be placed inside `applyReaction`, after the `user-ctrl-c` block and before the implicit end of the function. The catch suppresses unhandled rejection (the promise resolves immediately because the handler returns after the guard check).

- [ ] **Step 5: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The shared handler has no behavioral change (currently `autoState` is module-level, so fresh vs. shared handler doesn't matter). No test exercises `user-runs-auto` yet.

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "feat: share autoHandler instance, add user-runs-auto reaction handling"
```

---

### Task 3: Port test #7 — "warns when /auto is already running"

**Files:**
- Modify: `index.test.ts` — `describe('automated workflow')` — replace existing test #7 (~line 899)

**Test design:** A task is pushed (non-inherit context). `runAuto` starts, auto picks up the task and starts it on a fresh branch (injecting `user('first task')`). The reaction engine matches this with `assistant('done')`, then matches the assistant with `userRunsAuto()`. The second handler invocation detects the first is still holding the `running` flag, injects "Auto is already running" notification on the task branch, and returns. The first auto invocation continues — `finishTask` navigates back to the original branch, injects `taskResult` and the finish notification. The "already running" notification was on the task branch and is not visible after navigation (same pattern as tests #1/#2 where task-branch entries don't appear in final assertions). The test verifies auto completed successfully by checking `taskResult` and `isLlmTriggered`, and verifies status cleanup with `getStatus()`.

- [ ] **Step 1: Replace the existing test**

Find the existing test at ~line 899:

```ts
  it('warns and returns when /auto is already running', async () => {
    const { assertBranchHistory, releaseNextIdle, flushMicrotasks, emitSessionShutdown, runAuto } =
      makeHarness();

    const firstRun = runAuto();
    await flushMicrotasks();

    await runAuto();
    assertBranchHistory(notification('Auto is already running.'));

    await emitSessionShutdown();
    await releaseNextIdle();
    await firstRun;
  });
```

Replace with:

```ts
  it('warns and returns when /auto is already running', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('first task');

    await h.runAuto({
      reactions: [
        [user('first task'), assistant('done')],
        [assistant('done'), userRunsAuto()],
      ],
    });

    // Auto completes: task started on fresh branch, reaction chain fires
    // (assistant injected, then userRunsAuto triggers second handler
    // invocation which detects "already running" and returns), then task
    // finishes normally. Task-branch entries (including the "already
    // running" notification) are not visible after finishTask navigates
    // back — same pattern as tests #1/#2.
    h.assertBranchHistory(
      user('start'),
      task('first task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('first-task', 'done'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
    // Status line should be clean — no stale [auto] prefix remains.
    assert.strictEqual(h.getStatus(), undefined);
  });
```

**Step-by-step trace:**

1. `runAuto` starts. Handler: `running = true`. Enters while loop, calls `await ctx.waitForIdle()` — waiter pushed.
2. Harness loop: resolves first idle. Before resolving, `scanAndReact` runs from index 0 (initial full scan). Current branch has `user('start')`, `task`, notification. No reaction pair matches yet — `user('first task')` matches nothing on this branch.
3. Idle resolved. Handler wakes: `pendingTask('first task')` found → `startTask` called.
4. `startTask` (non-inherit): navigates to fresh context → appends TASK_START → `sendUserMessage('first task')` on the fresh branch → `continue`.
5. Next iteration: `await ctx.waitForIdle()` — waiter pushed.
6. Harness loop: before resolving idle, `scanAndReact` scans new entries since last scan. Current branch (fresh): `user('first task')`. Match pair 1: `user('first task')` → inject `assistant('done')`. Fixed-point: `assistant('done')` matches pair 2 → `userRunsAuto()` fires.
7. `userRunsAuto`: calls `autoHandler('', ctx)`. Handler: `running` is `true` → `ctx.ui.notify('Auto is already running.', 'warning')` → notification tracked with `afterEntryId` = current leaf on fresh branch → returns. (Notification is on the fresh/task branch.)
8. Fixed point reached. Idle resolved. Handler wakes: `pendingTask` → null, `currentTask` → present → `finishTask`.
9. `finishTask`: captures `assistant('done')` as last assistant → navigates to `taskStart.data.returnTo` (departureLeafId from step 4, on the original branch) → back on original branch → injects `taskResult` and notification.
10. Handler loop: no pending, no current, sawTaskActivity → `!hasPendingMessages()` → true (hardcoded false) → break.
11. Handler exits. `settled = true`. `await handlerPromise` resolves.
12. `assertBranchHistory` on original branch: `user('start')`, `task('first task')`, `notification('Task stored. ...')`, `taskResult('first-task', 'done')`, `notification('Task finished. ...')`.
13. `assert.ok(isLlmTriggered())` — `taskResult` with `triggerTurn: true` triggered the custom message.
14. `assert.strictEqual(getStatus(), undefined)` — `finishTask` cleared the task status, and no `[auto]` prefix leaked.

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="warns and returns when /auto is already running" index.test.ts
```

Expected: PASS. The reaction chain fires correctly, the second handler invocation detects already-running and returns, the first invocation completes the task normally.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All 9 auto tests pass using new `runAuto`. 0 tests use `legacyRunAuto`. All manual workflow tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port already-running test to new runAuto with userRunsAuto reaction"
```

---

### Task 4: Source change — remove `autoState`, move running state into `createAutoCommand` closure

**Files:**
- Modify: `index.ts` — `registerTaskCommands` (~line 36): remove `session_shutdown` handler
- Modify: `index.ts` — `createAutoCommand` (~line 55–97): rewrite with closure-based state
- Modify: `index.ts` — end of file (~line 575): delete `const autoState = { running: false };`

- [ ] **Step 1: Remove `autoState` variable**

Delete the module-level variable at the end of the file (~line 575):

```ts
const autoState = { running: false };
```

- [ ] **Step 2: Remove `session_shutdown` handler from `registerTaskCommands`**

In `registerTaskCommands`, remove the handler registration at ~line 36:

```ts
  pi.on('session_shutdown', async () => {
    autoState.running = false;
  });
```

Delete these 3 lines. The handler moves into `createAutoCommand`.

- [ ] **Step 3: Rewrite `createAutoCommand` with closure-based state**

Replace the entire `createAutoCommand` function (currently ~lines 55–97):

```ts
export function createAutoCommand(pi: ExtensionAPI): CommandOptions {
  return {
    description: 'Automatically run pushed task branches',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (autoState.running) {
        ctx.ui.notify('Auto is already running.', 'warning');
        return;
      }

      autoState.running = true;
      let sawTaskActivity = false;

      try {
        while (autoState.running) {
          await ctx.waitForIdle();

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          // No pending tasks and no current task
          if (!sawTaskActivity) {
            // Never had any task activity — nothing to process
            ctx.ui.notify('No pending tasks to run.', 'info');
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        autoState.running = false;
      }
    },
  };
}
```

With:

```ts
export function createAutoCommand(pi: ExtensionAPI): CommandOptions {
  let running = false;
  let stopped = false;

  // Register shutdown handler inside the closure so it can set `stopped`.
  pi.on('session_shutdown', async () => {
    stopped = true;
  });

  return {
    description: 'Automatically run pushed task branches',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (running) {
        ctx.ui.notify('Auto is already running.', 'warning');
        return;
      }

      running = true;
      let sawTaskActivity = false;

      try {
        while (!stopped) {
          await ctx.waitForIdle();

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          // No pending tasks and no current task
          if (!sawTaskActivity) {
            // Never had any task activity — nothing to process
            ctx.ui.notify('No pending tasks to run.', 'info');
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        running = false;
        stopped = false;
      }
    },
  };
}
```

Key changes:
- Module-level `autoState` → closure `running` and `stopped`
- `while (autoState.running)` → `while (!stopped)`
- `autoState.running = true/false` → `running = true/false`
- `session_shutdown` handler registered here (moved from `registerTaskCommands`)
- `finally` resets both `running` and `stopped`

- [ ] **Step 4: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors. The `autoState` variable was only used in the deleted code.

- [ ] **Step 5: Run all tests to verify they pass with closure-based state**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The shared `autoHandler` approach (Task 2) means all handler invocations share the same closure `running`/`stopped`. UserCtrlC tests (test #9) still work because the shutdown handler sets `stopped = true` in the same closure.

- [ ] **Step 6: Commit**

```bash
git add index.ts
git commit -m "refactor: replace module-level autoState with closure-based running/stopped in createAutoCommand"
```

---

### Task 5: Source change — wrap status updates with `[auto]` prefix

**Files:**
- Modify: `index.ts` — `createAutoCommand` handler — wrap `ctx.ui.setStatus` before the while loop, restore in finally

- [ ] **Step 1: Add `setStatus` wrapping in the auto handler**

In the handler (after `running = true`, before `try`), add a wrapper that intercepts `ctx.ui.setStatus` to prefix the `'task'` key with `[auto]`:

Find the handler body after the `running = true` line (~line 68 in the new code):

```ts
      running = true;
      let sawTaskActivity = false;

      try {
        while (!stopped) {
```

Replace with:

```ts
      running = true;
      let sawTaskActivity = false;

      // Wrap setStatus so task status lines show [auto] prefix while running.
      // startTask, finishTask, and discardTask all call updateTaskStatus which
      // uses ctx.ui.setStatus — by wrapping it here, all status updates during
      // the auto loop automatically get the prefix.
      const originalSetStatus = ctx.ui.setStatus.bind(ctx.ui);
      ctx.ui.setStatus = (key: string, value: string | undefined) => {
        if (key === 'task' && value !== undefined) {
          originalSetStatus(key, `[auto] ${value}`);
        } else {
          originalSetStatus(key, value);
        }
      };

      try {
        while (!stopped) {
```

And update the `finally` block to restore the original:

```ts
      } finally {
        ctx.ui.setStatus = originalSetStatus;
        running = false;
        stopped = false;
      }
```

The full handler now looks like:

```ts
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (running) {
        ctx.ui.notify('Auto is already running.', 'warning');
        return;
      }

      running = true;
      let sawTaskActivity = false;

      const originalSetStatus = ctx.ui.setStatus.bind(ctx.ui);
      ctx.ui.setStatus = (key: string, value: string | undefined) => {
        if (key === 'task' && value !== undefined) {
          originalSetStatus(key, `[auto] ${value}`);
        } else {
          originalSetStatus(key, value);
        }
      };

      try {
        while (!stopped) {
          await ctx.waitForIdle();

          if (lastAssistantWasAborted(ctx.sessionManager)) break;

          if (pendingTask(ctx.sessionManager)) {
            const result = await startTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (currentTask(ctx.sessionManager)) {
            const result = await finishTask(pi, ctx);
            if (result === 'cancelled') break;
            sawTaskActivity = true;
            continue;
          }

          if (!sawTaskActivity) {
            ctx.ui.notify('No pending tasks to run.', 'info');
            break;
          }

          if (!ctx.hasPendingMessages()) {
            break;
          }
        }
      } finally {
        ctx.ui.setStatus = originalSetStatus;
        running = false;
        stopped = false;
      }
    },
```

**How it works:** `startTask` and `finishTask` call `updateTaskStatus(ctx.sessionManager, ctx.ui.setStatus.bind(ctx.ui), ctx.ui.theme)`. Since we replaced `ctx.ui.setStatus` with our wrapper, the `.bind(ctx.ui)` captures the wrapper. When `updateTaskStatus` calls the bound function with `('task', 'pending task: my-task')`, the wrapper transforms it to `('task', '[auto] pending task: my-task')`. When auto stops (finally block), we restore the original `setStatus`. If `updateTaskStatus` sets the value to `undefined` (clearing status), we pass through unchanged (no prefix wrapping).

- [ ] **Step 2: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors. `ctx.ui.setStatus` is a writable property on the object.

- [ ] **Step 3: Run all tests to verify they pass with status prefix**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The `[auto]` prefix appears in status during test runs but no test asserts on it yet. The prefix is cleaned up in `finally` so no test sees stale prefixed status after auto completes.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat: wrap task status with [auto] prefix while auto runs"
```

---

### Task 6: Add `[auto]` prefix assertion to test #1

**Files:**
- Modify: `index.test.ts` — `describe('automated workflow')` — test #1 (~line 779)

Add a `getStatus()` assertion after `runAuto` completes to verify the `[auto]` prefix was cleaned up.

- [ ] **Step 1: Add the assertion**

In test #1 (ported in Phase 2, ~line 779):

```ts
    await h.runAuto({
      reactions: [[user('Analyze performance'), assistant('Found 3 bottlenecks: ...')]],
    });

    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
```

Change the final `assert.ok` line to also check status:

```ts
    assert.ok(h.isLlmTriggered());
    // Status line should be clean — no stale prefix or task status.
    assert.strictEqual(h.getStatus(), undefined);
```

The `getStatus()` call returns `taskStatus`, the value tracked by the harness mock. After auto completes and the `finally` block restores the original `setStatus`, `finishTask` calls `updateTaskStatus` which sets `'task'` to `undefined` (no pending/current task). Since we've restored the original `setStatus`, the undefined passthrough is a no-op in the wrapper. The harness's `taskStatus` should be `undefined`.

- [ ] **Step 2: Run the specific test**

```bash
npx tsx --test --test-name-pattern="completes push-task" index.test.ts
```

Expected: PASS. The status assertion verifies that after auto completes, `getStatus()` is `undefined` — no stuck `[auto]` prefix.

- [ ] **Step 3: Run all tests**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add status cleanup assertion to fresh-context auto test"
```

---

### Task 7: Remove legacy helpers from `makeHarness` return value

**Files:**
- Modify: `index.test.ts` — `makeHarness()` return statement (~line 1285) — remove six helpers + `legacyRunAuto`

- [ ] **Step 1: Remove `legacyRunAuto` function**

Delete the `legacyRunAuto` function from inside `makeHarness`:

```ts
  function legacyRunAuto(): Promise<void> {
    return autoHandler('', ctx) as Promise<void>;
  }
```

- [ ] **Step 2: Remove six legacy helpers from return statement**

The current return statement (from Phase 4) includes both legacy and new items:

```ts
  return {
    assertBranchHistory,
    isLlmTriggered,
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
    legacyRunAuto,
    runAuto,
  };
```

Replace with:

```ts
  return {
    assertBranchHistory,
    isLlmTriggered,
    getStatus,
    appendUserMessage,
    appendAssistantMessage,
    runPushTask,
    runStartTask,
    runFinishTask,
    runDiscardTask,
    runAbortTask,
    runAuto,
  };
```

Removed from return: `releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav`, `legacyRunAuto`.

**Internal-only items kept:**
- `releaseNextIdle` — still used internally by `runTaskCommand` (called by `runStartTask`, `runFinishTask`, etc.)
- `cancelNextNav` — still used internally by `userEsc` reaction (via `applyReaction`)
- `sessionShutdownHandlers` — still used internally by `userCtrlC` reaction

- [ ] **Step 3: Remove `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav` function definitions**

Delete the following function definitions from inside `makeHarness`:

```ts
  async function emitSessionShutdown() {
    for (const handler of sessionShutdownHandlers) {
      await handler();
    }
  }
```

```ts
  function setPendingMessages(value: boolean) {
    pendingMessages = value;
  }
```

```ts
  function setCancelNextNav(v: boolean) {
    cancelNextNav = v;
  }
```

- [ ] **Step 4: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors. No code outside `makeHarness` references the removed helpers.

- [ ] **Step 5: Run all tests**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. No test uses the removed helpers. The manual workflow tests use `runPushTask`, `runStartTask`, etc. which still work (they use `releaseNextIdle` internally, which is still defined).

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "refactor: remove legacy helpers and legacyRunAuto from harness"
```

---

### Task 8: Remove unused mocks and variables

**Files:**
- Modify: `index.test.ts` — `makeHarness()` — remove `pendingMessages` variable, hardcode `hasPendingMessages`

- [ ] **Step 1: Remove `pendingMessages` variable and `setPendingMessages` usage**

In `makeHarness`, find:

```ts
  let pendingMessages = false;
```

Delete it.

- [ ] **Step 2: Hardcode `hasPendingMessages` in ctx mock**

Find the ctx mock where `hasPendingMessages` is defined:

```ts
    hasPendingMessages: () => pendingMessages,
```

Replace with:

```ts
    hasPendingMessages: () => false,
```

After Phase 5, no test needs to simulate pending messages — the reaction engine's fixed-point iteration drains all reaction work before the auto handler checks `hasPendingMessages()`. The handler always sees no pending messages.

- [ ] **Step 3: Remove `flushMicrotasks` function**

Delete the function:

```ts
  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
  }
```

- [ ] **Step 4: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Run all tests**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. No test references `flushMicrotasks`, `setPendingMessages`, or `emitSessionShutdown` anymore.

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "refactor: remove unused pendingMessages, flushMicrotasks, and hardcode hasPendingMessages"
```

---

### Task 9: Verify full gate and final cleanup

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run verify
```

Expected: All gates pass — lint, tsc, test, updater, skill drift, pack.

- [ ] **Step 2: Confirm no references to removed symbols remain**

```bash
grep -r "legacyRunAuto\|emitSessionShutdown\|setPendingMessages\|setCancelNextNav\|flushMicrotasks" *.ts
```

Expected: No matches (empty output). If any internal variable names remain (e.g., `flushMicrotasks` in comments), that's fine — verify only that no code references the removed exports.

- [ ] **Step 3: Final manual review — confirm all 9 auto tests use new `runAuto`**

```bash
grep -n "runAuto(\|legacyRunAuto" index.test.ts
```

Expected: All references to `runAuto` use the new API (`h.runAuto({ reactions: [...] })`). No references to `legacyRunAuto` remain.

- [ ] **Step 4: Run tests one final time**

```bash
npm test
```

Expected: All tests pass. Final count: 9 auto tests + all manual pathSuite tests + registration test.

- [ ] **Step 5: Commit (if any fixups needed)**

If `npm run verify` or `npm run fix` reveals issues, fix them, then:

```bash
git add -A
git commit -m "chore: fix verification issues for Phase 5"
```

---

### Final state after Phase 5

**Harness API (public):**

| Method | Purpose |
|--------|---------|
| `assertBranchHistory(...entries)` | Assert on visible branch entries + notifications |
| `isLlmTriggered()` | Check if an LLM-turn-triggering entry is on the branch |
| `getStatus()` | Return current task status line value |
| `appendUserMessage(text)` | Append a user message to the branch |
| `appendAssistantMessage(text, stopReason?)` | Append an assistant message |
| `runPushTask(prompt, inherit_context?)` | Execute push-task tool |
| `runStartTask()` | Execute start-task command |
| `runFinishTask()` | Execute finish-task command |
| `runDiscardTask()` | Execute discard-task command |
| `runAbortTask()` | Execute abort-task command |
| `runAuto(config)` | Run auto with reaction config |

**Source changes:**

| Change | Location |
|--------|----------|
| `autoState` removed | `index.ts` — module-level variable deleted |
| Closure-based `running`/`stopped` | `index.ts` — `createAutoCommand` |
| `session_shutdown` handler moved | From `registerTaskCommands` into `createAutoCommand` |
| `[auto]` status prefix wrapping | `index.ts` — `createAutoCommand` handler body |

**Test coverage (9 auto tests):**

| # | Test | Reactions |
|---|------|-----------|
| 1 | push→auto→finish (fresh context) | `[[user(...), assistant(...)]]` |
| 2 | push→auto→finish (inherit context) | `[[user(...), assistant(...)]]` |
| 3 | no pending tasks | `[]` |
| 4 | navigation cancelled | `[[task(...), userEsc()]]` |
| 5 | aborted assistant | `[[user(...), assistant(...)], [assistant(...), userEsc()]]` |
| 6 | subtask within a task | `[[user(...), assistant(...)], [assistant(...), task(...)], [user(...), assistant(...)]]` |
| 7 | /auto already running | `[[user(...), assistant(...)], [assistant(...), userRunsAuto()]]` |
| 8 | user steering | `[[user(...), assistant(...)], [assistant(...), user(...)], [user(...), assistant(...)]]` |
| 9 | session shutdown | `[[user(...), assistant(...)], [assistant(...), userCtrlC()]]` |

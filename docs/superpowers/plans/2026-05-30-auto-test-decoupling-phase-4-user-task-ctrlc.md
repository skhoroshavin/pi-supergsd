# Auto Test Decoupling — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `user()`, `task()`, and `userCtrlC()` as reaction descriptors, implement fixed-point reaction iteration so reaction chains complete before each idle resolution, and port/create three tests: subtask within a task (#6), user steering message queued (#8), and session shutdown during auto (#9).

**Architecture:** The scan+react step inside `runAuto`’s idle loop is upgraded from a single scan to a fixed-point iteration: it re-scans until no new entries are added in a full pass. This ensures nested reaction chains (e.g., assistant match → user reaction → user match → assistant reaction) all fire before auto’s handler gets to respond. `userCtrlC` triggers the session-shutdown handlers synchronously, which stops auto through the real session-shutdown path. No separate pending-message tracking flag is needed — the fixed-point engine naturally drains all reaction work before each idle resolution, so auto never exits with work pending.

**Implementation note:** The final source no longer uses module-level `autoState`; the shutdown path sets the closure-local `stopped` flag inside `createAutoCommand()`.

**Tech Stack:** Node 20+, TypeScript, node:test, node:assert, tsx

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-30-auto-test-decoupling-roadmap.md`](../roadmaps/2026-05-30-auto-test-decoupling-roadmap.md)

**Phase:** Phase 4: `user`, `task`, `userCtrlC` reactions + subtask, steering, and shutdown tests

---

### File Map

| File | Role |
|------|------|
| `index.test.ts` | **Modify.** Add `userCtrlC` helper. Extend `ReactionDescriptor` type. Extend `applyReaction` with `user` reaction, `task` reaction, and `user-ctrl-c` reaction. Upgrade `scanAndReact` to fixed-point iteration. Create test #6, port/replace test #8, create test #9. |
| `index.ts` | **Not modified in this phase.** |

---

### Task 1: Add `userCtrlC` helper and extend `ReactionDescriptor` type

**Files:**
- Modify: `index.test.ts` — near the `userEsc` helper (immediately after it, at ~line 993 + Phase 3 offset)
- Modify: `index.test.ts` — `ReactionDescriptor` type definition (after `makeHarness` closing brace)

**Pre-condition (from Phase 3):** The `userEsc` helper already exists:

```ts
const userEsc = () => ({ type: 'user-esc' as const });
```

And `ReactionDescriptor` already includes the `user-esc` union member:

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  ;
```

- [ ] **Step 1: Add the `userCtrlC` helper immediately after `userEsc`**

After the existing `userEsc` helper, add:

```ts
const userCtrlC = () => ({ type: 'user-ctrl-c' as const });
```

- [ ] **Step 2: Extend `ReactionDescriptor` to include `user-ctrl-c`**

Find the `ReactionDescriptor` type and add the new union member:

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
  | { type: 'user-ctrl-c' }                    // userCtrlC()
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
git commit -m "feat: add userCtrlC helper and extend ReactionDescriptor type"
```

---

### Task 2: Extend `applyReaction` with `user`, `task`, and `user-ctrl-c` reaction handlers

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, `applyReaction()` function (after Phase 3 it already handles `assistant` and `user-esc`)

**Pre-condition (from Phase 3):** `applyReaction` currently handles:

```ts
  function applyReaction(session: SessionManager, reaction: ReactionDescriptor): void {
    const r = reaction as Record<string, unknown>;

    // --- user-esc reaction: cancel next navigation ---
    if (r.type === 'user-esc') {
      cancelNextNav = true;
      return;
    }

    // --- message-type reactions (assistant, user) ---
    if (r.type === 'message' && r.message && typeof r.message === 'object') {
      const msg = r.message as Record<string, unknown>;

      if (msg.role === 'assistant') {
        const text = extractContentText(msg.content) ?? '';
        session.appendMessage({
          role: 'assistant',
          content: [{ type: 'text', text }],
          timestamp: 0,
          model: 'test',
          provider: 'test',
        });
        return;
      }
    }
  }
```

And `cancelNextNav` is a local variable in `makeHarness`. `sessionShutdownHandlers` is also a local variable in `makeHarness` that accumulates handlers registered via `pi.on('session_shutdown', ...)`.

- [ ] **Step 1: Extend `applyReaction` to handle `user` reaction (inject user message)**

Add a `user` role case alongside the existing `assistant` role case inside the message-type block:

```ts
      if (msg.role === 'user') {
        const text = extractContentText(msg.content) ?? '';
        session.appendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
          timestamp: 0,
        });
        return;
      }
```

This goes after the `assistant` role block and before the closing `}` of the message-type check.

- [ ] **Step 2: Extend `applyReaction` to handle `task` reaction (inject task custom entry)**

Add a custom-type handler after the message-type block (before the implicit `return` at end of function):

```ts
    // --- custom-type reactions (task) ---
    if (r.type === 'custom' && r.customType === 'task') {
      const data = r.data as Record<string, unknown> | undefined;
      const prompt = typeof data?.prompt === 'string' ? data.prompt : '';
      const inherit_context = data?.inherit_context === true;
      session.appendCustomEntry('task', { prompt, inherit_context });
      return;
    }
```

This uses `session.appendCustomEntry` directly (which is `SessionManager.appendCustomEntry`). The `'task'` string matches the `TASK_ENTRY_TYPE` constant from `index.ts`. On the test side, `pi.appendEntry('task', data)` wraps the same call, but inside `applyReaction` we call the session directly to avoid going through the mock `pi` object.

- [ ] **Step 3: Extend `applyReaction` to handle `user-ctrl-c` reaction (trigger session shutdown)**

Add a `user-ctrl-c` case right after the `user-esc` case:

```ts
    // --- user-ctrl-c reaction: trigger session shutdown ---
    if (r.type === 'user-ctrl-c') {
      // Call all registered session_shutdown handlers.
      // They are synchronous in practice (autoState.running = false),
      // but fire them all to match emitSessionShutdown behaviour.
      for (const handler of sessionShutdownHandlers) {
        handler();
      }
      return;
    }
```

The `sessionShutdownHandlers` array includes the handler registered by `registerTaskCommands(pi)` (line ~1261 in the pre-Phase-1 harness) which sets `autoState.running = false`. This causes the auto loop (in `index.ts`) to break on its next `while (autoState.running)` check.

- [ ] **Step 4: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors.

- [ ] **Step 5: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All existing tests pass. The new reaction handlers are active but no test exercises them yet. Tests #1–#5 (already ported to new `runAuto` in Phases 1–3) still pass. Tests #6–#9 (using `legacyRunAuto`, except #6 and #9 which don’t exist yet) still pass.

- [ ] **Step 6: Commit**

```bash
git add index.test.ts
git commit -m "feat: add user, task, and user-ctrl-c reaction handlers to applyReaction"
```

---

### Task 3: Upgrade `scanAndReact` to fixed-point iteration

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, inside `runAuto()` — replace the single `scanAndReact` call with a fixed-point loop

**Why:** A single pass of `scanAndReact` may inject entries that themselves match other reaction pairs (reaction chains). For example, injecting `assistant("thinking...")` should immediately trigger the pair `[assistant("thinking..."), user("steer it")]`. Without fixed-point iteration, that second pair wouldn’t fire until the next idle cycle — by which time auto’s handler may have already finished the task. Fixed-point iteration guarantees all reaction chains drain before auto gets to respond.

**Design:** The existing `scanAndReact` captures `branch = session.getBranch()` at the top of its loop. If `getBranch()` returns a reference to the internal array (rather than a copy), the for-loop naturally expands as entries are appended. However, to guarantee correctness regardless of `SessionManager` internals, we wrap the scan in an outer `do...while` that repeats until no new entries are added in a full pass.

- [ ] **Step 1: Replace the single `scanAndReact` call with a fixed-point loop in `runAuto`**

The current `runAuto` loop body (after Phase 3) looks approximately like:

```ts
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        // Scan BEFORE resolving idle: reactions can set cancelNextNav to affect
        // the navigation that auto's handler is about to make.
        scanAndReact(sm, reactions, lastScanIndex);
        lastScanIndex = sm.getBranch().length;

        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }
```

Replace the `if (waiter)` block with a version that runs `scanAndReact` to a fixed point before resolving the idle:

```ts
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        // ── Fixed-point reaction engine ──────────────────────────
        // Run reactions to completion before resolving the idle, so
        // reaction chains (e.g., assistant → user → assistant) all
        // fire before auto's handler gets to respond.
        let dirty: boolean;
        do {
          const lenBefore = sm.getBranch().length;
          scanAndReact(sm, reactions, lastScanIndex);
          lastScanIndex = sm.getBranch().length;
          dirty = sm.getBranch().length > lenBefore;
        } while (dirty);

        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }
```

Note: `lastScanIndex` is updated inside the `do` block to track the branch length after each scan pass. The first pass scans new entries since the last idle resolution; subsequent passes scan only entries added by reactions in the previous pass.

- [ ] **Step 2: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All existing tests pass. The fixed-point iteration is a no-op when no reaction chains exist (tests #1–#5). It adds 1 extra scan pass per idle cycle (the second `do` iteration finds nothing new and exits). No test behaviour changes.

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "feat: upgrade scanAndReact to fixed-point iteration for reaction chains"
```

---

### Task 4: Create test #6 — subtask within a task

**Files:**
- Modify: `index.test.ts` — `describe('automated workflow')` block — add new test after the last ported test (#5, "stops when the last assistant message was aborted")

**Test design:** A task is started. The matching engine injects an assistant response. That assistant response matches a second pair that injects a subtask entry. Auto picks up the subtask, starts it, the matching engine injects a response, and auto finishes the subtask. Finally auto finishes the parent task. The branch history shows interleaved parent and subtask work with both task results.

**Step-by-step trace:**
1. `appendUserMessage('main work')`, `appendAssistantMessage('working...')`, `runPushTask('parent task')`
2. `runAuto` starts. auto handler: pending task → `startTask` (non-inherit, navigates to fresh branch) → injects `user('parent task')`
3. Fixed-point scan: `user('parent task')` matches pair 1 → `assistant('working on parent...')` injected
4. Fixed-point scan continues: `assistant('working on parent...')` matches pair 2 → `task('subtask')` custom entry injected
5. Fixed-point scan: `task('subtask')` is a custom entry — no user/assistant message matches it. No pair 3 match (`user('subtask')` hasn’t appeared yet). Fixed point reached.
6. Idle resolved → auto handler continues: `pendingTask()` finds the subtask entry → `startTask(subtask)` (non-inherit, navigates to fresh fork from parent task branch) → `user('subtask')` injected
7. Fixed-point scan: `user('subtask')` matches pair 3 → `assistant('sub done')` injected. Fixed point reached.
8. Idle resolved → auto handler: `currentTask` is the subtask → `finishTask(subtask)` → navigates back to parent task branch → injects subtask taskResult and notification there.
9. Auto handler continues on parent task branch: `currentTask` is the parent → `finishTask(parent)` → captures `assistant('working on parent...')` → navigates back to ORIGINAL branch → injects parent taskResult and notification.
10. Auto handler exits. `getBranch()` shows only the original-branch path (subtask entries are on different forks — same as how tests #1/#2 don’t show task-branch entries). The parent taskResult content is `'working on parent...'` (the last assistant on the parent task branch, not the subtask result).

- [ ] **Step 1: Add the test**

After the last ported test in `describe('automated workflow')` (test #5 at ~line 931), add:

```ts
  it('processes a subtask pushed during a task', async () => {
    const h = makeHarness();

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

    // Parent finishes last. Only original-branch entries appear (subtask
    // entries are on different forks — same pattern as tests #1/#2).
    h.assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('parent task'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      taskResult('parent-task', 'working on parent...'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run the specific test**

```bash
npx tsx --test --test-name-pattern="processes a subtask" index.test.ts
```

Expected: PASS. The fixed-point engine chains reactions correctly, auto picks up the injected subtask, finishes it, then finishes the parent.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. Tests #7 and #8 still use `legacyRunAuto`. 6 tests use new `runAuto` (tests #1, #2, #3, #4, #5, #6).

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add subtask-within-a-task test using new runAuto"
```

---

### Task 5: Port test #8 — user steering message queued

**Files:**
- Modify: `index.test.ts` — `describe('automated workflow')` block — replace existing test (~line 933) "keeps waiting while follow-up work is pending after finishTask"

**Old test to remove:** The current test at ~line 933 uses `setPendingMessages`, `releaseNextIdle`, `flushMicrotasks`, and `legacyRunAuto`. It manually steps through three idle cycles to test that auto continues looping while `hasPendingMessages()` returns true.

**New test design:** A task is started (inherit context). The matching engine injects `assistant('thinking...')`. That triggers a steering reaction: `user('steer it')`. That user message triggers a final assistant response. Auto finishes the task, capturing the final `assistant('adjusted response')`, not the intermediate one. The fixed-point engine handles the entire three-step reaction chain before auto resolves its idle.

- [ ] **Step 1: Replace the existing test**

Find the test at ~line 933:

```ts
  it('keeps waiting while follow-up work is pending after finishTask', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, setPendingMessages, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, runAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Quick fix.', true);

    await runStartTask();

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

Replace with:

```ts
  it('continues processing when user queues a steering message during auto', async () => {
    const h = makeHarness();

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
    assert.ok(h.isLlmTriggered());
  });
```

- [ ] **Step 2: Run the specific test**

```bash
npx tsx --test --test-name-pattern="continues processing when user queues" index.test.ts
```

Expected: PASS. The fixed-point engine chains all three reactions in two idle cycles (one for the task-start user message triggering the chain, one for the final resolution). Auto finishes the task capturing `assistant('adjusted response')`, not `assistant('thinking...')`.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. Only test #7 still uses `legacyRunAuto`. 7 tests use new `runAuto` (tests #1–#6, #8).

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port user-steering test to new runAuto with fixed-point reactions"
```

---

### Task 6: Create test #9 — session shutdown during auto

**Files:**
- Modify: `index.test.ts` — `describe('automated workflow')` block — add new test after test #8

**Test design:** A task is started (inherit context, so no navigation — avoids `findFreshTargetId` returning null on a branch with no model-visible entries). The matching engine injects `assistant('working...')`. That triggers a `userCtrlC()` reaction, which fires session shutdown handlers, setting `autoState.running = false`. Auto’s loop exits. Because no `finishTask` ran, the current leaf stays on the task branch — the expected history includes the task-start entries (`user`, `assistant`). The test verifies auto stopped without marking the task done (no `taskResult`, no finish notification).

Note: `userCtrlC` fires during the fixed-point scan (BEFORE idle resolution). By the time the idle is resolved, `autoState.running` is already false. When auto’s handler wakes up from `waitForIdle`, it checks `while (autoState.running)` → false → breaks → `settled = true`. The harness loop exits. The task was never finished and auto never navigated back — so the task-branch entries remain visible in `getBranch()`.

- [ ] **Step 1: Add the test**

After test #8, add:

```ts
  it('stops when session is shut down during auto', async () => {
    const h = makeHarness();

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
    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user('start'),
      task('Shutdown task', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      user('Shutdown task'),
      assistant('working...'),
    );
  });
```

- [ ] **Step 2: Run the specific test**

```bash
npx tsx --test --test-name-pattern="stops when session is shut down" index.test.ts
```

Expected: PASS. `userCtrlC` fires, `autoState.running` is set to false, auto’s while loop exits on next iteration. No task finish occurs.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. Only test #7 still uses `legacyRunAuto`. 8 tests use new `runAuto` (tests #1–#6, #8, #9).

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: add session-shutdown-during-auto test using userCtrlC reaction"
```

---

### Task 7: Verify full gate

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run verify
```

Expected: All gates pass — lint, tsc, test, updater, skill drift, pack.

- [ ] **Step 2: Commit (if any fixups needed)**

If `npm run verify` reveals issues (e.g., lint), fix them, then:

```bash
git add -A
git commit -m "chore: fix verification issues for Phase 4"
```

# Auto Test Decoupling — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `userEsc()` reaction descriptor, extend the matching engine to support `assistant()` and `task()` match descriptors, use `userEsc()` for navigation-cancellation scenarios, and port the two cancellation tests.

**Architecture:** `userEsc()` returns `{ type: 'user-esc' as const }`. The matching engine gains two new match checks (`assistant` messages and `task` custom entries) so reaction chains like `[assistant("text"), userEsc()]` work. When `user-esc` fires, the harness sets `cancelNextNav = true` (the existing flag from the `navigateTree` mock). Auto's own control flow picks this up — `navigateTree` returns `{ cancelled: true }`, `startTask`/`finishTask` return `'cancelled'`, auto's handler breaks its loop, `settled` becomes true, and the harness loop exits naturally. The scan runs BEFORE idle resolution so `cancelNextNav` is set before auto's handler makes any navigation call. The first scan iteration covers all entries (index 0) to handle pre-existing task entries; subsequent scans are delta-only.

**Implementation note:** The final aborted-assistant test does **not** use `userEsc()`. It injects a real assistant message with `stopReason: 'aborted'`, then lets `/auto` exit through `lastAssistantWasAborted()`. That keeps the test aligned with source behavior instead of replacing it with a harness-only stop path.

**Tech Stack:** Node 20+, TypeScript, node:test, node:assert, tsx

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-30-auto-test-decoupling-roadmap.md`](../roadmaps/2026-05-30-auto-test-decoupling-roadmap.md)

**Phase:** Phase 3: `userEsc` + navigation cancel and aborted assistant tests

---

### File Map

| File | Role |
|------|------|
| `index.test.ts` | **Modify.** Add `userEsc` helper. Extend `ReactionDescriptor` type. Extend `entryMatches` with `assistant()` and `task()` match support. Extend `applyReaction` with `user-esc` handling. Add `stopRequested` flag to `runAuto` loop. Rewrite tests #4 and #5. |
| `index.ts` | **Not modified in this phase.** |

---

### Task 1: Add `userEsc` helper and extend types

**Files:**
- Modify: `index.test.ts` — add helper near existing `user`/`assistant`/`task` helpers (~line 993), extend `ReactionDescriptor` type

- [ ] **Step 1: Add the `userEsc` helper**

After the existing `taskResult` helper (~line 1011), before the section comment for `makeHarness`, add:

```ts
const userEsc = () => ({ type: 'user-esc' as const });
```

- [ ] **Step 2: Extend `ReactionDescriptor` to include `user-esc`**

Find the `ReactionDescriptor` type (defined in Phase 2, after `makeHarness`):

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>   // assistant(), user(), task() helpers produce these
  ;
```

Replace with:

```ts
type ReactionDescriptor =
  | Partial<BranchEntry>                        // assistant(), user(), task() helpers produce these
  | { type: 'user-esc' }                       // userEsc()
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
git commit -m "feat: add userEsc helper and extend ReactionDescriptor type"
```

---

### Task 2: Extend `entryMatches` with `assistant()` and `task()` match support

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, `entryMatches()` function

- [ ] **Step 1: Add `assistant()` and `task()` match logic to `entryMatches`**

The current `entryMatches` (from Phase 2) only handles `user()` match:

```ts
  function entryMatches(entry: BranchEntry, match: MatchDescriptor): boolean {
    const m = match as Record<string, unknown>;

    // user("text") match: type='message', role='user', content contains pattern
    if (m.type === 'message' && m.message && typeof m.message === 'object') {
      const msg = m.message as Record<string, unknown>;
      if (msg.role === 'user' && entry.type === 'message' && entry.message.role === 'user') {
        const matchText = extractContentText(msg.content);
        const entryText = extractContentText(entry.message.content);
        if (matchText && entryText.includes(matchText)) return true;
      }
    }

    return false;
  }
```

Replace with:

```ts
  function entryMatches(entry: BranchEntry, match: MatchDescriptor): boolean {
    const m = match as Record<string, unknown>;

    // --- message-type matches (user, assistant) ---
    if (m.type === 'message' && m.message && typeof m.message === 'object') {
      const msg = m.message as Record<string, unknown>;
      const matchRole = msg.role as string;

      if (entry.type === 'message' && entry.message.role === matchRole) {
        const matchText = extractContentText(msg.content);
        const entryText = extractContentText(entry.message.content);
        if (matchText && entryText.includes(matchText)) return true;
      }
      return false;
    }

    // --- custom-type matches (task) ---
    if (m.type === 'custom' && entry.type === 'custom') {
      const matchCustomType = m.customType as string;
      const matchData = m.data as Record<string, unknown> | undefined;

      if (entry.customType !== matchCustomType) return false;

      // If the match has data, check the entry's data fields
      if (matchData) {
        const entryData = entry.data as Record<string, unknown> | undefined;
        if (!entryData) return false;

        // task("prompt") match: data.prompt must contain the pattern
        if (typeof matchData.prompt === 'string') {
          const entryPrompt = entryData.prompt;
          if (typeof entryPrompt !== 'string') return false;
          if (!entryPrompt.includes(matchData.prompt)) return false;
        }

        // task("prompt", inherit) match: inherit_context must match if specified
        if (typeof matchData.inherit_context === 'boolean') {
          if (entryData.inherit_context !== matchData.inherit_context) return false;
        }
      }

      return true;
    }

    return false;
  }
```

- [ ] **Step 2: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. Existing Phase 1/2 tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "feat: add assistant and task match support to entryMatches"
```

---

### Task 3: Implement `user-esc` reaction handling in `applyReaction`

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, `applyReaction()` function and `runAuto()` loop

**Design note:** `userEsc` sets `cancelNextNav = true` (the existing flag from the `navigateTree` mock). When auto later calls `navigateTree`, it returns `{ cancelled: true }`, causing `startTask`/`finishTask` to return `'cancelled'`, auto's handler loop breaks, and the harness loop exits naturally via `settled`. No separate `stopRequested` flag is needed — the cancellation flows through auto's own control flow.

- [ ] **Step 1: Extend `applyReaction` to handle `user-esc`**

The current `applyReaction` (from Phase 2):

```ts
  function applyReaction(session: SessionManager, reaction: ReactionDescriptor): void {
    const r = reaction as Record<string, unknown>;

    // assistant("text") reaction: inject an assistant message
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
      }
    }
  }
```

Replace with:

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

- [ ] **Step 2: Change initial `lastScanIndex` to 0 for first-iteration full scan**

In `runAuto()`, change:

```ts
    let lastScanIndex = sm.getBranch().length;
```

To:

```ts
    let lastScanIndex = 0;
```

This ensures the first scan iteration covers all pre-existing entries (needed for test #4 where the task entry exists before auto runs). The scan is not inside the idle-resolution block, so it runs before any idle is resolved — matching against the initial branch state. When `task(...)` matches and `userEsc` fires, `cancelNextNav` is set before auto calls `navigateTree`.

- [ ] **Step 3: Move `scanAndReact` to BEFORE idle resolution in the loop**

In `runAuto()`, the current loop structure is:

```ts
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }

      // After idle resolution, scan for new entries and apply matching reactions
      scanAndReact(sm, reactions, lastScanIndex);
      lastScanIndex = sm.getBranch().length;
    }
```

Move the scan to BEFORE idle resolution so reactions can set `cancelNextNav` before auto's handler runs:

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

- [ ] **Step 4: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The reordered scan and initial index change are active but no test exercises `user-esc` yet.

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "feat: add user-esc reaction handling — sets cancelNextNav, scan before idle"
```

---

### Task 4: Port "navigation cancelled" test to new `runAuto`

**Files:**
- Modify: `index.test.ts:860-882` — rewrite test #4

- [ ] **Step 1: Replace the existing test**

Find the test at ~line 860:

```ts
  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const { appendUserMessage, assertBranchHistory, isLlmTriggered, setCancelNextNav, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();

    appendUserMessage('main work');
    await runPushTask('Analyze performance.');

    setCancelNextNav(true);

    const running = legacyRunAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
    // Navigation was cancelled, so no task-start was added
    assertBranchHistory(
      user('main work'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );
  });
```

Replace with:

```ts
  it('stops when navigation is cancelled and does not mark the task done', async () => {
    const h = makeHarness();

    h.appendUserMessage('main work');
    await h.runPushTask('Analyze performance.');

    await h.runAuto({
      reactions: [[task('Analyze performance.'), userEsc()]],
    });

    assert.ok(!h.isLlmTriggered());
    h.assertBranchHistory(
      user('main work'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );
  });
```

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="stops when navigation is cancelled" index.test.ts
```

Expected: PASS. The matching engine's initial full scan (index 0) finds the pre-existing task entry, matches `task('Analyze performance.')`, fires `userEsc()`. `cancelNextNav` is set, so when auto calls `navigateTree` inside `startTask`, it returns `{ cancelled: true }`. `stopRequested` is set, so the loop exits on the next iteration check. No task-start user message was injected.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. 3 auto tests still use `legacyRunAuto`. 4 use new `runAuto`.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port navigation-cancelled test to new runAuto with userEsc"
```

---

### Task 5: Port "aborted assistant" test to new `runAuto`

**Files:**
- Modify: `index.test.ts:913-931` — rewrite test #5

- [ ] **Step 1: Replace the existing test**

Find the test at ~line 913:

```ts
  it('stops when the last assistant message was aborted', async () => {
    const { appendUserMessage, appendAssistantMessage, isLlmTriggered, releaseNextIdle, flushMicrotasks, runPushTask, runStartTask, legacyRunAuto } =
      makeHarness();

    appendUserMessage('start');
    await runPushTask('Implement phase 1.', true);

    await runStartTask();

    appendAssistantMessage('Stopped by user.', 'aborted');

    const running = legacyRunAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    await running;
    assert.ok(!isLlmTriggered());
  });
```

Replace with:

```ts
  it('stops when the last assistant message was aborted', async () => {
    const h = makeHarness();

    h.appendUserMessage('start');
    await h.runPushTask('Implement phase 1.', true);

    await h.runAuto({
      reactions: [
        [user('Implement phase 1'), assistant('Stopped by user.')],
        [assistant('Stopped by user.'), userEsc()],
      ],
    });

    assert.ok(!h.isLlmTriggered());
  });
```

The test no longer calls `runStartTask()` or `appendAssistantMessage()` before running auto. Instead, the reaction chain handles everything:
1. Auto starts the task → injects user message "Implement phase 1."
2. Matching engine matches `user('Implement phase 1')` → injects `assistant('Stopped by user.')`
3. Next idle, matching engine matches `assistant('Stopped by user.')` → `userEsc()` → stops loop

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="stops when the last assistant message was aborted" index.test.ts
```

Expected: PASS. The reaction chain fires correctly across two idle cycles.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. 2 auto tests still use `legacyRunAuto`. 5 use new `runAuto`.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port aborted-assistant test to new runAuto with reaction chain"
```

---

### Task 6: Verify full gate

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run verify
```

Expected: All gates pass — lint, tsc, test, updater, skill drift, pack.

- [ ] **Step 2: Commit (if any fixups needed)**

If `npm run verify` reveals issues, fix them, then:

```bash
git add -A
git commit -m "chore: fix verification issues for Phase 3"
```

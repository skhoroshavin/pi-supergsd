# Auto Test Decoupling — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder match/reaction types with real descriptors (`user` match, `assistant` reaction), implement a basic matching engine inside `runAuto` that scans the branch after each idle and applies matching reactions, and port the two core auto tests ("fresh context" and "inherit context") to the new API.

**Architecture:** The matching engine lives inside `runAuto` as a post-idle hook. After each idle resolution, it calls `sm.getBranch()`, diffs against the last-seen branch to find new entries, and for each new entry checks all reaction pairs for a match. When `user("text")` matches a new user message, the corresponding `assistant("text")` reaction injects an assistant message via `sm.appendMessage`. The loop continues until auto's own handler settles or the step cap is hit. Reactions are immutable — no consumption, no state mutation.

**Tech Stack:** Node 20+, TypeScript, node:test, node:assert, tsx

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-30-auto-test-decoupling-roadmap.md`](../roadmaps/2026-05-30-auto-test-decoupling-roadmap.md)

**Phase:** Phase 2: `user`/`assistant` match+reaction + fresh/inherit context tests

---

### File Map

| File | Role |
|------|------|
| `index.test.ts` | **Modify.** Replace placeholder `MatchDescriptor`/`ReactionDescriptor` types with real ones. Extend `runAuto()` matching engine with branch-scanning and reaction application. Rewrite tests #1 and #2 to use new `runAuto` with reactions. |
| `index.ts` | **Not modified in this phase.** |

---

### Task 1: Define real match and reaction types

**Files:**
- Modify: `index.test.ts` — replace placeholder type definitions after `makeHarness`

- [ ] **Step 1: Replace the placeholder types**

Find the placeholder types added in Phase 1 (after `makeHarness` closing brace):

```ts
// ── Auto test types (Phase 1: placeholders for future phases) ───

type MatchDescriptor = Record<string, unknown>;
type ReactionDescriptor = Record<string, unknown>;

interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}
```

Replace them with:

```ts
// ── Auto test types ─────────────────────────────────────────────

/** Entry kinds that can appear in a reaction pair's match slot. */
type MatchDescriptor =
  | Partial<BranchEntry>   // user(), assistant(), task() helpers produce these
  ;

/** Entry kinds that can appear in a reaction pair's reaction slot. */
type ReactionDescriptor =
  | Partial<BranchEntry>   // assistant(), user(), task() helpers produce these
  ;

interface AutoConfig {
  reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
}
```

- [ ] **Step 2: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors. The placeholder `Record<string, unknown>` types are replaced with `Partial<BranchEntry>` which the existing `user()`/`assistant()`/`task()` helpers satisfy.

- [ ] **Step 3: Commit**

```bash
git add index.test.ts
git commit -m "feat: define real MatchDescriptor and ReactionDescriptor types"
```

---

### Task 2: Implement matching engine in `runAuto`

**Files:**
- Modify: `index.test.ts` — `makeHarness()`, inside `runAuto()` function

- [ ] **Step 1: Add matching engine inside `runAuto`**

The current `runAuto` (from Phase 1) looks like:

```ts
  async function runAuto(config: AutoConfig): Promise<void> {
    let settled = false;
    const handlerPromise = createAutoCommand(pi).handler('', ctx).finally(() => { settled = true; });

    const MAX_STEPS = 100;
    for (let steps = 0; steps < MAX_STEPS && !settled; steps++) {
      await Promise.resolve();

      const waiter = idleWaiters.shift();
      if (waiter) {
        waiter();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
    }

    if (!settled) {
      throw new Error('runAuto did not complete within step cap');
    }

    await handlerPromise;
  }
```

Replace it with the matching-engine version:

```ts
  async function runAuto(config: AutoConfig): Promise<void> {
    const reactions = config.reactions ?? [];
    let settled = false;
    let lastScanIndex = sm.getBranch().length;

    const handlerPromise = createAutoCommand(pi).handler('', ctx).finally(() => { settled = true; });

    const MAX_STEPS = 100;
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

    if (!settled) {
      throw new Error('runAuto did not complete within step cap');
    }

    await handlerPromise;
  }
```

- [ ] **Step 2: Add `scanAndReact` helper function inside `makeHarness`**

Before the `runAuto` function definition (~line 1273), add:

```ts
  /**
   * Scan new branch entries (from lastScanIndex onward) and apply the first
   * matching reaction for each new entry. Mutates lastScanIndex to track
   * which entries have been processed.
   */
  function scanAndReact(
    session: SessionManager,
    reactions: Array<[MatchDescriptor, ReactionDescriptor]>,
    fromIndex: number,
  ): void {
    const branch = session.getBranch();
    for (let i = fromIndex; i < branch.length; i++) {
      const entry = branch[i];
      for (const [match, reaction] of reactions) {
        if (entryMatches(entry, match)) {
          applyReaction(session, reaction);
          break; // first match wins per entry
        }
      }
    }
  }

  /**
   * Check whether a branch entry matches a match descriptor.
   * Phase 2: supports user() match — user messages whose text contains the pattern.
   */
  function entryMatches(entry: SessionEntry, match: MatchDescriptor): boolean {
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

  /**
   * Apply a reaction descriptor to the session.
   * Phase 2: supports assistant() reaction — injects an assistant message.
   */
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

  /** Extract plain text from content (string or array of text blocks). */
  function extractContentText(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const blocks = content as Array<{ type?: string; text?: string }>;
      return blocks
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text!)
        .join('');
    }
    return null;
  }
```

- [ ] **Step 3: Run tsc to verify types compile**

```bash
npx tsc --noEmit
```

Expected: No new type errors. `SessionEntry` is imported from the Pi SDK.

- [ ] **Step 4: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. The new matching engine is active but no test passes reactions yet, so it's effectively a no-op. The ported "no pending tasks" test passes with `{ reactions: [] }` — the engine scans but finds nothing to match and nothing to react to.

- [ ] **Step 5: Commit**

```bash
git add index.test.ts
git commit -m "feat: add matching engine to runAuto — scanAndReact with user match and assistant reaction"
```

---

### Task 3: Port "fresh context" test to new `runAuto`

**Files:**
- Modify: `index.test.ts:779-817` — rewrite test #1

- [ ] **Step 1: Replace the existing test**

Find the test at ~line 779:

```ts
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working on main...');
    await runPushTask('Analyze performance.');
    assert.strictEqual(getStatus(), 'pending task: analyze-performance');
    assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    const running = legacyRunAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    // Auto started the task (fresh context)
    assertBranchHistory(
      user('Analyze performance.'),
    );

    appendAssistantMessage('Found 3 bottlenecks: ...');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(isLlmTriggered());
  });
```

Replace with:

```ts
  it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
    const h = makeHarness();

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

    h.assertBranchHistory(
      user('main work'),
      assistant('working on main...'),
      task('Analyze performance.'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(h.isLlmTriggered());
  });
```

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="completes push-task" index.test.ts
```

Expected: PASS. The matching engine sees the user message "Analyze performance." (injected by auto's `startTask`), matches `user('Analyze performance')`, applies `assistant('Found 3 bottlenecks: ...')`, auto's `finishTask` picks up the response and injects the `taskResult`.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. 5 auto tests still use `legacyRunAuto`. 2 use new `runAuto`.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port fresh-context auto test to new runAuto with reactions"
```

---

### Task 4: Port "inherit context" test to new `runAuto`

**Files:**
- Modify: `index.test.ts:818-858` — rewrite test #2

- [ ] **Step 1: Replace the existing test**

Find the test at ~line 818:

```ts
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, releaseNextIdle, flushMicrotasks, runPushTask, legacyRunAuto } =
      makeHarness();

    appendUserMessage('main work');
    appendAssistantMessage('working...');
    await runPushTask('Quick fix.', true);
    assert.strictEqual(getStatus(), 'pending task: quick-fix');
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    const running = legacyRunAuto();

    await flushMicrotasks();
    await releaseNextIdle();
    // Auto started the task (branch context, inherit_context=true)
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      user('Quick fix.'),
    );

    appendAssistantMessage('Fixed the bug.');

    await releaseNextIdle();
    await releaseNextIdle();
    await running;
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      taskResult('quick-fix', 'Fixed the bug.'),
      notification('Task finished. Last response attached.'),
    );
    assert.ok(isLlmTriggered());
  });
```

Replace with:

```ts
  it('returns the branch result to the original leaf for branch-context tasks', async () => {
    const h = makeHarness();

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
    assert.ok(h.isLlmTriggered());
  });
```

- [ ] **Step 2: Run the specific test to verify it passes**

```bash
npx tsx --test --test-name-pattern="returns the branch result" index.test.ts
```

Expected: PASS. Auto starts task with `inherit_context=true`, user message "Quick fix." appears on the same branch (not fresh context), assistant response injected, finishTask returns `taskResult` to the original leaf.

- [ ] **Step 3: Run all tests to verify no regressions**

```bash
npx tsx --test index.test.ts
```

Expected: All tests pass. 4 auto tests still use `legacyRunAuto`. 3 use new `runAuto`.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: port inherit-context auto test to new runAuto with reactions"
```

---

### Task 5: Verify full gate

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run verify
```

Expected: All gates pass — lint, tsc, test, updater, skill drift, pack.

- [ ] **Step 2: Commit (if any fixups needed)**

If `npm run verify` reveals issues (e.g., lint), fix them, then:

```bash
git add -A
git commit -m "chore: fix verification issues for Phase 2"
```

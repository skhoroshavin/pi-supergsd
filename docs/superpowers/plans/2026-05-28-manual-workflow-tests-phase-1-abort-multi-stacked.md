# Phase 1: Abort + Multi-Stacked Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new manual workflow tests — abort with inherited context (1) and multi-stacked push tasks (4 context combos).

**Architecture:** Pure test additions to `index.test.ts`. No source code changes needed — the harness (`makeHarness`) and assertion helpers (`task`, `taskResult`, `notification`, etc.) already support all required operations. The `pendingTask`, `currentTask`, and `abortTask` functions already handle LIFO consumption and context inheritance.

**Tech Stack:** TypeScript, Node 20+, `node:test`, SessionManager (in-memory)

**Roadmap:** [`docs/superpowers/roadmaps/2026-05-28-manual-workflow-tests-roadmap.md`](../roadmaps/2026-05-28-manual-workflow-tests-roadmap.md)

**Phase:** Phase 1: Abort + Multi-stacked tasks

---

## File Structure

**Only file modified:**
- `index.test.ts` — add 5 new `it` blocks under `describe('manual workflow')`, after the existing abort test

**No files created, no files modified outside `index.test.ts`.**

---

### Task 1: Write abort-with-inherited-context test

**Files:**
- Modify: `index.test.ts` — insert after the existing abort test (line ~139)

The existing abort test uses `runPushTask('Quick fix.')` (fresh context, `inherit_context=false`). This variant uses `runPushTask('Quick fix.', true)` so the task inherits branch context. After abort, the task remains pending and can be re-started with the stored `inherit_context=true`.

- [ ] **Step 1: Locate the insertion point**

Read `index.test.ts` to find the end of the existing abort test — it ends around line 139 with a closing `});`. The new test goes right after.

- [ ] **Step 2: Write the test**

Insert the following block after the existing abort test (before the `describe('automated workflow')` block):

```typescript
  it('aborts an in-progress task with inherited context and keeps the task pending for re-execution', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runAbortTask } =
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

    // Start task with inherited context — preserves the chain
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: quick-fix');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      user('Quick fix.'),
    );

    appendAssistantMessage('Partial work...');

    // Abort — navigates back to returnTo, task re-pending
    await runAbortTask();
    assert.strictEqual(getStatus(), 'pending task: quick-fix');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      notification('Task aborted. Branch abandoned without summary.'),
    );

    // Re-start with inherited context (from the stored task entry)
    await runStartTask();
    assert.ok(isLlmTriggered());
    appendAssistantMessage('Full work');
    assert.strictEqual(getStatus(), 'current task: quick-fix');
    assert.ok(!isLlmTriggered());
    assertBranchHistory(
      user('main work'),
      assistant('working...'),
      task('Quick fix.', true),
      user('Quick fix.'),
    );
  });
```

- [ ] **Step 3: Run just this test to verify it passes**

Run: `node --test index.test.ts --test-name-pattern="inherited context and keeps"`

Expected: `pass` — the test should pass because all operations are already implemented in the source code.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: abort with inherited context"
```

---

### Task 2: Write multi-stacked fresh/fresh test

**Files:**
- Modify: `index.test.ts` — insert after the new abort test from Task 1

This tests pushing two tasks, both fresh context. Task two (most recent) is consumed first (LIFO), then task one.

- [ ] **Step 1: Write the test**

Insert the following block after the abort-with-inherited test:

```typescript
  it('handles multiple stacked tasks — both fresh context (LIFO)', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');

    // Push two tasks — they stack (LIFO: most recent consumed first)
    await runPushTask('Task one.');
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runPushTask('Task two.');
    assert.strictEqual(getStatus(), 'pending task: task-two');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      task('Task two.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // Start task two (most recent — LIFO, fresh context)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-two');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Task two.'),
    );

    appendAssistantMessage('Task two done.');

    // Finish task two — navigates back, injects result
    await runFinishTask();
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      task('Task two.'),
      taskResult('task-two', 'Task two done.'),
      notification('Task finished. Last response attached.'),
    );

    // Start task one (now pending, fresh context)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Task one.'),
    );

    appendAssistantMessage('Task one done.');

    // Finish task one
    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      task('Task two.'),
      taskResult('task-two', 'Task two done.'),
      taskResult('task-one', 'Task one done.'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run tests to verify**

Run: `node --test index.test.ts --test-name-pattern="both fresh context"`

Expected: `pass`

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: multi-stacked fresh/fresh task consumption"
```

---

### Task 3: Write multi-stacked fresh/inherited test

**Files:**
- Modify: `index.test.ts` — insert after the fresh/fresh test from Task 2

Task one is fresh context, task two inherits context. Since LIFO, task two (inherited) starts first.

- [ ] **Step 1: Write the test**

Insert the following block after the fresh/fresh test:

```typescript
  it('handles multiple stacked tasks — fresh then inherited context', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');

    await runPushTask('Task one.');
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runPushTask('Task two.', true);
    assert.strictEqual(getStatus(), 'pending task: task-two');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      task('Task two.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // Start task two (LIFO, inherited context)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-two');
    assert.ok(isLlmTriggered());
    // Inherited: preserves prior context + task prompt
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      task('Task two.', true),
      user('Task two.'),
    );

    appendAssistantMessage('Task two done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      task('Task two.', true),
      taskResult('task-two', 'Task two done.'),
      notification('Task finished. Last response attached.'),
    );

    // Start task one (fresh context)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Task one.'),
    );

    appendAssistantMessage('Task one done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.'),
      task('Task two.', true),
      taskResult('task-two', 'Task two done.'),
      taskResult('task-one', 'Task one done.'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run tests to verify**

Run: `node --test index.test.ts --test-name-pattern="fresh then inherited"`

Expected: `pass`

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: multi-stacked fresh/inherited task consumption"
```

---

### Task 4: Write multi-stacked inherited/fresh test

**Files:**
- Modify: `index.test.ts` — insert after the fresh/inherited test from Task 3

Task one is inherited context, task two is fresh context. Since LIFO, task two (fresh) starts first.

- [ ] **Step 1: Write the test**

Insert the following block after the fresh/inherited test:

```typescript
  it('handles multiple stacked tasks — inherited then fresh context', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');

    await runPushTask('Task one.', true);
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runPushTask('Task two.');
    assert.strictEqual(getStatus(), 'pending task: task-two');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      task('Task two.'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // Start task two (LIFO, fresh context)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-two');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('Task two.'),
    );

    appendAssistantMessage('Task two done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.'),
      taskResult('task-two', 'Task two done.'),
      notification('Task finished. Last response attached.'),
    );

    // Start task one (inherited context from stored task entry)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-one');
    assert.ok(isLlmTriggered());
    // Inherited: preserves prior context
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.'),
      user('Task one.'),
    );

    appendAssistantMessage('Task one done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.'),
      taskResult('task-two', 'Task two done.'),
      taskResult('task-one', 'Task one done.'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run tests to verify**

Run: `node --test index.test.ts --test-name-pattern="inherited then fresh"`

Expected: `pass`

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: multi-stacked inherited/fresh task consumption"
```

---

### Task 5: Write multi-stacked inherited/inherited test

**Files:**
- Modify: `index.test.ts` — insert after the inherited/fresh test from Task 4

Both tasks use inherited context.

- [ ] **Step 1: Write the test**

Insert the following block after the inherited/fresh test:

```typescript
  it('handles multiple stacked tasks — both inherited context', async () => {
    const { appendUserMessage, appendAssistantMessage, assertBranchHistory, isLlmTriggered, getStatus, runPushTask, runStartTask, runFinishTask } =
      makeHarness();

    appendUserMessage('main');
    appendAssistantMessage('working...');

    await runPushTask('Task one.', true);
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    await runPushTask('Task two.', true);
    assert.strictEqual(getStatus(), 'pending task: task-two');
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
      task('Task two.', true),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    );

    // Start task two (LIFO, both inherited)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-two');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.', true),
      user('Task two.'),
    );

    appendAssistantMessage('Task two done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), 'pending task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.', true),
      taskResult('task-two', 'Task two done.'),
      notification('Task finished. Last response attached.'),
    );

    // Start task one (inherited)
    await runStartTask();
    assert.strictEqual(getStatus(), 'current task: task-one');
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.', true),
      user('Task one.'),
    );

    appendAssistantMessage('Task one done.');

    await runFinishTask();
    assert.strictEqual(getStatus(), undefined);
    assert.ok(isLlmTriggered());
    assertBranchHistory(
      user('main'),
      assistant('working...'),
      task('Task one.', true),
      task('Task two.', true),
      taskResult('task-two', 'Task two done.'),
      taskResult('task-one', 'Task one done.'),
      notification('Task finished. Last response attached.'),
    );
  });
```

- [ ] **Step 2: Run tests to verify**

Run: `node --test index.test.ts --test-name-pattern="both inherited"`

Expected: `pass`

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add index.test.ts
git commit -m "test: multi-stacked inherited/inherited task consumption"
```

---

### Task 6: Full verification gate

- [ ] **Step 1: Run the verification gate**

Run: `npm run verify`

This runs lint → tsc → test → updater → skill drift → pack. Expected: all pass.

- [ ] **Step 2: If any failures, fix them** (shouldn't need source changes — likely assertion adjustments if a behavior detail differs from expectations)

- [ ] **Step 3: Final commit with meaningful message**

```bash
git add index.test.ts
git commit -m "test: Phase 1 — abort inherited + 4 multi-stacked task tests"
```

# Test Session Status and Notification Assertion Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move task-status assertions into `assertSession(...)`, remove notification entries from visible session assertions, and expose latest notifications only through `lastNotification()` when tests explicitly care about them.

**Architecture:** `TestSession` becomes the single projector for visible test timelines by combining durable branch entries with synthetic `status(...)` entries recorded from `uiContext.setStatus("task", ...)`. Notifications stop participating in `entries()` and are tracked separately as normalized plain text so `TestHarness.lastNotification()` can expose them without polluting session-flow assertions. The workflow suites then migrate from `getStatus()`, `assertTaskStatusHistoryIncludes()`, and `notification(...)` to inline `status(...)` expectations plus explicit `lastNotification()` assertions only on notification-focused paths.

**Tech Stack:** TypeScript, ES modules, Node 20+, `tsx --test`, `node:assert`, Pi extension test helpers

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File structure mapping

- Modify `src/test-helpers/test-session.ts:26-180`
  - Replace notification projection in `entries()` with synthetic status projection.
  - Add exported `status(text?)` helper and `StatusEntry` type.
  - Keep normalized latest-notification tracking available through a getter for the harness.
- Modify `src/test-helpers/index.ts:1-9`
  - Export `status`.
  - Stop exporting `notification`.
- Modify `src/test-helpers/harness.ts:117-140`
  - Remove `getStatus()`.
  - Remove `assertTaskStatusHistoryIncludes()`.
  - Add `lastNotification(): string | undefined`.
- Modify `src/test-helpers/test-session.test.ts:7-98`
  - Replace notification-visibility assertions with inline status-timeline assertions.
  - Add coverage for clear events, duplicate suppression, non-`task` keys, ANSI stripping, and separate notification storage.
- Modify `src/test-helpers/harness.test.ts:5-145`
  - Assert inline status evolution through `assertSession(...)`.
  - Assert `lastNotification()` only on command paths where notification text matters.
- Modify `src/auto.test.ts:9-327`
  - Replace `getStatus()` and `assertTaskStatusHistoryIncludes()` with ordered `status(...)` expectations.
  - Replace visible `notification(...)` expectations with `lastNotification()` only on notification-focused tests.
- Modify `src/manual.test.ts:3-733`
  - Migrate the manual workflow tree to inline `status(...)` expectations.
  - Keep explicit notification assertions only for discard/abort/no-task command outcomes.
- Create `docs/superpowers/plans/2026-06-01-test-session-status-notification-assertion-cleanup.md`
  - Save this implementation plan.

## Task 1: Rework `TestSession` to project inline status entries

**Files:**
- Modify: `src/test-helpers/test-session.test.ts:7-98`
- Modify: `src/test-helpers/test-session.ts:26-180`
- Modify: `src/test-helpers/index.ts:1-9`
- Test: `src/test-helpers/test-session.test.ts`

- [ ] **Step 1: Write the failing `TestSession` unit tests first**

```ts
import { TestSession, assistant, assumeCommandContext, status, task, user } from './index.js';

describe('TestSession', () => {
  it('projects task status changes inline with durable session entries', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    sm.appendCustomEntry('task', {
      prompt: 'Task AAA',
      inherit_context: false,
    });
    session.context.setStatus('task', 'pending task: task-aaa');
    appendAssistant(sm, 'queued');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      task('Task AAA'),
      status('pending task: task-aaa'),
      assistant('queued'),
    ]);
  });

  it('adds status() when task status clears', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'Task AAA');
    session.context.setStatus('task', 'current task: task-aaa');
    appendAssistant(sm, 'Done.');
    session.context.setStatus('task', undefined);

    assert.deepStrictEqual(session.entries(), [
      user('Task AAA'),
      status('current task: task-aaa'),
      assistant('Done.'),
      status(),
    ]);
  });

  it('suppresses duplicate consecutive task statuses and ignores non-task keys', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    session.context.setStatus('other', 'ignored');
    session.context.setStatus('task', 'pending task: task-aaa');
    session.context.setStatus('task', 'pending task: task-aaa');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      status('pending task: task-aaa'),
    ]);
  });

  it('normalizes ANSI styling in stored task statuses and notifications', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    session.context.setStatus('task', session.context.theme.fg('dim', 'pending task: task-aaa'));
    session.context.notify(session.context.theme.fg('warning', 'warn once'), 'warning');

    assert.deepStrictEqual(session.entries(), [status('pending task: task-aaa')]);
    assert.strictEqual(session.lastNotification, 'warn once');
  });

  it('keeps notifications out of visible session assertions', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    session.context.notify('Task stored. Use `/start-task` or `/auto` to start it.');

    assert.deepStrictEqual(session.entries(), [user('main work')]);
    assert.strictEqual(
      session.lastNotification,
      'Task stored. Use `/start-task` or `/auto` to start it.',
    );
  });
});
```

- [ ] **Step 2: Run the focused unit file and confirm the new expectations fail**

Run: `npx tsx --test src/test-helpers/test-session.test.ts`

Expected: FAIL with at least one of these signals:
- `The requested module './index.js' does not provide an export named 'status'`
- deep-equality mismatches because `entries()` still emits `notification(...)` instead of `status(...)`
- `Property 'lastNotification' does not exist on type 'TestSession'`

- [ ] **Step 3: Implement the status timeline and notification separation in `src/test-helpers/test-session.ts` and `src/test-helpers/index.ts`**

```ts
export class TestSession {
  constructor(private readonly sessionManager: SessionManager) {}

  #lastNotification: string | undefined;
  #lastStatus: string | undefined;
  #statusEntries: TrackedStatusEntry[] = [];

  readonly context: ExtensionUIContext = {
    ...noOpContext,
    notify: (message: string) => {
      const nextNotification = plainText(message).trim();
      this.#lastNotification = nextNotification === '' ? undefined : nextNotification;
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== 'task') return;

      const nextStatus = value === undefined ? undefined : plainText(value);
      if (nextStatus === this.#lastStatus) return;

      this.#lastStatus = nextStatus;
      this.#statusEntries.push({
        anchorEntryId: this.sessionManager.getLeafId() ?? null,
        entry: status(nextStatus),
      });
    },
  };

  entries(): SessionEntry[] {
    return projectEntries(this.sessionManager.getBranch(), this.#statusEntries);
  }

  get lastNotification(): string | undefined {
    return this.#lastNotification;
  }
}

export type SessionEntry =
  | ReturnType<typeof user>
  | ReturnType<typeof assistant>
  | ReturnType<typeof task>
  | ReturnType<typeof taskResult>
  | StatusEntry;

export type StatusEntry = { type: 'status'; text?: string };

export const status = (text?: string): StatusEntry =>
  text === undefined ? { type: 'status' } : { type: 'status', text };

function projectEntries(
  branch: PiSessionEntry[],
  trackedStatuses: readonly TrackedStatusEntry[],
): SessionEntry[] {
  const result: SessionEntry[] = [];

  for (const branchEntry of branch) {
    const durable = toDurableEntry(branchEntry);
    if (durable !== null) result.push(durable);

    for (const tracked of trackedStatuses) {
      if (tracked.anchorEntryId !== branchEntry.id) continue;
      if (sameStatus(result.at(-1), tracked.entry)) continue;
      result.push(tracked.entry);
    }
  }

  for (const tracked of trackedStatuses) {
    if (tracked.anchorEntryId !== null) continue;
    if (sameStatus(result.at(-1), tracked.entry)) continue;
    result.unshift(tracked.entry);
  }

  return result;
}

function sameStatus(left: SessionEntry | undefined, right: StatusEntry): boolean {
  return left?.type === 'status' && left.text === right.text;
}

type TrackedStatusEntry = {
  anchorEntryId: string | null;
  entry: StatusEntry;
};
```

```ts
export {
  assistant,
  assumeCommandContext,
  status,
  task,
  taskResult,
  user,
  TestSession,
} from './test-session.js';
```

- [ ] **Step 4: Re-run the focused unit file until it passes**

Run: `npm run fix && npx tsx --test src/test-helpers/test-session.test.ts`

Expected: PASS for every `TestSession` case, including the new `status(...)` and `lastNotification` coverage.

- [ ] **Step 5: Commit the helper-model checkpoint**

```bash
git add src/test-helpers/test-session.ts src/test-helpers/index.ts src/test-helpers/test-session.test.ts
git commit -m "refactor: project task status inline in test sessions"
```

## Task 2: Remove obsolete harness status helpers and expose `lastNotification()`

**Files:**
- Modify: `src/test-helpers/harness.test.ts:5-145`
- Modify: `src/test-helpers/harness.ts:117-140`
- Test: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Update the harness integration tests to the new API before touching the harness**

```ts
import {
  aborts,
  assistant,
  pushTask,
  responds,
  status,
  task,
  thinks,
  user,
  userPrompts,
  TestHarness,
} from './index.js';

describe('AgentSession-backed TestHarness foundation', () => {
  it('creates a real session and registers push-task through the extension', async (t) => {
    const h = await makeHarness(t);
    assert.ok(h.registeredToolNames().includes('push-task'));
    assert.strictEqual(h.lastNotification(), undefined);
  });

  it('slash-prefixed prompts go through the real slash pipeline', async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt('/start-task', responds('literal slash prompt'));

    await h.prompt('/start-task');

    h.assertSession();
    assert.strictEqual(h.lastNotification(), 'No pending task. Use push-task first.');
  });

  it('calls the real push-task tool from a faux provider tool call', async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt('delegate work', pushTask('subtask', true));

    await h.prompt('delegate work');

    h.assertSession(
      user('delegate work'),
      assistant('', 'toolUse'),
      task('subtask', true),
      status('pending task: subtask'),
    );
    assert.strictEqual(h.lastNotification(), 'Task stored. Use `/start-task` or `/auto` to start it.');
  });

  it('fires assistant and queued-task user actions once per new entry', async (t) => {
    const h = await makeHarness(t);
    h.llm.onPrompt('main work', responds('working...'));
    h.user.onAssistant('working...', userPrompts('queue follow-up'));
    h.llm.onPrompt('queue follow-up', pushTask('follow-up'));
    h.user.onQueuedTask('follow-up', userPrompts('answer follow-up'));
    h.llm.onPrompt('answer follow-up', responds('queued response'));

    await h.prompt('main work');
    await h.waitForIdle();

    h.assertSession(
      user('main work'),
      assistant('working...'),
      user('queue follow-up'),
      assistant('', 'toolUse'),
      task('follow-up'),
      status('pending task: follow-up'),
      user('answer follow-up'),
      assistant('queued response'),
    );
  });
});
```

- [ ] **Step 2: Run the harness integration file and confirm the missing method failures**

Run: `npx tsx --test src/test-helpers/harness.test.ts`

Expected: FAIL with `Property 'lastNotification' does not exist on type 'TestHarness'` and/or deep-equality mismatches from missing `status(...)` entries.

- [ ] **Step 3: Remove `getStatus()` / `assertTaskStatusHistoryIncludes()` and add `lastNotification()` in `src/test-helpers/harness.ts`**

```ts
export class TestHarness {
  dispose(): void {
    this.fauxProvider.unregister();
    this.session.dispose();
  }

  lastNotification(): string | undefined {
    return this.testSession.lastNotification;
  }

  assertSession(...expected: TestSessionEntry[]): void {
    assert.deepStrictEqual(this.testSession.entries(), expected);
  }

  assertSessionContains(...expected: DurableSessionEntry[]): void {
    const actual = durableEntries(this.sessionManager.getEntries());
    for (const expectedEntry of expected) {
      assert.ok(
        actual.some((entry) => isDeepStrictEqual(entry, expectedEntry)),
        `Expected session to contain entry: ${JSON.stringify(expectedEntry)}`,
      );
    }
  }

  async waitForIdle(): Promise<void> {
    await this.scanAndReactLoop();
  }
}
```

- [ ] **Step 4: Re-run the harness integration file until it passes**

Run: `npm run fix && npx tsx --test src/test-helpers/harness.test.ts`

Expected: PASS with the harness suite proving `assertSession(...)` + `status(...)` and `lastNotification()` cover the old helper use cases.

- [ ] **Step 5: Commit the harness API cleanup**

```bash
git add src/test-helpers/harness.ts src/test-helpers/harness.test.ts
git commit -m "refactor: replace harness status probes with lastNotification"
```

## Task 3: Migrate `src/auto.test.ts` to inline status evolution

**Files:**
- Modify: `src/auto.test.ts:9-327`
- Test: `src/auto.test.ts`

- [ ] **Step 1: Rewrite the auto-workflow expectations so they fail against the old helper usage**

```ts
import {
  aborts,
  assistant,
  assumeCommandContext,
  responds,
  pushTask,
  status,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userPrompts,
  TestHarness,
} from './test-helpers/index.js';

it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
  const h = await TestHarness.create();
  h.llm.onPrompt('main work', responds('working on main...'));
  h.llm.onPrompt('Analyze performance.', responds('Found 3 bottlenecks: ...'));
  h.llm.onPrompt('Found 3 bottlenecks: ...', responds(''));
  h.llm.onPrompt('working on main...', responds(''));
  h.llm.onPrompt('queue analyze', pushTask('Analyze performance.'));
  try {
    await h.prompt('main work');
    await h.prompt('queue analyze');
    await h.prompt('/auto');

    h.assertSession(
      user('main work'),
      assistant('working on main...'),
      user('queue analyze'),
      assistant('', 'toolUse'),
      task('Analyze performance.'),
      status('pending task: analyze-performance'),
      status('[auto] pending task: analyze-performance'),
      taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
      status(),
      assistant(''),
    );
  } finally {
    h.dispose();
  }
});

it('notifies and exits when started with no pending tasks', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('/auto');
    h.assertSession();
    assert.strictEqual(h.lastNotification(), 'No pending tasks to run.');
  } finally {
    h.dispose();
  }
});

it('stops when the last assistant message was aborted', async () => {
  const h = await TestHarness.create();
  h.llm.onPrompt('start', responds(''));
  h.llm.onPrompt('', responds(''));
  h.llm.onPrompt('Implement phase 1.', aborts('Stopped by user.'));
  h.llm.onPrompt('queue implement', pushTask('Implement phase 1.', true));
  try {
    await h.prompt('start');
    await h.prompt('queue implement');
    await h.prompt('/auto');

    h.assertSession(
      user('start'),
      assistant(''),
      user('queue implement'),
      assistant('', 'toolUse'),
      task('Implement phase 1.', true),
      status('pending task: implement-phase-1'),
      status('[auto] pending task: implement-phase-1'),
      user('Implement phase 1.'),
      status('[auto] current task: implement-phase-1'),
      assistant('Stopped by user.', 'aborted'),
      status('current task: implement-phase-1'),
    );
  } finally {
    h.dispose();
  }
});
```

- [ ] **Step 2: Run the auto-workflow file and confirm the old helpers are the failing point**

Run: `npx tsx --test src/auto.test.ts`

Expected: FAIL because `getStatus()` and `assertTaskStatusHistoryIncludes()` are gone and because several `assertSession(...)` expectations still assume visible `notification(...)` entries.

- [ ] **Step 3: Replace every old status/notification assertion in `src/auto.test.ts`**

Use these exact replacements while editing the file:

```ts
// Navigation-cancelled branch at src/auto.test.ts:84-106
h.assertSession(
  user('main work'),
  assistant(''),
  user('queue analyze'),
  assistant('', 'toolUse'),
  task('Analyze performance.'),
  status('pending task: analyze-performance'),
  status('[auto] pending task: analyze-performance'),
  status('pending task: analyze-performance'),
);

// No-task and already-running notification paths at src/auto.test.ts:108-116 and 181-207
h.assertSession();
assert.strictEqual(h.lastNotification(), 'No pending tasks to run.');
assert.strictEqual(h.lastNotification(), 'Auto is already running.');

// Shutdown-during-auto branch at src/auto.test.ts:301-327
h.assertSession(
  user('start'),
  assistant(''),
  user('queue shutdown'),
  assistant('', 'toolUse'),
  task('Shutdown task', true),
  status('pending task: shutdown-task'),
  status('[auto] pending task: shutdown-task'),
  user('Shutdown task'),
  status('[auto] current task: shutdown-task'),
  assistant('working...'),
  status('current task: shutdown-task'),
);
```

After those edits, remove every remaining `assert.strictEqual(h.getStatus(), ...)` and `h.assertTaskStatusHistoryIncludes(...)` call from the file.

- [ ] **Step 4: Re-run the auto-workflow file until it passes**

Run: `npm run fix && npx tsx --test src/auto.test.ts`

Expected: PASS with the auto suite proving status evolution is fully asserted through `assertSession(...)` and notification text is only checked on the explicit warning/info paths.

- [ ] **Step 5: Commit the auto-workflow migration**

```bash
git add src/auto.test.ts
git commit -m "test: inline auto workflow task status assertions"
```

## Task 4: Migrate `src/manual.test.ts` to inline status evolution and explicit notification checks

**Files:**
- Modify: `src/manual.test.ts:3-733`
- Test: `src/manual.test.ts`

- [ ] **Step 1: Update the manual workflow tree expectations before running the file**

```ts
import {
  assistant,
  node,
  responds,
  pushTask,
  status,
  TestNode,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';
```

Apply these exact expectation shapes in the listed sections:

```ts
// Queueing a non-inherit AAA task (lines 19-35)
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  status('pending task: task-aaa'),
);

// Queueing an inherit-context AAA task (lines 335-350)
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  status('pending task: task-aaa'),
);

// Queueing nested BBB tasks (lines 139-150, 232-243, 467-481, 572-586)
h.assertSession(
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB'),
  status('pending task: task-bbb'),
);

h.assertSession(
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB', true),
  status('pending task: task-bbb'),
);

// Starting a task on a fresh branch (lines 46-49, 121-124, 176-179)
h.assertSession(user('Task AAA'), status('current task: task-aaa'), assistant('Done.'));

// Starting an inherit-context task on the same branch (lines 362-371, 443-452, 510-513, 615-629)
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  status('pending task: task-aaa'),
  user('Task AAA'),
  status('current task: task-aaa'),
  assistant('Done.'),
);

// Finishing a non-inherit AAA task back to the parent branch (lines 51-60, 126-135, 165-173, 218-227, 257-266, 319-328)
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  status('pending task: task-aaa'),
  taskResult('task-aaa', 'Done.'),
  status(),
  assistant('Great!'),
);

// Finishing an inherit-context AAA task back to the parent branch (lines 373-382, 455-463, 498-507, 558-567, 603-612, 674-683)
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  status('pending task: task-aaa'),
  taskResult('task-aaa', 'Done.'),
  status(),
  assistant('Great!'),
);

// Finishing nested BBB back into active AAA (lines 181-203, 515-540)
h.assertSession(
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB'),
  status('pending task: task-bbb'),
  taskResult('task-bbb', 'inner done'),
  status('current task: task-aaa'),
  assistant('Great!'),
);

// Finishing inherit-context BBB back into active AAA (lines 282-304, 631-656)
h.assertSession(
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB', true),
  status('pending task: task-bbb'),
  taskResult('task-bbb', 'inner done'),
  status('current task: task-aaa'),
  assistant('Great!'),
);
```

- [ ] **Step 2: Move notification assertions out of `assertSession(...)` and onto `lastNotification()`**

Use these exact replacements in the notification-focused nodes:

```ts
// Non-inherit discard / abort nodes
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  status('pending task: task-aaa'),
);
assert.strictEqual(h.lastNotification(), 'Task discarded.');

h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  status('pending task: task-aaa'),
);
assert.strictEqual(h.lastNotification(), 'Task aborted. Branch abandoned without summary.');

// Inherit-context discard / abort nodes
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  status('pending task: task-aaa'),
);
assert.strictEqual(h.lastNotification(), 'Task discarded.');

h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  status('pending task: task-aaa'),
);
assert.strictEqual(h.lastNotification(), 'Task aborted. Branch abandoned without summary.');

// Top-level no-task commands
h.assertSession(user('main work'), assistant('working...'));
assert.strictEqual(h.lastNotification(), 'No pending task. Use push-task first.');
assert.strictEqual(h.lastNotification(), 'No pending task to discard.');
assert.strictEqual(h.lastNotification(), 'Not inside task, nothing to finish.');
assert.strictEqual(h.lastNotification(), 'Not inside task, nothing to abort.');
```

Edit these exact ranges while applying that pattern:
- `src/manual.test.ts:36-45`
- `src/manual.test.ts:62-109`
- `src/manual.test.ts:111-119`
- `src/manual.test.ts:152-162`
- `src/manual.test.ts:206-216`
- `src/manual.test.ts:245-255`
- `src/manual.test.ts:307-317`
- `src/manual.test.ts:352-360`
- `src/manual.test.ts:384-430`
- `src/manual.test.ts:433-441`
- `src/manual.test.ts:483-496`
- `src/manual.test.ts:543-556`
- `src/manual.test.ts:588-601`
- `src/manual.test.ts:659-672`
- `src/manual.test.ts:690-731`

- [ ] **Step 3: Run the manual workflow tree, then search for any stale helper usage**

Run: `npx tsx --test src/manual.test.ts ; rg -n "getStatus\(|assertTaskStatusHistoryIncludes\(|notification\(" src/manual.test.ts || true`

Expected:
- the first run may FAIL on whichever branch still has stale status or notification assertions
- once the migration is complete, the test file PASSes and the `rg` command prints no matches

- [ ] **Step 4: Re-run the manual workflow tree after formatting**

Run: `npm run fix && npx tsx --test src/manual.test.ts`

Expected: PASS across the full manual workflow tree, including nested BBB branches and inherit-context scenarios.

- [ ] **Step 5: Commit the manual workflow migration**

```bash
git add src/manual.test.ts
git commit -m "test: inline manual workflow task status assertions"
```

## Task 5: Run the full gate, review the diff against the spec, and create the final commit

**Files:**
- Modify: `src/test-helpers/test-session.ts`
- Modify: `src/test-helpers/harness.ts`
- Modify: `src/test-helpers/index.ts`
- Modify: `src/test-helpers/test-session.test.ts`
- Modify: `src/test-helpers/harness.test.ts`
- Modify: `src/auto.test.ts`
- Modify: `src/manual.test.ts`
- Test: `src/test-helpers/test-session.test.ts`
- Test: `src/test-helpers/harness.test.ts`
- Test: `src/auto.test.ts`
- Test: `src/manual.test.ts`

- [ ] **Step 1: Run the focused test files together before the full gate**

Run: `npx tsx --test src/test-helpers/test-session.test.ts src/test-helpers/harness.test.ts src/auto.test.ts src/manual.test.ts`

Expected: PASS for the helper suite plus both workflow suites.

- [ ] **Step 2: Run the required autofix command before full verification**

Run: `npm run fix`

Expected: Prettier and ESLint complete without leaving unformatted `.ts` files.

- [ ] **Step 3: Run the full project gate from `AGENTS.md`**

Run: `npm run verify`

Expected: PASS for `npx tsc --noEmit`, ESLint, all tests, `npm run updater`, and `prettier --check '**/*.ts'`.

- [ ] **Step 4: Compare the finished diff to the approved spec before committing**

Run: `git diff --stat && git diff -- src/test-helpers/test-session.ts src/test-helpers/harness.ts src/test-helpers/index.ts src/test-helpers/test-session.test.ts src/test-helpers/harness.test.ts src/auto.test.ts src/manual.test.ts`

Expected: The diff shows exactly these scope items and nothing else:
- `TestHarness.getStatus()` removed
- `TestHarness.assertTaskStatusHistoryIncludes()` removed
- `status(text?)` available for `assertSession(...)`
- `notification(...)` removed from visible session assertions
- `TestHarness.lastNotification()` added
- helper and workflow tests asserting inline status evolution and notification text only when intentionally needed

- [ ] **Step 5: Create the final commit**

```bash
git add src/test-helpers/test-session.ts src/test-helpers/harness.ts src/test-helpers/index.ts src/test-helpers/test-session.test.ts src/test-helpers/harness.test.ts src/auto.test.ts src/manual.test.ts
git commit -m "test: inline session status assertions and isolate notifications"
```

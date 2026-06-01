# Unified Visible Session Assertions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace split branch-history and notification assertions with one visible-session assertion backed by `TestSession`, while keeping `assertSessionContains(...)` as a temporary durable whole-session compatibility helper.

**Architecture:** Introduce `src/test-helpers/test-session.ts` as the single test-visible session model. It will own descriptor constructors, UI notification/status capture, and notification anchoring/merge logic; `TestHarness` will delegate current-branch visible assertions to `TestSession.entries()` and durable whole-session containment checks to a shared durable-entry projection built from `sessionManager.getEntries()`.

**Tech Stack:** TypeScript, Node 20+, `tsx --test`, Node `assert`, `@earendil-works/pi-coding-agent` `SessionManager`

**Roadmap:** None

**Phase:** Single-plan implementation

---

## Spec review

- No critical blocker in `docs/superpowers/specs/2026-05-31-unified-visible-history.md`.
- The main regression risk is notification ordering around hidden `task-start` / `task-done` entries and branch switches, so the plan starts with focused `TestSession` tests before refactoring `TestHarness`.
- `assertSessionContains(...)` must stay durable-only and whole-session, so the harness work needs explicit compatibility coverage before old assertion APIs are removed.

## File structure

### Create
- `src/test-helpers/test-session.ts` — canonical visible-session model, descriptor constructors, `assumeCommandContext(...)`, durable-entry projection helper, and notification merge logic.
- `src/test-helpers/test-session.test.ts` — focused unit tests for notification anchoring/merging, null-anchor behavior, branch omission, and compatibility exports.

### Modify
- `src/test-helpers/harness.ts` — wire `TestSession` into `bindExtensions(...)`, add `assertSession(...)`, keep `assertSessionContains(...)` durable whole-session, and temporarily retain wrappers needed until the workflow tests are migrated.
- `src/test-helpers/index.ts` — re-export `assistant(...)`, `user(...)`, `task(...)`, `taskResult(...)`, `notification(...)`, and `assumeCommandContext(...)` from `test-session.ts`.
- `src/test-helpers/harness.test.ts` — migrate to `assertSession(...)`; add focused compatibility coverage for whole-session `assertSessionContains(...)`.
- `src/auto.test.ts` — migrate current-branch assertions to `assertSession(...)`; leave `assertSessionContains(...)` only where the test intentionally inspects non-current-branch durable history.
- `src/manual.test.ts` — migrate tree workflow assertions to `assertSession(...)`, including finish/abort/discard cases where notifications must appear between durable entries.

### Remove
- `src/test-helpers/descriptors.ts` — folded into `test-session.ts` after all callers move.
- `src/test-helpers/ui.ts` — folded into `test-session.ts` after `TestHarness` stops using it.

## Task 1: Add `TestSession` and focused merge tests

**Files:**
- Create: `src/test-helpers/test-session.ts`
- Create: `src/test-helpers/test-session.test.ts`
- Modify: `src/test-helpers/index.ts`

- [ ] **Step 1: Write the failing `TestSession` tests**

```ts
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { SessionManager } from '@earendil-works/pi-coding-agent';

import {
  TestSession,
  assistant,
  assumeCommandContext,
  notification,
  task,
  user,
} from './test-session.js';

const text = (value: string) => [{ type: 'text' as const, text: value }];

function appendUser(sm: SessionManager, value: string): string {
  return sm.appendMessage({
    role: 'user',
    content: text(value),
    timestamp: new Date(0).toISOString(),
  });
}

function appendAssistant(
  sm: SessionManager,
  value: string,
  stopReason: 'stop' | 'toolUse' | 'aborted' = 'stop',
): string {
  return sm.appendMessage({
    role: 'assistant',
    content: text(value),
    stopReason,
    timestamp: new Date(0).toISOString(),
  });
}

describe('TestSession', () => {
  it('places a notification immediately after its visible anchor', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    sm.appendCustomEntry('task', { prompt: 'Task AAA', inherit_context: false });
    session.context.notify('Task stored. Use `/start-task` or `/auto` to start it.');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      task('Task AAA'),
      notification('Task stored. Use `/start-task` or `/auto` to start it.'),
    ]);
  });

  it('keeps notifications anchored to hidden entries in the right visible slot', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'Task AAA');
    appendAssistant(sm, 'Done.');
    sm.appendCustomEntry('task-done', {});
    session.context.notify('Task finished. Last response attached.');
    appendAssistant(sm, 'Great!');

    assert.deepStrictEqual(session.entries(), [
      user('Task AAA'),
      assistant('Done.'),
      notification('Task finished. Last response attached.'),
      assistant('Great!'),
    ]);
  });

  it('preserves emission order for multiple notifications on one anchor', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    session.context.notify('first');
    session.context.notify('second');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      notification('first'),
      notification('second'),
    ]);
  });

  it('omits notifications anchored to entries outside the current branch', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    const rootId = appendUser(sm, 'main work');
    appendAssistant(sm, 'branch A');
    session.context.notify('branch A note');

    sm.branch(rootId);
    appendAssistant(sm, 'branch B');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      assistant('branch B'),
    ]);
  });

  it('prepends null-anchor notifications before branch content', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    session.context.notify('bootstrap');
    appendUser(sm, 'main work');

    assert.deepStrictEqual(session.entries(), [
      notification('bootstrap'),
      user('main work'),
    ]);
  });

  it('accepts notification levels without exposing them in visible assertions', () => {
    const sm = SessionManager.inMemory();
    const session = new TestSession(sm);

    appendUser(sm, 'main work');
    session.context.notify('warn once', 'warning');

    assert.deepStrictEqual(session.entries(), [
      user('main work'),
      notification('warn once'),
    ]);
  });

  it('keeps assumeCommandContext available from the new module', () => {
    const value = { hasUI: true, navigateTree: async () => ({ cancelled: false }) };
    assert.strictEqual(assumeCommandContext(value), value);
  });
});
```

- [ ] **Step 2: Run the new unit test file and verify it fails**

Run: `npx tsx --test src/test-helpers/test-session.test.ts`

Expected: FAIL with `Cannot find module './test-session.js'` or missing export failures for `TestSession` / `notification`.

- [ ] **Step 3: Implement `TestSession` and re-export its public helpers**

```ts
import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  SessionEntry as PiSessionEntry,
  SessionManager,
  Theme,
} from '@earendil-works/pi-coding-agent';

import { extractTextContent, type TextBlock } from '../text-content.js';

export type NotificationEntry = { type: 'notification'; message: string };
export type SessionEntry =
  | ReturnType<typeof user>
  | ReturnType<typeof assistant>
  | ReturnType<typeof task>
  | ReturnType<typeof taskResult>
  | NotificationEntry;
export type DurableSessionEntry = Exclude<SessionEntry, NotificationEntry>;

export const notification = (message: string): NotificationEntry => ({
  type: 'notification',
  message,
});

export function assumeCommandContext<T extends object>(
  value: T,
): ExtensionCommandContext & T {
  return value as ExtensionCommandContext & T;
}

export function durableEntries(entries: PiSessionEntry[]): DurableSessionEntry[] {
  return entries
    .map(toDurableEntry)
    .filter((entry): entry is DurableSessionEntry => entry !== null);
}

type TrackedNotification = {
  message: string;
  anchorEntryId: string | null;
};

export class TestSession {
  readonly taskStatusHistory: Array<string | undefined> = [];
  readonly theme = {
    fg: (_key: string, text: string) => text,
    bg: (_key: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, 'fg' | 'bg' | 'bold'>;

  #notifications: TrackedNotification[] = [];
  #status: string | undefined;

  constructor(private readonly sessionManager: SessionManager) {}

  get status(): string | undefined {
    return this.#status;
  }

  readonly context: ExtensionUIContext = {
    notify: (message: string) => {
      this.#notifications.push({
        message,
        anchorEntryId: this.sessionManager.getLeafId(),
      });
    },
    setStatus: (key: string, value: string | undefined) => {
      if (key !== 'task') return;
      this.#status = value;
      this.taskStatusHistory.push(value);
    },
    theme: this.theme,
  } as ExtensionUIContext;

  entries(): SessionEntry[] {
    const notificationsByAnchor = new Map<string | null, NotificationEntry[]>();
    for (const item of this.#notifications) {
      const list = notificationsByAnchor.get(item.anchorEntryId) ?? [];
      list.push(notification(item.message));
      notificationsByAnchor.set(item.anchorEntryId, list);
    }

    const merged: SessionEntry[] = [...(notificationsByAnchor.get(null) ?? [])];
    for (const rawEntry of this.sessionManager.getBranch()) {
      const visible = toDurableEntry(rawEntry);
      if (visible) merged.push(visible);
      merged.push(...(notificationsByAnchor.get(rawEntry.id) ?? []));
    }
    return merged;
  }
}

const textBlock = (text: string): TextBlock => ({ type: 'text', text });
```

```ts
export {
  assistant,
  assumeCommandContext,
  notification,
  task,
  taskResult,
  user,
} from './test-session.js';
```

Implementation details to finish in this step:
- Move the existing descriptor logic from `src/test-helpers/descriptors.ts` into `test-session.ts`.
- Rename the imported runtime session type internally to `PiSessionEntry`.
- Keep notification equality public-only on `{ type: 'notification', message }`; do not expose anchor metadata.
- Preserve the existing assistant stop-reason visibility rule (`'stop'` is omitted, non-`'stop'` strings remain visible).

- [ ] **Step 4: Run the focused unit tests again and verify they pass**

Run: `npx tsx --test src/test-helpers/test-session.test.ts`

Expected: PASS for all `TestSession` merge, notification-level tolerance, and compatibility tests.

- [ ] **Step 5: Commit the new visible-session model**

```bash
git add src/test-helpers/test-session.ts src/test-helpers/test-session.test.ts src/test-helpers/index.ts
git commit -m "refactor: add test session visible model"
```

## Task 2: Refactor `TestHarness` to expose `assertSession(...)`

**Files:**
- Modify: `src/test-helpers/harness.ts`
- Modify: `src/test-helpers/harness.test.ts`

- [ ] **Step 1: Rewrite `harness.test.ts` to target the new harness API and legacy compatibility semantics**

```ts
import {
  aborts,
  assistant,
  notification,
  pushTask,
  responds,
  task,
  thinks,
  user,
  userPrompts,
  TestHarness,
} from './index.js';

it('uses MockLLM prompt rules for h.prompt()', async (t) => {
  const h = await makeHarness(t);
  h.llm.onPrompt('main work', responds('working...'));

  await h.prompt('main work');
  h.assertSession(user('main work'), assistant('working...'));
});

it('slash-prefixed prompts go through the real slash pipeline', async (t) => {
  const h = await makeHarness(t);
  h.llm.onPrompt('/start-task', responds('literal slash prompt'));

  await h.prompt('/start-task');

  h.assertSession(notification('No pending task. Use push-task first.'));
});

it('assertSessionContains still scans durable whole-session entries across branches', async (t) => {
  const h = await makeHarness(t);
  h.llm.onPrompt('main work', responds('working...'), pushTask('Task AAA'));
  h.llm.onPrompt('Task AAA', responds('Done.'));

  await h.prompt('main work');
  await h.prompt('/start-task');

  h.assertSession(user('Task AAA'), assistant('Done.'));
  h.assertSessionContains(
    user('main work'),
    assistant('working...', 'toolUse'),
    task('Task AAA'),
  );
});
```

Update the other existing `harness.test.ts` cases in the same pass:
- replace `assertBranchHistory(...)` with `assertSession(...)`
- replace `assertNotifications(...)` / `assertNotificationEntries(...)` with `notification(...)` entries inside `assertSession(...)`
- keep the aborted-response `assertSessionContains(...)` test, because it intentionally checks durable whole-session containment after multiple prompts

- [ ] **Step 2: Run the harness test file and verify it fails against the old harness surface**

Run: `npx tsx --test src/test-helpers/harness.test.ts`

Expected: FAIL with `h.assertSession is not a function` and/or assertion diffs where notifications are still checked separately.

- [ ] **Step 3: Refactor `TestHarness` to delegate to `TestSession`**

```ts
import {
  durableEntries,
  type DurableSessionEntry,
  type NotificationEntry,
  type SessionEntry as TestSessionEntry,
  TestSession,
} from './test-session.js';

export class TestHarness {
  private constructor(
    readonly llm: MockLLM,
    readonly user: MockUser,
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly testSession: TestSession,
    private readonly fauxProvider: FauxProvider,
    private seenReactionEntryIds = new Set<string>(),
    private cancelNextNav = false,
  ) {}

  static async create(): Promise<TestHarness> {
    // ...existing setup...
    const testSession = new TestSession(sessionManager);
    const harness = new TestHarness(
      llm,
      user,
      session,
      sessionManager,
      testSession,
      fauxProvider,
    );
    await session.bindExtensions({
      uiContext: harness.testSession.context,
      commandContextActions: harness.commandContextActions(),
      shutdownHandler: () => {},
    });
    return harness;
  }

  getStatus(): string | undefined {
    return this.testSession.status;
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

  assertTaskStatusHistoryIncludes(expected: string | undefined): void {
    assert.ok(
      this.testSession.taskStatusHistory.includes(expected),
      `Expected task status history to include ${JSON.stringify(expected)}`,
    );
  }

  // Temporary wrappers until src/auto.test.ts and src/manual.test.ts are migrated.
  assertBranchHistory(...expected: DurableSessionEntry[]): void {
    assert.deepStrictEqual(
      this.testSession
        .entries()
        .filter((entry): entry is DurableSessionEntry => entry.type !== 'notification'),
      expected,
    );
  }

  assertNotifications(...expected: string[]): void {
    const actual = this.testSession
      .entries()
      .filter((entry): entry is NotificationEntry => entry.type === 'notification')
      .map((entry) => entry.message);
    for (const message of expected) {
      assert.ok(actual.includes(message), `Expected notification log to include: ${message}`);
    }
  }
}
```

Implementation details to finish in this step:
- Remove `assertNotificationEntries(...)` now; after the test rewrite, nothing should depend on raw level assertions.
- Keep the temporary wrappers only in `harness.ts`; do not re-export new split helpers elsewhere.
- Do not change the scan/react loop or prompt plumbing.

- [ ] **Step 4: Run the harness tests again and verify they pass**

Run: `npx tsx --test src/test-helpers/harness.test.ts`

Expected: PASS, including the whole-session compatibility case that succeeds while the current branch is elsewhere.

- [ ] **Step 5: Commit the harness refactor**

```bash
git add src/test-helpers/harness.ts src/test-helpers/harness.test.ts
git commit -m "refactor: add unified session assertions to harness"
```

## Task 3: Migrate `src/auto.test.ts` to visible-session assertions

**Files:**
- Modify: `src/auto.test.ts`

- [ ] **Step 1: Rewrite current-branch assertions to `assertSession(...)` and use `notification(...)` where the user-visible stream includes one**

```ts
import {
  aborts,
  assistant,
  assumeCommandContext,
  notification,
  responds,
  pushTask,
  task,
  taskResult,
  user,
  userCtrlC,
  userEsc,
  userPrompts,
  TestHarness,
} from './test-helpers/index.js';

it('completes push-task -> /auto -> finish-task and injects the branch result', async () => {
  // ...setup...
  await h.prompt('/auto');

  h.assertTaskStatusHistoryIncludes('[auto] pending task: analyze-performance');
  h.assertSession(
    user('main work'),
    assistant('working on main...'),
    user('queue analyze'),
    assistant('', 'toolUse'),
    task('Analyze performance.'),
    taskResult('analyze-performance', 'Found 3 bottlenecks: ...'),
    notification('Task finished. Last response attached.'),
  );
  assert.strictEqual(h.getStatus(), undefined);
});

it('notifies and exits when started with no pending tasks', async () => {
  const h = await TestHarness.create();
  try {
    await h.prompt('/auto');
    h.assertSession(notification('No pending tasks to run.'));
  } finally {
    h.dispose();
  }
});
```

Keep `assertSessionContains(...)` only where whole-session durability is the point of the test. In this file that means the subtask case should stay whole-session:

```ts
h.assertSessionContains(
  user('subtask'),
  assistant('sub done'),
  taskResult('subtask', 'sub done'),
);
```

- [ ] **Step 2: Run the automated workflow test file and inspect the failures**

Run: `npx tsx --test src/auto.test.ts`

Expected: FAIL anywhere the file still uses split assertions or where a migrated expectation has the notification in the wrong slot.

- [ ] **Step 3: Finish the file migration and correct any ordering mismatches**

Use these exact rewrite patterns throughout `src/auto.test.ts`:

```ts
// Before
h.assertSessionContains(
  user('main work'),
  assistant('working...'),
  user('queue quick-fix'),
  assistant('', 'toolUse'),
  task('Quick fix.', true),
  taskResult('quick-fix', 'Fixed the bug.'),
);
h.assertNotifications('Task finished. Last response attached.');

// After
h.assertSession(
  user('main work'),
  assistant('working...'),
  user('queue quick-fix'),
  assistant('', 'toolUse'),
  task('Quick fix.', true),
  taskResult('quick-fix', 'Fixed the bug.'),
  notification('Task finished. Last response attached.'),
);
```

```ts
// Before
h.assertNotifications('Auto is already running.');
h.assertSessionContains(
  user('start'),
  assistant(''),
  user('queue first'),
  assistant('', 'toolUse'),
  task('first task'),
  taskResult('first-task', 'done'),
);

// After
h.assertSession(
  user('start'),
  assistant(''),
  user('queue first'),
  assistant('', 'toolUse'),
  task('first task'),
  taskResult('first-task', 'done'),
  notification('Auto is already running.'),
);
```

- [ ] **Step 4: Re-run `src/auto.test.ts` and verify it passes**

Run: `npx tsx --test src/auto.test.ts`

Expected: PASS. The only remaining `assertSessionContains(...)` calls should be the intentionally whole-session ones.

- [ ] **Step 5: Commit the auto-workflow migration**

```bash
git add src/auto.test.ts
git commit -m "test: migrate auto workflow to assertSession"
```

## Task 4: Migrate the non-inherit branches in `src/manual.test.ts`

**Files:**
- Modify: `src/manual.test.ts`

- [ ] **Step 1: Rewrite the top-level `push AAA` tree and the standalone no-task cases to `assertSession(...)`**

```ts
import {
  assistant,
  node,
  notification,
  responds,
  pushTask,
  task,
  taskResult,
  user,
} from './test-helpers/index.js';

node('push AAA', async (h) => {
  // ...setup...
  await h.prompt('main work');
  assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
  h.assertSession(
    user('main work'),
    assistant('working...', 'toolUse'),
    task('Task AAA'),
    notification('Task stored. Use `/start-task` or `/auto` to start it.'),
  );
});

node('start [no task]', async (h) => {
  h.llm.onPrompt('main work', responds('working...'));
  await h.prompt('main work');
  await h.prompt('/start-task');
  assert.strictEqual(h.getStatus(), undefined);
  h.assertSession(
    user('main work'),
    assistant('working...'),
    notification('No pending task. Use push-task first.'),
  );
}).run();
```

This pass covers:
- the `push AAA` root node
- its direct `discard AAA`, `start AAA`, `abort AAA`, `push BBB`, and `push BBB [inherit]` descendants where `Task AAA` itself is non-inherit
- the standalone `start/discard/finish/abort [no task]` nodes at the bottom of the file

- [ ] **Step 2: Run `src/manual.test.ts` and capture remaining failures in the non-inherit tree**

Run: `npx tsx --test src/manual.test.ts`

Expected: FAIL on any remaining `assertBranchHistory(...)` / `assertNotifications(...)` pair or on migrated finish-path expectations that still place the notification at the end instead of after the hidden anchor.

- [ ] **Step 3: Fix finish/abort/discard ordering in the non-inherit tree**

Use this exact finish-path shape everywhere the command returns to the parent branch and then emits a notification before a later assistant follow-up:

```ts
// Before
h.assertBranchHistory(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  taskResult('task-aaa', 'Done.'),
  assistant('Great!'),
);
h.assertNotifications('Task finished. Last response attached.');

// After
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  taskResult('task-aaa', 'Done.'),
  notification('Task finished. Last response attached.'),
  assistant('Great!'),
);
```

Use this exact abort/discard shape where the visible branch content stays the same and only a notification is appended to the visible stream:

```ts
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA'),
  notification('Task discarded.'),
);
```

- [ ] **Step 4: Re-run the manual workflow file and verify the non-inherit paths are green before touching the inherit tree**

Run: `npx tsx --test src/manual.test.ts`

Expected: The remaining failures, if any, are confined to the `push AAA [inherit]` tree.

- [ ] **Step 5: Commit the first manual-workflow migration pass**

```bash
git add src/manual.test.ts
git commit -m "test: migrate manual non-inherit workflow to assertSession"
```

## Task 5: Migrate the inherit branches in `src/manual.test.ts`

**Files:**
- Modify: `src/manual.test.ts`

- [ ] **Step 1: Rewrite the `push AAA [inherit]` tree to `assertSession(...)`**

Use these exact shapes for the inherited-task branch:

```ts
node('push AAA [inherit]', async (h) => {
  // ...setup...
  await h.prompt('main work');
  assert.strictEqual(h.getStatus(), 'pending task: task-aaa');
  h.assertSession(
    user('main work'),
    assistant('working...', 'toolUse'),
    task('Task AAA', true),
    notification('Task stored. Use `/start-task` or `/auto` to start it.'),
  );
});
```

```ts
node('start AAA', async (h) => {
  await h.prompt('/start-task');
  assert.strictEqual(h.getStatus(), 'current task: task-aaa');
  h.assertSession(
    user('main work'),
    assistant('working...', 'toolUse'),
    task('Task AAA', true),
    user('Task AAA'),
    assistant('Done.'),
  );
});
```

```ts
node('finish AAA', async (h) => {
  await h.prompt('/finish-task');
  assert.strictEqual(h.getStatus(), undefined);
  h.assertSession(
    user('main work'),
    assistant('working...', 'toolUse'),
    task('Task AAA', true),
    taskResult('task-aaa', 'Done.'),
    notification('Task finished. Last response attached.'),
    assistant('Great!'),
  );
});
```

- [ ] **Step 2: Run `src/manual.test.ts` again and verify only inherit-tree mismatches remain**

Run: `npx tsx --test src/manual.test.ts`

Expected: FAIL only on not-yet-migrated `push BBB` / `push BBB [inherit]` descendants under the inherit tree, or on notification placement within those descendants.

- [ ] **Step 3: Finish the inherited nested-task descendants with the same ordering rules**

Apply these exact rewrite patterns to every remaining inherited descendant:

```ts
// Stored child task while still inside inherited AAA
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB', true),
  notification('Task stored. Use `/start-task` or `/auto` to start it.'),
);
```

```ts
// Finished nested BBB returns to AAA branch, then notification, then later follow-up
h.assertSession(
  user('main work'),
  assistant('working...', 'toolUse'),
  task('Task AAA', true),
  user('Task AAA'),
  assistant('Done.'),
  user('some more work'),
  assistant('okay', 'toolUse'),
  task('Task BBB', true),
  taskResult('task-bbb', 'inner done'),
  notification('Task finished. Last response attached.'),
  assistant('Great!'),
);
```

- [ ] **Step 4: Re-run the manual workflow file and verify it passes completely**

Run: `npx tsx --test src/manual.test.ts`

Expected: PASS for the entire manual workflow tree.

- [ ] **Step 5: Commit the second manual-workflow migration pass**

```bash
git add src/manual.test.ts
git commit -m "test: migrate manual inherit workflow to assertSession"
```

## Task 6: Remove split assertion plumbing and run the full gate

**Files:**
- Modify: `src/test-helpers/harness.ts`
- Modify: `src/test-helpers/index.ts`
- Remove: `src/test-helpers/descriptors.ts`
- Remove: `src/test-helpers/ui.ts`

- [ ] **Step 1: Delete the temporary split-assertion wrappers and switch remaining imports to `test-session.ts`**

```ts
import {
  durableEntries,
  type DurableSessionEntry,
  type SessionEntry as TestSessionEntry,
  TestSession,
} from './test-session.js';

export class TestHarness {
  // ...constructor and setup unchanged...

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
}
```

```ts
export {
  assistant,
  assumeCommandContext,
  notification,
  task,
  taskResult,
  user,
} from './test-session.js';
```

Delete `src/test-helpers/descriptors.ts` and `src/test-helpers/ui.ts` in the same change.

- [ ] **Step 2: Prove the old surface is gone**

Run: `rg -n "assertBranchHistory|assertNotifications|assertNotificationEntries|visibleEntries|BranchEntry|TestUI|notificationLog|descriptors\\.js|ui\\.js" src`

Expected: no matches.

- [ ] **Step 3: Run the focused changed-file tests before the full project gate**

Run: `npx tsx --test src/test-helpers/test-session.test.ts src/test-helpers/harness.test.ts src/auto.test.ts src/manual.test.ts`

Expected: PASS.

- [ ] **Step 4: Run project-required formatting and verification in the correct order**

Run: `npm run fix`
Expected: Prettier writes `.ts` files as needed and ESLint autofixes what it can.

Run: `npm run verify`
Expected: PASS for `tsc`, `eslint`, `npm test`, `npm run updater`, and `prettier --check`.

- [ ] **Step 5: Commit the cleanup and verified refactor**

```bash
git add src/test-helpers/harness.ts src/test-helpers/index.ts src/test-helpers/test-session.ts src/test-helpers/test-session.test.ts src/test-helpers/harness.test.ts src/auto.test.ts src/manual.test.ts
git rm src/test-helpers/descriptors.ts src/test-helpers/ui.ts
git commit -m "refactor: unify visible session assertions"
```

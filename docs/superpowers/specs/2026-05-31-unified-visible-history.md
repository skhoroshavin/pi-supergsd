# Unified visible session assertions for test harness

## Summary

Replace the split test assertions `assertBranchHistory(...)` and `assertNotifications(...)` with a single canonical `assertSession(...)` assertion that models what the user sees: durable branch entries plus ephemeral notifications, interleaved at the correct visible position.

The design introduces a new `src/test-helpers/test-session.ts` module with a `TestSession` class. `TestSession` absorbs the current `TestUI` responsibilities and the visible descriptor/types/helpers currently living in `descriptors.ts`.

## Problem

Today the harness exposes two separate assertions:

- `assertBranchHistory(...)` for visible branch entries reconstructed from `sessionManager.getBranch()`
- `assertNotifications(...)` for UI-side notification presence checks from `TestUI.notificationLog`

That split does not match what the user actually sees. Notifications are visible on screen but are not stored as session entries, so tests cannot assert one ordered visible stream.

The old legacy harness solved this by recording each notification with the session leaf that was current when the notification fired, then merging those notifications back into branch history during assertion.

The current harness lost that placement data, so it can no longer reconstruct the visible session.

## Goals

- Provide one canonical assertion: `assertSession(...)`
- Make `assertSession(...)` represent a stable test abstraction of what the user sees
- Interleave notifications with visible branch entries at the correct position
- Keep production extension behavior unchanged
- Make the visible-session model self-contained and easy to plug into `TestHarness`
- Migrate existing tests to the new assertion and remove the old split assertions

## Non-goals

- Do not make notifications real Pi session entries
- Do not snapshot the literal TUI widget tree
- Do not change runtime extension behavior just to support tests
- Do not remove `assertSessionContains(...)` in this change; keep it temporarily as a legacy compatibility helper

## Proposed module: `src/test-helpers/test-session.ts`

## Responsibilities

`TestSession` becomes the single home for the test-visible session model. It owns:

- UI notification capture
- notification anchoring to the current session leaf
- task status capture and history
- test theme helpers needed by the UI context
- visible descriptor constructors used by tests
- raw-branch to visible-session merge logic

This lets `TestHarness` stay thin:

- construct `TestSession` with the runtime `SessionManager`
- pass `testSession.context` into `bindExtensions(...)`
- delegate `getStatus()` to `testSession.status`
- implement `assertSession(...)` as a wrapper over `testSession.entries()`

## Public API

`TestSession` should expose a shape close to:

```ts
class TestSession {
  constructor(sessionManager: SessionManager)

  readonly context: ExtensionUIContext
  readonly theme: Pick<Theme, "fg" | "bg" | "bold">
  readonly taskStatusHistory: Array<string | undefined>

  get status(): string | undefined
  entries(): SessionEntry[]
}
```

The exported test descriptor surface should also move here:

- `assistant(...)`
- `user(...)`
- `task(...)`
- `taskResult(...)`
- `notification(...)`
- `type SessionEntry`
- `type NotificationEntry`

`src/test-helpers/index.ts` should re-export those helpers from `test-session.ts`.

`assertSessionContains(...)` remains on `TestHarness` temporarily as a legacy compatibility helper.

## Naming

The public test-visible union should be named `SessionEntry`.

Pi already has a runtime `SessionEntry` type, so implementation files should alias that import explicitly:

```ts
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
```

That keeps the external test API short while keeping the runtime/test distinction explicit internally.

## Visible test entry model

The new public union is:

```ts
type SessionEntry =
  | UserEntry
  | AssistantEntry
  | TaskEntry
  | TaskResultEntry
  | NotificationEntry;
```

`NotificationEntry` is a test-friendly visible descriptor, not a durable session entry:

```ts
type NotificationEntry = {
  type: "notification";
  message: string;
};
```

The constructor is:

```ts
notification(message: string)
```

Notification levels may still be passed through the runtime UI API, but they are intentionally not part of the visible test-session assertion model.

Internal placement metadata is not part of the expected test value.

## Internal tracked notification model

When `ctx.ui.notify(...)` fires, `TestSession` should record:

```ts
{
  message: string;
  anchorEntryId: string | null;
}
```

`anchorEntryId` is captured from `sessionManager.getLeafId()` at notify time.

This preserves the old harness behavior while keeping the public test descriptor clean.

## Assertion API

`TestHarness` should expose:

```ts
assertSession(...expected: SessionEntry[]): void
```

This replaces the old visible-session assertion pair:

- remove `assertBranchHistory(...)`
- remove `assertNotifications(...)`

`assertSessionContains(...)` stays for now as a legacy compatibility API during migration, but is no longer the preferred primary assertion and should be considered for later removal.

`assertNotificationEntries(...)` should be removed after migration unless a remaining low-level test proves it still adds value.

## Merge algorithm

`assertSession(...)` should compare against the result of `TestSession.entries()`.

`TestSession.entries()` reconstructs the current visible session from:

1. the raw current branch from `sessionManager.getBranch()`
2. tracked notifications recorded by `notify(...)`

### Rules

1. Iterate raw branch entries in branch order
2. Convert each raw branch entry into a visible test entry using the existing visibility rules
3. Append tracked notifications whose `anchorEntryId === currentRawEntry.id`
4. Preserve notification emission order for notifications sharing the same anchor
5. Prepend notifications with `anchorEntryId === null`
6. Exclude notifications whose anchor is not on the current branch

## Why raw-branch iteration is required

The merge must iterate raw branch entries, not just already-filtered visible entries.

Some notifications are emitted after hidden bookkeeping entries like `task-start` or `task-done`. Those hidden entries still define the correct visual insertion slot. If the merge only walked visible entries, those notifications would drift to the wrong position.

## Semantics of ordering

Ordering is based on the session leaf that existed when the notification fired.

That means `assertSession(...)` reflects the reconstructed visible sequence of events, not just final durable branch contents.

Example: `finishTask(...)` may emit a notification after appending a hidden `task-done` entry but before a later assistant follow-up finishes. In that case the notification belongs before that later assistant message in the visible session assertion.

## Equality semantics

For notifications, assertion equality compares only `message`.

It does not compare internal anchor metadata.

For non-notification entries, existing descriptor equality behavior stays the same.

## Migration plan

All tests currently using split assertions should be rewritten to use `assertSession(...)`.

Example rewrite:

Before:

```ts
h.assertBranchHistory(
  user("main work"),
  assistant("working...", "toolUse"),
  task("Task AAA"),
);
h.assertNotifications(
  "Task stored. Use `/start-task` or `/auto` to start it.",
);
```

After:

```ts
h.assertSession(
  user("main work"),
  assistant("working...", "toolUse"),
  task("Task AAA"),
  notification("Task stored. Use `/start-task` or `/auto` to start it."),
);
```

## Edge cases to cover explicitly

### 1. Notification after visible entry
A notification emitted immediately after a visible `task` entry appears directly after that `task` entry.

### 2. Notification after hidden entry
A notification emitted after a hidden entry like `task-done` still appears at the correct slot because anchoring uses the raw branch entry id.

### 3. Multiple notifications on one anchor
If multiple notifications are emitted against the same `anchorEntryId`, preserve their original emission order.

### 4. Cross-branch notifications
If a notification was anchored to an entry that is not on the current branch, omit it from `entries()`. It does not belong to the current visible branch reconstruction.

### 5. Null anchor
If a notification has `anchorEntryId === null`, treat it as a leading visible item before branch content.


## File-level changes

### Add

- `src/test-helpers/test-session.ts`
- `docs/superpowers/specs/2026-05-31-unified-visible-history.md`

### Update

- `src/test-helpers/harness.ts`
- `src/test-helpers/index.ts`
- tests currently using `assertBranchHistory(...)` and `assertNotifications(...)`

### Remove or fold away

- `src/test-helpers/ui.ts`
- `src/test-helpers/descriptors.ts`
- old assertion methods superseded by `assertSession(...)`

## Testing requirements

Add or update tests to cover:

- `assertSession(...)` with interleaved visible entries and notifications
- notification insertion after a visible anchor
- notification insertion after a hidden anchor
- multiple notifications on the same anchor
- omission of notifications from another branch state
- migration of `src/test-helpers/harness.test.ts`
- migration of `src/manual.test.ts`

## Recommendation

Use a leaf-anchored notification model merged at assertion time.

This preserves the truth that notifications are ephemeral UI effects, avoids inventing fake durable session entries, and still produces one stable assertion for the visible session.

## Out of scope for implementation planning

- any production feature changes
- any TUI rendering changes
- any broader refactor outside the test-visible session boundary

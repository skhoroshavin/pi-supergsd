# Decouple `/auto` tests from internal implementation

## Problem

The `describe('automated workflow')` block in `index.test.ts` uses 6 harness helpers that are tightly coupled to the internal `/auto` implementation: `releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav`, and returning a raw `Promise<void>` from `runAuto`. Tests must manually step through the auto loop's idle/release cycle, set flags on fake internals, and track promise resolution — all of which depend on knowing how the auto loop works internally.

Tests also depend on the module-level `autoState = { running: false }` variable, making them coupled to the state management strategy.

## Goal

- Remove all auto-specific orchestration helpers from the harness (`releaseNextIdle`, `flushMicrotasks`, `emitSessionShutdown`, `setPendingMessages`, `setCancelNextNav`)
- Replace with a single `runAuto(config)` method that runs auto to completion automatically
- Decouple tests from `autoState` by using the status line for observability
- Tests assert on branch history and status — never on internal flags or loop mechanics

## Design

### Source changes (`index.ts`)

1. **Remove module-level `autoState`.** The `{ running: false }` variable at module scope is deleted.

2. **`createAutoCommand` closure** manages its own running state. A local `stopped` flag replaces `autoState.running`. The session shutdown handler sets `stopped = true`; the loop breaks on next iteration.

3. **Status line indicator.** While auto runs, `updateTaskStatus` calls are wrapped to prefix with `'[auto] '` on the existing `'task'` status key. When auto stops, the prefix is removed. No additional status key or line — single key, single line.

   Examples:
   - `[auto] pending task: analyze-performance`
   - `[auto] current task: quick-fix`
   - (auto stopped) `pending task: analyze-performance`

### Test changes (`index.test.ts`)

4. **`runAuto(config)`** — single new harness method. Internally resolves all `waitForIdle()` calls, matches reactions, and injects entries automatically. Hard step cap (~100 idle cycles) — auto always runs to completion or the test fails with a descriptive error. Returns `Promise<void>`.

   ```ts
   interface AutoConfig {
     reactions?: Array<[MatchDescriptor, ReactionDescriptor]>;
   }
   ```

5. **Match descriptors** — reuse existing branch-history helpers:
   - `user("text")` — matches a user message whose text content contains the pattern
   - `assistant("text")` — matches an assistant message whose text content contains the pattern
   - `task("prompt")` / `task("prompt", inherit)` — matches a task custom entry

6. **Reaction descriptors:**
   - `assistant("text")` — inject an assistant message
   - `user("text")` — inject a user message
   - `task("prompt")` / `task("prompt", inherit)` — inject a task entry (equivalent to pushTask)
   - `userEsc()` — cancel the next `navigateTree` call and stop the auto loop; or stop the auto loop immediately if no navigation is pending
   - `userRunsAuto()` — invoke `/auto` again from within the running auto session (used to test the "already running" guard)

   Helper signatures:
   ```ts
   const userEsc = () => ({ type: 'user-esc' as const });
   const userRunsAuto = () => ({ type: 'user-runs-auto' as const });
   ```

7. **Reactions are immutable** — pure stateless matching, no consumption. If the same pattern appears twice on the branch, the same reaction fires each time.

8. **Matching engine.** After each idle resolution, the harness scans the current branch for new entries since the last scan. For each new entry, it finds the first matching reaction pair and applies the reaction. The auto loop exits (allowing auto to stop) only when all reactions whose match side has been seen have had their reaction side fully applied — i.e., no reaction "work" remains to be done. This is the test-harness equivalent of Pi's `hasPendingMessages()` returning false, but the harness does not mock `hasPendingMessages()` — it determines loop-continuation purely from reaction state.

### Harness removals

These helpers are deleted from `makeHarness()`:
- `releaseNextIdle()`
- `flushMicrotasks()`
- `emitSessionShutdown()`
- `setPendingMessages()`
- `setCancelNextNav()`

The existing `runAuto()` is replaced by the new config-based version.

### Test cases

| # | Test | Reactions config |
|---|------|-----------------|
| 1 | push→auto→finish (fresh context) | `[[user("Analyze..."), assistant("Found...")]]` |
| 2 | push→auto→finish (inherit context) | `[[user("Quick fix"), assistant("Fixed.")]]` |
| 3 | no pending tasks | `{ reactions: [] }` |
| 4 | stops when navigation cancelled | `[[task("Analyze..."), userEsc()]]` |
| 5 | stops after aborted assistant | `[[user("Impl..."), assistant("Stopped.")], [assistant("Stopped."), userEsc()]]` |
| 6 | subtask within a task | `[[user("parent"), assistant("working...")], [assistant("working..."), task("subtask")], [user("subtask"), assistant("sub done")]]` |
| 7 | /auto already running | `[[user("first"), assistant("done")], [assistant("done"), userRunsAuto()]]` |
| 8 | user steering message queued | `[[user("task"), assistant("thinking...")], [assistant("thinking..."), user("steer it")]]` |

#### Case details

**1–2: Task runs to completion.** Auto sees pending task, starts it, user message matches response pattern → assistant injected, auto finishes the task, branch history shows `taskResult` back on original branch. While auto runs, `getStatus()` includes `[auto]` prefix; after auto stops, the prefix is gone.

**3: No pending tasks.** Auto started with no task entries on branch. Loop sees nothing to do, notifies "No pending tasks to run", exits.

**4: Navigation cancelled.** When auto calls `navigateTree` to start a non-inherit task, `userEsc()` cancels it. Auto stops without injecting a user message or marking the task done.

**5: Aborted assistant.** Assistant response with `stopReason: 'aborted'` is matched via `assistant("...")` → `userEsc()`. The test no longer depends on the internal `lastAssistantWasAborted()` check.

**6: Subtask.** Assistant pushes a new task while inside a task. Auto starts the subtask, finishes it, then finishes the parent. The `task()` reaction injects a task entry that the auto loop picks up as a pending task.

**7: Already running.** A reaction triggers a second `runAuto()` call from within the first. The second invocation detects the first is still running, injects "Auto is already running" notification, returns immediately.

**8: User steering.** User queue-messages a steering instruction while the assistant is mid-response. The auto loop continues because the reaction `[assistant("thinking..."), user("steer it")]` still has pending work (the `user` side hasn't been applied yet after the assistant match is seen), causing the harness to keep the loop alive rather than exiting.

### Error handling & edge cases

- **Step cap:** If auto doesn't complete within the hard step cap (~100 idle cycles), the test fails with a descriptive error.
- **No matching reaction:** If a new entry appears with no matching reaction pair and no reaction work is pending, auto's own loop logic determines whether to continue or exit — same as a real session with no pending tasks. Reactions supplement the harness, not replace auto's control flow.
- **Manual tests unaffected:** The pathSuite-based manual workflow tests continue using `runPushTask`, `runStartTask`, `runFinishTask`, etc. unchanged. `runAuto` is additive.

### Non-goals

- This design does not change the manual workflow test infrastructure (`pathSuite`, existing command wrappers)
- The source behavior of `/auto` is preserved — only the internal state tracking changes (module-level → closure)

# Auto Task Command Design

## Summary

Add an `/auto` extension command that repeatedly runs pending `push-task` work without requiring the user to manually alternate `/start-task` and `/finish-task`. The command should preserve Pi's normal agent behavior: Pi still handles LLM calls, streaming output, tool execution, retries, compaction, rendering, and session persistence. `/auto` only decides when to invoke the existing task navigation behavior.

## Goals

- Start an active task automatically when a `push-task` entry appears on the current branch.
- Finish a task automatically when the task branch reaches a natural stop point.
- Keep all model/tool communication visible in the normal Pi UI.
- Avoid injecting slash commands through `pi.sendUserMessage()`, because extension-injected user messages are plain prompts and do not execute command handlers.
- Stop cleanly when there is no more task work, when navigation is cancelled, or when the user aborts active execution.

## Non-goals

- Reimplementing Pi's agent loop, tool loop, provider calls, or TUI rendering.
- Starting background work from event handlers that require command-only session APIs.
- Building a custom SDK runner.
- Supporting concurrent `/auto` loops.

## Current task flow

The extension currently provides:

- `push-task` tool: appends a custom `task` entry.
- `/start-task`: finds the active task, navigates to either a fresh point or keeps branch context, appends a `task-start` checkpoint, and sends the task prompt.
- `/finish-task`: finds the `task-start` checkpoint, captures the last assistant text response, navigates back to the return point, injects the response as a `branch-result` custom message, and marks the active task done.
- `/abort-task` and `/discard-task`: cleanup commands.

`/auto` should reuse this behavior through shared helper functions, not by sending `/start-task` or `/finish-task` as text.

## Proposed architecture

### Shared task helpers

Refactor command bodies into helpers:

```ts
type TaskActionResult = 'cancelled' | void;
// Returns 'cancelled' when the user cancelled a dialog or navigateTree returned
// cancelled and the loop should stop. Returns undefined on success or noop.

async function startTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<TaskActionResult>;
async function finishTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<TaskActionResult>;
async function abortTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<TaskActionResult>;
async function discardTask(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<TaskActionResult>;
```

Existing command handlers become thin wrappers around these helpers. The helpers may still call `ctx.navigateTree()`, `pi.sendUserMessage()`, and `pi.sendMessage()`, so they must only run from an `ExtensionCommandContext`. The `/auto` loop will call `ctx.waitForIdle()` at the top of each iteration, so helpers do not need to report whether they triggered an agent run.

The existing `findActiveTask` and `findTaskStart` lookup utilities are renamed to reflect purpose rather than mechanism:

- `findActiveTask` → `pendingTask` — returns the pending task entry, or null
- `findTaskStart` → `currentTask` — returns the current task checkpoint entry, or null

The loop uses these directly:

```ts
if (pendingTask(ctx.sessionManager)) { … }
if (currentTask(ctx.sessionManager)) { … }
```

### Lookup correctness constraints

Both existing helpers (`pendingTask` and `currentTask`, formerly `findActiveTask`/`findTaskStart`) walk the `parentId` chain from the leaf using `getEntries()` which spans all forks. The refactored loop must scope both checks to the **current branch**.

**Constraint 1 — use `getBranch()`.** `getEntries()` + `parentId` walking can false-positive on entries from sibling forks. After a fresh-context `startTask` creates a fork and the task branch runs, the leaf's `parentId` chain leads back to the fork point, and from there can traverse sideways into abandoned forks. `getBranch()` returns only the linear path from leaf to root and eliminates cross-fork false positives naturally.

**Constraint 2 — `pendingTask` must stop at a `task-start` entry.** In branch-context mode the `task-entry` and `task-start` sit on the same branch, with the task work after them. Walking backward from the leaf, the first `task-start` encountered means the task is already in progress — the iteration should not look past it for an older `task-entry`. The `task-start` acts as a barrier: everything before it is outer context, everything after it is the active task.

The implementation must modify the existing `pendingTask`/`currentTask` utilities (renamed from `findActiveTask`/`findTaskStart`) to walk `getBranch()` instead of `getEntries()`. No new variants.

### Push-task termination

Change `push-task` to request early agent-loop termination after storing the task:

```ts
return {
  content: [{ type: 'text', text: 'Task stored. Use `/start-task` or `/auto` to start it.' }],
  details: {},
  terminate: true,
};
```

This lets `/auto` observe the new `task` entry at the next `agent_end` before Pi performs an automatic follow-up turn. Pi only honors `terminate: true` when all tools in the finalized batch also terminate, so the tool guidance should say that `push-task` should be called alone when the intent is to hand control to `/auto`.

### Auto command loop

`/auto` is a long-running command handler. It owns a command context and advances only after Pi is idle.

High-level loop:

1. Wait for Pi to become idle.
2. If a pending task exists, call `startTask()` and continue.
3. If inside a current task, call `finishTask()` and continue.
4. Otherwise, loop back to step 1 (waiting for the next `push-task` or agent run).

`push-task` returning `terminate: true` is what makes Pi stop at a useful checkpoint: after the current agent run stores the task, `/auto` wakes, sees the active task, and starts it.

Pseudo-code:

```ts
pi.registerCommand('auto', {
  description: 'Automatically run pushed task branches',
  handler: async (_args, ctx) => {
    if (autoState.running) {
      ctx.ui.notify('Auto is already running.', 'warning');
      return;
    }

    autoState.running = true;
    try {
      while (autoState.running) {
        await ctx.waitForIdle();

        if (lastAssistantWasAborted(ctx.sessionManager)) break;

        if (pendingTask(ctx.sessionManager)) {
          const result = await startTask(pi, ctx);
          if (result === 'cancelled') break;
          continue;
        }

        if (currentTask(ctx.sessionManager)) {
          const result = await finishTask(pi, ctx);
          if (result === 'cancelled') break;
          continue;
        }

        // Neither pending nor inside a task — loop back to waitForIdle
      }
    } finally {
      autoState.running = false;
    }
  },
});
```

The loop intentionally calls `ctx.waitForIdle()` at the beginning of each iteration instead of checking `ctx.hasPendingMessages()` manually. If a helper triggered an agent run, the next iteration waits for it to finish. If no run is active, `ctx.waitForIdle()` should return promptly.

**Abort detection:** After `ctx.waitForIdle()` returns, `/auto` checks the last entry on the current branch. When the user hits Escape during active LLM/tool execution, Pi aborts the run and produces an assistant message with `stopReason: 'aborted'` as the last entry. `/auto` treats this as a stop signal. The helper:

```ts
function lastAssistantWasAborted(session: ReadonlySessionLike): boolean {
  const branch = session.getBranch();
  const last = branch[branch.length - 1];
  return last?.type === 'message' && last.message.role === 'assistant' && last.message.stopReason === 'aborted';
}
```

This only checks the very last entry, not historical messages, so old aborted runs from earlier in the session do not falsely trigger.

**Stale task-start entries:** `currentTask()` returns the last `task-start` entry regardless of whether the task was already finished. `startTask()` returns when a task-start already exists, so it does not create a duplicate. `finishTask()` on a stale task-start may navigate redundantly but is harmless in practice—it already guards against re-marking tasks done via its internal `pendingTask()` check.

### Stop conditions

`/auto` stops when any of these occur:

- there is no active task, no task checkpoint, and no pending Pi work;
- `startTask()` or `finishTask()` returns `cancelled`;
- Pi reports an aborted assistant response after the user hits Escape during active execution;
- `/auto` is invoked while already running, in which case the second invocation returns immediately with a warning;
- session shutdown or reload invalidates the command context.



## Data flow

```text
LLM calls push-task
  -> push-task appends custom task entry and returns terminate: true
  -> Pi ends the current agent run
  -> ctx.waitForIdle() returns in /auto loop
  -> /auto sees pending task but no task checkpoint
  -> startTask navigates and sends task prompt
  -> Pi runs normal LLM/tool loop for task
  -> ctx.waitForIdle() returns when agent is idle
  -> /auto sees task checkpoint and pending task
  -> finishTask returns to checkpoint, injects branch-result, marks task done
  -> Pi runs normal LLM turn from branch-result if triggered
  -> ctx.waitForIdle() returns
  -> /auto sees no pending task and no task checkpoint, exits
```

## Error handling

- If `/auto` is invoked with no pending task and no current task, it loops back to `waitForIdle()` rather than exiting. This handles the case where `push-task` was called alongside other non-terminating tools and Pi continued without stopping.
- If there is an active task but no valid fresh target for a fresh-context task, `startTask()` notifies and returns; `/auto` continues.
- If `ctx.navigateTree()` is cancelled, the helper returns `cancelled` and `/auto` stops.
- If `finishTask()` cannot find a task checkpoint, it notifies and returns; `/auto` continues.
- `ctx.waitForIdle()` is the main loop primitive. `/auto` calls it at the start of each iteration, then inspects the current branch for an active task or task checkpoint.
- If the user aborts during an active task with Escape, the next `ctx.waitForIdle()` call returns, `/auto` detects the aborted assistant message via `lastAssistantWasAborted()`, and the loop stops. It does not call `finishTask()` on an aborted task run.
- After `finishTask()` completes, the `task-start` entry remains on the branch but `pendingTask()` returns null because the task-done entry was appended. On the next iteration both `pendingTask()` and `currentTask()` return null, and the loop stops naturally.
- `terminate: true` depends on `push-task` being the only finishing tool in its batch. If called alongside other tools, Pi may continue before `/auto` gets control. The loop handles this naturally — when neither `pendingTask()` nor `currentTask()` returns anything, the loop circles back to `waitForIdle()` and waits for the next agent run to finish.
- `autoState.running` is module-level state. It resets when extensions reload (e.g. `/reload`, session fork/clone/new). `/auto` should subscribe to `session_shutdown` and clear the flag so the guard doesn't block a fresh invocation after session replacement.

## UI behavior

- `/auto` may set a status indicator such as `auto: running` while active and clear it in `finally`.
- It should not hide normal Pi output.
- It should not replace the editor or install a custom UI component.
- Normal tool call and assistant rendering remains unchanged.

## Testing strategy

### Unit tests

- Existing `/start-task` and `/finish-task` tests continue to pass through the new helpers.
- `/auto` waits (does not exit) when there is no pending task and no current task — it loops back to `ctx.waitForIdle()` and waits for the next `push-task` or agent run.
- `/auto` starts an active task when no checkpoint exists.
- `/auto` finishes when a checkpoint exists and Pi is idle.
- `/auto` does not start a second loop when already running.
- `push-task` returns `terminate: true`.
- `lastAssistantWasAborted()` detects aborted assistant responses.

### Integration-style tests

- Complete `push-task -> /auto -> start task -> finish task` roundtrip.
- Fresh-context task returns a branch result to the original branch.
- Branch-context task returns a branch result to the original leaf.
- Cancelled navigation stops `/auto` without marking the task done.


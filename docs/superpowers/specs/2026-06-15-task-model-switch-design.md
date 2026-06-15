# Task model switching — design

## Summary

`/start-task` gains an optional model pattern argument. When given and unambiguous, the model switches before the task prompt is sent. The task-start checkpoint records the model it replaced. `/finish-task` restores that model.

## Motivation

Running a task with a different model (e.g., cheaper model for bulk work, stronger model for complex analysis) is a common workflow. Today you must manually `/model` before and after each task. This automates it.

## Data model

### TaskStartData (extended)

```
{ returnTo: string; previousModel?: { provider: string; modelId: string } }
```

- `previousModel` is set only when the task actually switched models.
- Stored in the `task-start` custom entry (same entry type, expanded data shape).
- Uses the same shape as `ModelChangeEntry` in sessions for consistency.

## Commands

### `/start-task [model-pattern]`

1. If no argument: existing behavior — no model change, no `previousModel`.
2. If argument present: resolve the pattern (see Model resolution below).
3. If 0 or >1 match: notify user, return — no task started.
4. If exactly 1 match: snapshot current model via `ctx.model` (provider + id), call `pi.setModel(matchedModel)`, record `previousModel` in the task-start entry, proceed with normal task start.

### `/finish-task`

After navigating back to `returnTo`, if the task-start entry has `previousModel`, calls `pi.setModel(restoredModel)` to switch back. If the model is no longer available, warns the user and continues without restoring.

## Model resolution

### Matching order

1. If pattern contains `/`, split as `provider/modelId` and try `modelRegistry.find(provider, modelId)`. If found, use it directly (skip step 2). If pattern has no `/`, skip to step 2.
2. Substring, case-insensitive match against each available model's `id`, `name`, and `provider/id`. Model must have configured auth (`modelRegistry.getAvailable()`).

### Match outcomes

- **0 matches**: notify "No model matching `<pattern>`". No task started.
- **>1 match**: notify "Ambiguous model: matches A, B, C". No task started.
- **1 match**: use it.

### `pi.setModel()` failure

If the matched model has no API key at switch time, notify and return — no task started.

## Autocompletion

`getArgumentCompletions` on the `/start-task` command filters `modelRegistry.getAvailable()` by substring match against `id`, `name`, `provider/id`. Case-insensitive. Returns up to 20 `AutocompleteItem`s with `value: "provider/modelId"`, `label: "name"`, `description: "provider/modelId"`.

## Edge cases

- **Nested tasks**: each task-start stores its own `previousModel`. Finish restores what was in use before that specific task. Nesting stacks naturally.
- **User changes model during task**: irrelevant. Finish always restores from the checkpoint, not the current model.
- **Inherit-context tasks**: model switch happens on the current branch before sending the prompt.
- **Previous model unavailable on finish**: warn, continue without restoring.

## API surface changes

- `TaskCommandAPI` expands to include `setModel` and `modelRegistry`.
- Current model snapshot reads `ctx.model` (already on `ExtensionCommandContext`). No API addition needed for the snapshot.
- `isTaskStartData` validator updated for the optional `previousModel` field.
- `cmdStartTask` signature unchanged externally; internal handler parses args and resolves models.
- `index.ts` registration passes the full `pi` object (it already does; the type annotation just narrows).

## Files

| File | Change |
|------|--------|
| `src/index.ts` | Expanded `TaskCommandAPI`, `TaskStartData`, `isTaskStartData`, `cmdStartTask` handler, `finishTask` restore logic, model resolution helper |
| `index.ts` | Pass `setModel` + `modelRegistry` to `cmdStartTask` |
| `src/model-switch.test.ts` | New test file |

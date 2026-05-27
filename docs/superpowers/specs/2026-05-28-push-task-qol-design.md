# Push-task quality-of-life improvements — design

## Scope

Changes live entirely in `index.ts`, `index.test.ts`, and `README.md`. No changes to updater patches or generated skills.

## 1. Parameter rename: `context` → `inherit_context`

### Motivation

The current `context: 'fresh' | 'branch'` string union is verbose and unintuitive. A boolean `inherit_context` (default `false`) is simpler: the default is always fresh context. Explicit `true` means "continue on current branch."

### Mapping

| Before | After |
|--------|-------|
| `context: 'fresh'` (default) | `inherit_context: false` (default) |
| `context: 'branch'` | `inherit_context: true` |

### Changes in `index.ts`

- **Schema** (`pushTaskParameters`): Replace `context` union with `Type.Optional(Type.Boolean({ default: false, description: ... }))`.
- **`TaskData` interface**: `context: 'fresh' | 'branch'` → `inherit_context: boolean`.
- **`execute()`**: `params.context ?? 'fresh'` → `params.inherit_context ?? false`.
- **`startTask()`**: Invert condition — `taskContext === 'fresh'` → `!inheritContext`.
- **`execute()` return**: Add `details: { prompt: params.prompt, inherit_context: params.inherit_context ?? false }` so `renderResult` can access the prompt.

### Reference updates

- **README.md**: Description text and usage example.

## 2. Custom tool rendering (`renderCall` / `renderResult`)

### `renderCall` (shown while tool executes and after, in collapsed state)

Header line: bold **push-task**. If `inherit_context` is true, append `[inherit]` badge in warning color.

Below the header, show the first 7 lines of the prompt (dimmed). If the prompt has more lines, show `...` as the 8th line.

When the user presses Ctrl-O (expand), show the full prompt — all lines, word-wrapped via the `Text` component. Use `context.expanded` to decide.

### `renderResult` (shown after execution completes)

Same behavior as `renderCall` — 7 lines collapsed, full prompt expanded. The existing `content` text ("Task stored. Use `/start-task` or `/auto` to start it.") already conveys the result; no need to repeat it visually.

```typescript
renderCall(args, theme, context) {
  const header = theme.fg("toolTitle", theme.bold("push-task"))
    + (args.inherit_context ? " " + theme.fg("warning", "[inherit]") : "");

  const promptLines = args.prompt.split("\n");
  const maxLines = context.expanded ? promptLines.length : 7;
  const displayLines = promptLines.slice(0, maxLines)
    .map(l => theme.fg("dim", l.trimEnd() || " "));

  if (!context.expanded && promptLines.length > 7) {
    displayLines.push(theme.fg("muted", "..."));
  }

  return new Text([header, ...displayLines].join("\n"), 0, 0);
}

renderResult(result, { expanded }, theme, context) {
  // Same rendering, reading prompt from result.details
  const details = result.details as { prompt: string; inherit_context: boolean };
  const header = theme.fg("toolTitle", theme.bold("push-task"))
    + (details.inherit_context ? " " + theme.fg("warning", "[inherit]") : "");

  const promptLines = details.prompt.split("\n");
  const maxLines = expanded ? promptLines.length : 7;
  const displayLines = promptLines.slice(0, maxLines)
    .map(l => theme.fg("dim", l.trimEnd() || " "));

  if (!expanded && promptLines.length > 7) {
    displayLines.push(theme.fg("muted", "..."));
  }

  return new Text([header, ...displayLines].join("\n"), 0, 0);
}
```

Theme colors used: `toolTitle`, `warning`, `dim`, `muted`. All imported from Pi's theme API.

## 3. Smart slug for status line

A helper function `makeSlug(prompt: string): string`:

1. Split the prompt into words on whitespace.
2. Filter out stopwords (case-insensitive): a, an, the, is, are, was, were, be, been, being, have, has, had, do, does, did, will, would, shall, should, may, might, must, can, could, i, you, he, she, it, we, they, me, him, her, us, them, my, your, his, its, our, their, this, that, these, those, to, of, in, for, on, with, at, by, from, as, into, through, during, before, after, above, below, between, under, and, but, or, nor, not, so, if, than, too, very, just, now, then, also, here, there, when, where, why, how, all, both, each, few, more, most, other, some, such, no, only, own, same, up, out, about, over, again, while.
3. If no words remain after filtering, fall back to `"<no description>"`.
4. Take the first 7 remaining words.
5. Join with spaces.
6. Truncate to 40 characters, appending `...` if truncated.

## 4. Status line — pending task

After `push-task` executes, and on `session_start`, `turn_end`, and `session_tree`:

1. Scan the current branch for a pending task via the existing `pendingTask()` utility.
2. If found, compute a slug from its prompt.
3. Set status: `ctx.ui.setStatus("task", theme.fg("dim", "pending task: " + slug))`.

The `execute()` function triggers the status update after `pi.appendEntry()` is complete (after the prompt is fully stored), so the status appears immediately without waiting for the next event cycle.

## 5. Status line — current task (checkpoint)

When there is **no pending task** but `currentTask()` finds a `task-start` entry (we are inside a task branch):

1. Walk forward from the `task-start` entry to find the next user message. That message was injected by `startTask()` and contains the original task prompt.
2. Compute a slug from that message's content.
3. Set status: `ctx.ui.setStatus("task", theme.fg("dim", "current task: " + slug))`.

When neither a pending nor current task exists, clear the status: `ctx.ui.setStatus("task", undefined)`.

Status is recomputed on: `session_start`, `turn_end`, `session_tree`, and immediately after `push-task` execution.

## 6. Testing

### Test harness changes

- `runPushTask(prompt, context?)` → `runPushTask(prompt, inherit_context?)` — boolean parameter.
- Add `getStatus(): string` helper that returns the last value passed to `ctx.ui.setStatus("task", ...)`.
- Add a `setStatus` capture to the mock `ui` in `makeHarness()`.

### Test updates

All existing call sites that pass a `context` argument update to `inherit_context`. Add status assertions at critical points in existing tests — verify correct slug after push-task, after start-task, and cleared after finish-task/abort-task/discard-task. No new test blocks; all assertions folded into existing test cases.

## 7. Files changed

| File | Changes |
|------|---------|
| `index.ts` | Parameter schema, `TaskData`, `execute()`, `startTask()`, `renderCall`, `renderResult`, `makeSlug`, status hooks, post-push-task status trigger |
| `index.test.ts` | `runPushTask` signature update, `getStatus()` helper, status assertions, `context` → `inherit_context` references |
| `README.md` | Parameter description, usage example |

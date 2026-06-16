# Design: Simplify `push-task` with required titles

## Summary

Change `push-task` so it always queues a fresh-context task and requires an explicit `title`.

This design removes the unused `inherit_context` parameter, removes slug generation, and makes `title` the canonical task label everywhere: tool rendering, stored task entries, current-task markers, status text, and returned task results.

## Goals

- Remove `inherit_context` from the tool schema, implementation, and tests.
- Require `title` on every `push-task` call.
- Use `title` instead of generated slugs everywhere task labels are shown or stored.
- Keep failed `push-task` validation visible to the LLM so it can retry in the same turn.
- Reduce task lifecycle branching and simplify status/result rendering.

## Non-goals

- Changing the overall task model beyond removing branch-context mode.
- Adding uniqueness rules or ID generation for task titles.
- Changing model-switch behavior except where task metadata shape changes.

## Current behavior

Today `push-task` stores a task entry with `prompt` and optional `inherit_context`.

- `inherit_context: false` starts from fresh context.
- `inherit_context: true` continues on the current branch.
- Status labels are derived from `makeSlug(prompt)`.
- Finished task results store `details.slug`.

This creates two problems:

1. `inherit_context` adds a second execution mode that is rarely used and easy to misuse.
2. Generated slugs are indirect and lossy compared to an explicit task title.

## Proposed design

### 1. Tool contract

`push-task` will require:

- `title: string`
- `prompt: string`

`inherit_context` is removed completely.

The tool continues to store a pending task and terminate the turn on success.

### 2. Validation rules

Validation for `title` is intentionally minimal:

- `title` is required.
- `title` is trimmed before storage and display.
- If trimming produces an empty string, the tool call fails.

On validation failure:

- no task entry is stored
- no success notification is shown
- the failure is surfaced as a tool-call error visible to the LLM
- the LLM can immediately issue a corrected `push-task` call

This is important because successful `push-task` calls terminate the turn; failures must stay on the retry path instead.

`prompt` keeps its current behavior, including skill reference rewriting.

### 3. Canonical task metadata

`title` becomes the canonical label for all task lifecycle states.

#### Pending task entry

Pending task entries store:

```ts
{ title, prompt }
```

#### Current task marker

When `/start-task` begins execution, it always navigates to fresh context and creates a task-start marker storing:

```ts
{ title, returnTo, previousModel? }
```

Storing `title` on the task-start marker lets current-task status read directly from the active marker instead of re-deriving labels from the task prompt.

#### Task result

When `/finish-task` returns to the parent branch, it emits a task result whose metadata stores:

```ts
details: { title }
```

No slug field remains.

### 4. Execution flow

The task flow becomes:

1. `push-task({ title, prompt })`
2. tool trims and validates `title`
3. tool resolves `/skill:name` references inside `prompt`
4. tool stores pending task entry `{ title, prompt }`
5. `/start-task` navigates to fresh context
6. `/start-task` stores task-start marker `{ title, returnTo, previousModel? }`
7. task prompt is sent in the fresh branch
8. `/finish-task` returns to `returnTo`
9. task result is attached with `details.title`

There is no branch-context execution mode anymore.

## Architecture and code changes

### `src/index.ts`

Primary changes stay in `src/index.ts`:

- update the `push-task` parameter schema to require `title`
- remove all `inherit_context` logic from tool execution
- trim and validate `title` before storing anything
- show `title` in the tool-call renderer header
- store pending task data as `{ title, prompt }`
- simplify `/start-task` so it always uses fresh-context navigation
- store `{ title, returnTo, previousModel? }` on the task-start marker
- simplify current-task status rendering to read `title` from the active task-start marker
- emit `task-result.details.title`
- update the task result renderer to show `<title> result:`

### `src/slug.ts`

Delete `src/slug.ts` if nothing else references it after the change.

### Test helpers

Update helpers that currently fabricate or inspect task metadata:

- mock LLM `pushTask(...)` helper should take `title` and `prompt`
- session entry helpers should store task entries as `{ title, prompt }`
- task result helpers should use `title` instead of `slug`
- helper type guards should remove `inherit_context`

### Documentation

Update `README.md` and any skill/example text that demonstrates `push-task` so examples use the required shape:

```ts
push-task({ title, prompt })
```

## User-visible behavior

### Tool rendering

The `push-task` tool renderer should show the title in its header as:

- `push-task: <title>`

This keeps queued tasks identifiable without reading the full prompt.

### Status text

Status labels should show the explicit title directly:

- `pending task: <title>`
- `current task: <title>`

No slug transformation is applied.

### Result rendering

Finished task messages should render as:

- `<title> result:`

using `details.title`.

## Error handling

### Invalid title

If `title` is missing, blank, or whitespace-only after trimming, the tool must fail clearly and visibly to the LLM.

Expected effects:

- task queue remains unchanged
- no pending task status appears
- no success notification appears
- no turn-terminating success result is returned

### Skill resolution warnings

Existing unresolved `/skill:name` behavior remains unchanged apart from the new task metadata shape. If skill references cannot be resolved, the task is still stored and the user still gets the current warning notification.

### Missing fresh target

`/start-task` still warns and exits if no fresh starting point can be found. This behavior is unchanged except that there is no longer any branch-context fallback path.

## Testing strategy

Keep the diff focused: delete the `inherit_context` matrix rather than replacing it with more abstractions.

### Update or add tests for

- `push-task` accepts `{ title, prompt }`
- `title` is trimmed before storage
- whitespace-only `title` fails as a tool error visible to the LLM
- failed validation stores no task entry
- tool-call renderer shows the title
- pending-task status uses stored `title`
- current-task status uses `title` from the task-start marker
- `/finish-task` emits `task-result.details.title`
- result renderer shows `<title> result:`
- `/start-task` always uses fresh-context behavior
- `/auto` still completes normal queued-task flow with title-based labels

### Delete tests for

- branch-context task execution
- `inherit_context` parsing or propagation
- slug-based labels and slug metadata

## Migration impact

This is a breaking change for callers of `push-task`.

Old:

```ts
push-task({ prompt })
push-task({ prompt, inherit_context: true })
```

New:

```ts
push-task({ title, prompt })
```

Because this extension owns the tool and its bundled skills/docs, the migration should be done atomically in the same change set:

- runtime code
- tests/helpers
- README examples
- bundled skill content that demonstrates `push-task`

External callers are also affected. Any custom skills, prompt templates, or other integrations that invoke `push-task` must be updated to send `{ title, prompt }`. No compatibility shim is planned.

## Recommendation for implementation planning

This design is small enough for a single implementation plan. No roadmap phase split is needed.
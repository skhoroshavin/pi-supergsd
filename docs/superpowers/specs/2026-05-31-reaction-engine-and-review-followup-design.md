# Reaction Engine & Review Follow-Up Design

> Follow-up to code review of the AgentSession test harness migration (PR on `improve-tests` branch).
> Addresses review items #1–#8 deferred from that review.

## Overview

Replace the current split between `FauxResponseQueue` (provider-side queue) and `reactions.ts` (auto-side scanner) with a `ReactionEngine` class plus a `FauxProvider` that consumes it. This eliminates most task workflow duplication, unifies how `prompt()` and `/auto` get their responses, and makes the API simpler for test authors.

**The key insight:** every model call — whether triggered by `h.prompt()`, internal command logic like `/start-task`, or `/auto` — goes through the faux provider. The engine sits behind the provider and supplies responses based on the actual prompt text that reaches the LLM.

## Architecture

```
Test author:
  engine = new ReactionEngine()
  engine.onPrompt('Analyze X', responds('working...'), pushTask('sub'))
  h = await TestHarness.create(engine)

h.prompt('Analyze X')
  → model call with prompt "Analyze X"
  → FauxProvider.stream(model, context):
       responses = engine.match(context.lastUserMessage)
       if empty → throw "no reaction for prompt: ..."
       queue responses
       stream them as assistant events
  → waitForIdle completes
  → visible session has user('Analyze X'), assistant('working...'), task('sub')
```

### When `/auto` runs

The `/auto` handler internally calls the model many times (for each pending task, for each steering message). Each call goes through `FauxProvider.stream()`, which queries the engine. No special code path — same pipeline.

Control reactions (`userEsc`, `userCtrlC`, `userRunsAuto`) are handled by the harness during `waitForIdle`: the engine is queried for control actions based on visible session entries (assistant text, queued task entries). These actions don't go through the model provider — they manipulate session state directly.

## ReactionEngine

### API

```ts
class ReactionEngine {
  /** When the model is prompted with `text`, respond with these provider descriptors. */
  onPrompt(text: string, ...responses: ResponseDescriptor[]): void;

  /** When an assistant message containing `text` appears on the branch, fire these. */
  onAssistant(text: string, ...reactions: (ResponseDescriptor | ControlReactionDescriptor)[]): void;

  /** When a queued task with `prompt` is pending, fire these before navigation. */
  onQueuedTask(
    prompt: string,
    inheritContext: boolean | undefined,
    ...reactions: (ResponseDescriptor | ControlReactionDescriptor)[]
  ): void;
}
```

### Rules

- **Same rule matches unlimited times.** The engine is a lookup table, not a queue. If `/auto` hits the same prompt 5 times in a loop, it matches 5 times.
- **No match on model call → test fails.** The faux provider throws immediately.
- **`onPrompt(...)` is provider-only.** It accepts only `ResponseDescriptor` values because prompt matches are resolved inside the faux provider during a model call.
- **`onAssistant(...)` and `onQueuedTask(...)` can mix provider descriptors and control descriptors.** Those matches are resolved by the session scanner during `waitForIdle`.
- **No dequeue from engine.** Responses are copied, not consumed. The engine never mutates.

### Matching semantics

- `onPrompt(text, ...)` — matches when the model receives a call with the last user message containing `text` (substring match).
- `onAssistant(text, ...)` — matches when a visible assistant entry containing `text` appears on the session branch.
- `onQueuedTask(prompt, inheritContext, ...)` — matches when a pending task entry with prompt containing `prompt` is found and `inherit_context` matches the optional `inheritContext` filter (during `/auto` navigation checks).

## FauxProvider

The `FauxProvider` class replaces `FauxResponseQueue`. It remains a separate file from `reaction-engine.ts`.

- `reaction-engine.ts` owns test rule registration and matching semantics.
- `faux-provider.ts` owns the Pi provider protocol (`stream`) and event emission.

`FauxProvider` owns:

1. A reference to the engine (injected at construction)
2. An internal response queue (for the current model call)
3. The `stream` function registered with Pi's provider config

### stream() flow

```
model call arrives
  → text = last user message content from context
  → responses = engine.matchPrompt(text)
  → if no responses → throw Error("no engine rule for prompt: ...")
  → build ONE assistant turn from those response descriptors
  → stream that turn as assistant events
  → end stream
```

### Multiple response descriptors in one prompt match

A single `onPrompt(text, ...responses)` rule produces **one assistant turn** whose content blocks are built from the descriptors in order.

Examples:

- `onPrompt('X', responds('working...'))`
  → one assistant message with one text block
- `onPrompt('X', responds('working...'), pushTask('sub'))`
  → one assistant message with a text block followed by a `push-task` tool call block
- `onPrompt('X', thinks('planning'), responds('working...'))`
  → one assistant message with a thinking block followed by a text block

Rules:

- `aborts(...)` must be the **only** descriptor in `onPrompt(...)`
- multiple `pushTask(...)` descriptors are allowed and become multiple tool-call blocks in one assistant turn
- prompt matches never include control descriptors

### engine.matchPrompt(text)

Internal helper that returns the `ResponseDescriptor[]` registered via `onPrompt(text)`.

## Harness changes

### Construction

```ts
// Before
const h = await TestHarness.create();

// After
const engine = new ReactionEngine();
const h = await TestHarness.create(engine);
```

`TestHarness.create(engine)` passes the engine to `FauxProvider` and stores it for control-reaction scanning.

### prompt() simplified

```ts
// Before
await h.prompt('main work', responds('working...'));

// After — no response parameter, engine supplies
await h.prompt('main work');
```

### Task workflow helpers simplified, not fully removed

- `runStartTask`, `runFinishTask`, `runDiscardTask`, `runAbortTask` are removed and replaced by real slash-command prompts:

```
await h.prompt('/start-task')
await h.prompt('/finish-task')
await h.prompt('/discard-task')
await h.prompt('/abort-task')
```

- `runPushTask` is replaced by a smaller `h.pushTask(prompt, inheritContext?)` helper because `push-task` is a **tool**, not a slash command, in this codebase. There is no real `/push-task` command path to delegate to.

The helper should either:
1. invoke the real tool implementation directly through the extension runtime, or
2. append the exact same `task` custom entry shape as the real tool.

This is acceptable because it is not duplicating a production command path — there is no command path for task creation.

### Commands that trigger model calls

Commands like `/start-task` can still trigger model calls indirectly. For example, `/start-task` navigates to a task branch and injects the task prompt as a user message. That injected prompt goes through the faux provider and must be matched by `engine.onPrompt(...)`.

### Control reactions still in waitForIdle

The harness still scans the session branch during `waitForIdle`, matching `onAssistant` and `onQueuedTask` rules against new entries. When found, control actions execute:

- `userEsc` → sets `cancelNextNav` flag
- `userCtrlC` → triggers session shutdown  
- `userRunsAuto` → re-invokes `/auto`

## Test migration

### manual.test.ts

```ts
// Before
const h = await TestHarness.create();
await h.prompt('main work', responds('working...'));
h.assertBranchHistory(user('main work'), assistant('working...'));

// After
const engine = new ReactionEngine();
engine.onPrompt('main work', responds('working...'));
const h = await TestHarness.create(engine);
await h.prompt('main work');
h.assertBranchHistory(user('main work'), assistant('working...'));
```

### auto.test.ts

```ts
// Before
const h = await TestHarness.create();
await h.prompt('main work', responds('working...'));
await h.runAuto({ reactions: [[prompt('Analyze X'), responds('Found 3')]] });

// After
const engine = new ReactionEngine();
engine.onPrompt('main work', responds('working...'));
engine.onPrompt('Analyze X', responds('Found 3'));
const h = await TestHarness.create(engine);
await h.prompt('main work');
await h.prompt('/auto');
```

`runAuto()` is replaced by `h.prompt('/auto')`. The `/auto` handler makes model calls, the engine matches each one.

### harness.test.ts

No conceptual changes beyond engine construction.

## Restored subtask auto test

The previously-skipped subtask test can now work because the engine handles nested prompts uniformly:

```ts
it('processes a subtask pushed during a task', async () => {
  const engine = new ReactionEngine();
  engine.onPrompt('main work', responds('working...'));
  engine.onPrompt('parent task', responds('working on parent...'), pushTask('subtask'));
  engine.onPrompt('subtask', responds('sub done'));

  const h = await TestHarness.create(engine);
  await h.prompt('main work');
  await h.pushTask('parent task');
  await h.prompt('/auto');

  h.assertSessionContains(
    user('subtask'),
    assistant('sub done'),
    taskResult('subtask', 'sub done'),
  );
});
```

## Minor items covered

| # | Item | How addressed |
|---|---|---|
| 1 | Task workflow duplication | Greatly reduced — real slash commands via `h.prompt('/...')`, plus small `h.pushTask()` helper for the real tool path |
| 2 | Subtask auto test | Restored with engine-based reactions |
| 3 | Notification levels | Store level alongside message in TestUI notificationLog |
| 4 | FauxEventStream.result() polling | Replace with promise-based approach |
| 5 | ReactionRuntime method naming | Rename to `injectUserMessage`, `injectAssistantMessage`, `injectTaskEntry` |
| 6 | Duplicate flushMicrotasks | Extract to shared module or inline only once |
| 7 | Faux-provider inline types | Add comment noting periodic sync needed with Pi types |
| 8 | Unused imports in auto.test.ts | Clean up during migration |

## Deletion list

Files to delete:
- `src/test-helpers/reactions.ts` — matching logic absorbed into engine

Files to keep and rewrite:
- `src/test-helpers/faux-provider.ts` — keep as the provider protocol implementation, now backed by `ReactionEngine`

New file:
- `src/test-helpers/reaction-engine.ts` — rule registration and matching

Modified files:
- `src/test-helpers/harness.ts` — simplified construction, remove most task methods, add engine injection and smaller `pushTask()` helper
- `src/test-helpers/harness.test.ts` — engine-based test setup
- `src/manual.test.ts` — engine-based setup, real slash commands
- `src/auto.test.ts` — engine-based setup, `prompt('/auto')` instead of `runAuto()`, restored subtask test
- `src/test-helpers/ui.ts` — notification level capture
- `src/test-helpers/index.ts` — export `ReactionEngine`

## Decisions locked in

1. **`faux-provider.ts` stays separate from `reaction-engine.ts`.** Provider protocol and rule matching remain separate concerns.
2. **There is no `/push-task` command path.** Tests use `h.pushTask(...)` for task creation, and `engine.onPrompt(...)` for the prompts that real commands inject into the LLM.
3. **`onPrompt(...)` is provider-only and cannot contain control descriptors.** If a test wants a control action after a model response, it must chain through `onAssistant(...)`.
4. **`onQueuedTask(...)` keeps `inherit_context` expressiveness** via the `inheritContext` filter parameter.

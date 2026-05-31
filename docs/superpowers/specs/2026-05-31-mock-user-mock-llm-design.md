# MockUser / MockLLM test harness refactor design

## Status

Approved for planning.

## Summary

Refactor the test harness so provider-side behavior and user-side steering are separate systems:

- `MockLLM` owns prompt-to-response rules for the faux provider.
- `MockUser` owns assistant/task-triggered user automation and control actions.
- `TestHarness` creates both mocks internally and exposes them as fields.
- `ReactionEngine` is removed completely.

This makes tests clearer by separating “what the model says” from “what the simulated user does next.”

## Goals

- Decouple LLM response rules from user reaction rules.
- Replace `ReactionEngine` everywhere with explicit `MockLLM` and `MockUser` systems.
- Prevent cross-system rule mixing by API shape and types.
- Keep current task automation and steering coverage.
- Simplify harness input to one public method.

## Non-goals

- Preserve support for literal slash prompts in the harness API.
- Redesign Pi slash handling.
- Expand the harness beyond current steering and automation needs.

## Current problem

`src/test-helpers/reaction-engine.ts` currently mixes two responsibilities:

1. LLM prompt matching used by `FauxProvider`
2. Assistant/task reaction matching used by `TestHarness`

That makes ownership unclear and allows conceptually invalid combinations at test call sites.

## Approved decisions

### 1. Architecture

Introduce two explicit systems:

- `src/test-helpers/mock-llm.ts`
  - exports `MockLLM`
  - owns only provider-side prompt matching
- `src/test-helpers/mock-user.ts`
  - exports `MockUser`
  - owns only user/control-side reactions and steering
- `src/test-helpers/faux-provider.ts`
  - depends only on `MockLLM`
- `src/test-helpers/harness.ts`
  - constructs both mocks internally
  - exposes them as `h.llm` and `h.user`

`ReactionEngine` is removed.

### 2. Public APIs

#### `MockLLM`

- method: `onPrompt(text, ...responses)`
- exports LLM-side descriptors from `mock-llm.ts`:
  - `responds`
  - `thinks`
  - `aborts`
  - `pushTask`

`pushTask` remains `pushTask(prompt, inherit_context = false)` so tests can continue to create both fresh-context and branch-context queued tasks.

`MockLLM` accepts only LLM descriptors.

#### `MockUser`

- method: `onAssistant(text, ...actions)`
- method: `onQueuedTask(text, ...actions)`
- `onQueuedTask(...)` intentionally removes the old `inheritContext` discriminator and matches by queued-task prompt text only
- exports user-side descriptors from `mock-user.ts`:
  - `userEsc`
  - `userCtrlC`
  - `userPrompts`

`MockUser` accepts only user/control descriptors.

`userPrompts(text)` accepts exactly one prompt string and executes by calling `h.prompt(text)`.

#### `TestHarness`

- `TestHarness.create()` creates both mocks internally
- tests configure behavior after construction, for example:

```ts
const h = await TestHarness.create();
h.llm.onPrompt("main work", responds("working..."));
h.user.onAssistant("working...", userPrompts("/auto"));
```

### 3. Input API

`TestHarness` exposes one public input method:

```ts
await h.prompt("main work");
await h.prompt("/auto");
```

Behavior:

- `h.prompt(...)` always calls `session.prompt(text, {
  expandPromptTemplates: true,
  source: "test",
})`
- non-slash prompts continue to behave like normal user prompts
- slash-prefixed input is always processed through Pi’s slash pipeline
- slash-prefixed input is never sent literally to the faux model through the harness API

This intentionally narrows the harness contract:

- supported: normal prompts and slash-processing prompts
- unsupported: sending slash-prefixed text literally to the model

The existing literal-slash harness behavior and its test are removed intentionally.

### 4. Matching semantics

#### `MockLLM`

- first matching prompt rule wins
- non-empty prompt matching uses `includes(...)`
- empty prompt remains a special exact-match case
- returns a copied descriptor list so rules remain immutable
- throws loudly when no prompt rule matches

#### `MockUser`

- first matching assistant/task rule wins
- assistant matching uses `includes(...)` on assistant text
- queued-task matching uses `includes(...)` on queued task prompt text
- returns copied action lists
- unmatched assistant/task entries do nothing

### 5. Data flow

1. Test configures `h.llm` and `h.user`.
2. Test calls `h.prompt(...)`.
3. The real session runs the prompt.
4. `FauxProvider` asks `MockLLM` for prompt responses.
5. The session appends assistant output normally.
6. Queued tasks used in tests originate from LLM-side `pushTask(...)` tool-call descriptors.
7. After idle, the harness scans new entries.
8. Assistant and queued-task entries are offered to `MockUser`.
9. Matched user actions execute as simulated user behavior.
10. If new entries appear, the harness repeats until no more actions fire.

The harness keeps the extra idle wait after `session.prompt(...)` so command handlers that trigger follow-on work still settle fully.

### 6. Error handling

- unmatched `MockLLM` prompt rules fail loudly: the harness operation should reject/fail when no LLM prompt rule matches
- unmatched `MockUser` rules are a no-op
- invalid LLM/user descriptor mixing is prevented by separate APIs and types

### 7. Migration

#### Remove

- `src/test-helpers/reaction-engine.ts`

#### Add

- `src/test-helpers/mock-llm.ts`
- `src/test-helpers/mock-user.ts`

#### Update

- `src/test-helpers/faux-provider.ts`
- `src/test-helpers/harness.ts`
- `src/test-helpers/index.ts`
- `src/test-helpers/test-tree.ts`
- all tests that construct or import `ReactionEngine`

`TestHarness.pushTask(...)` is removed. Tests that need queued tasks should create them through LLM-side `pushTask(...)` descriptors instead of direct harness seeding.

Concrete replacement pattern:

```ts
h.llm.onPrompt("queue BBB", pushTask("Task BBB"));
await h.prompt("queue BBB");
```

Branch-context variant:

```ts
h.llm.onPrompt("queue BBB", pushTask("Task BBB", true));
await h.prompt("queue BBB");
```

This replacement adds a real prompt turn and tool-use turn before the `task(...)` entry, so exact branch-history assertions must be updated accordingly. Expected history shape for the seed turn is:

```ts
user("queue BBB"),
assistant("", "toolUse"),
task("Task BBB")
```

### 8. Test updates

Update tests to configure `h.llm` and `h.user` instead of a shared engine.

Expected file-level migrations:

- `src/test-helpers/reaction-engine.ts`: remove entirely and replace its responsibilities with `MockLLM` and `MockUser`
- `src/test-helpers/descriptors.ts`: stop using it as the public mixed-descriptor entrypoint; public imports should come from `mock-llm.ts`, `mock-user.ts`, and `index.ts`; keep any shared/internal descriptor types there only if still useful during implementation; delete `userRunsAuto()` and replace its usage with `userPrompts("/auto")`
- `src/test-helpers/faux-provider.ts`: depend only on `MockLLM`
- `src/test-helpers/harness.ts`: remove `create(engine)`, `command(...)`, and `pushTask(...)`; expose `h.llm`, `h.user`, and a single `prompt(...)`
- `src/test-helpers/index.ts`: stop exporting `ReactionEngine`; export the new mocks and side-specific helpers
- `src/test-helpers/test-tree.ts`: create the harness with `TestHarness.create()` and queue later tasks through explicit prompt turns from the current branch
- `src/test-helpers/harness.test.ts`: switch to `h.llm`/`h.user`, replace slash-command calls with `h.prompt("/...")`, replace direct queue seeding with LLM `pushTask(...)`, remove the literal-slash passthrough test, and delete the old cross-system coverage that depended on `onAssistant(..., pushTask(...))` or `onQueuedTask(..., responds(...))`; replace that coverage with tests that assert the new separation of responsibilities instead
- `src/auto.test.ts`: switch to `h.llm`/`h.user`, replace `h.command("/auto")` with `h.prompt("/auto")`, replace `userRunsAuto()` with `userPrompts("/auto")`, replace direct queue seeding with LLM `pushTask(...)`, use public user helpers rather than raw action objects, and preserve branch-context queueing with patterns like `pushTask("Task BBB", true)` where needed
- `src/manual.test.ts`: switch to `h.llm`, replace `h.command("/...")` with `h.prompt("/...")`, replace direct queue seeding with explicit seed prompt turns that emit `pushTask(...)`, update exact branch-history assertions to include the seed prompt and assistant tool-use entries, and update helper functions such as `onTaskResponse(...)` and `expectBlankPrompt(...)` so they stop referencing `h.engine`

Keep coverage for:

- prompt matching through `MockLLM`
- unmatched prompt failure
- `/start-task` and `/auto` behavior
- aborted responses
- queued task automation
- user steering through `userPrompts(...)`
- user control actions through `userEsc()` and `userCtrlC()`

Preserve `/start-task` and `/auto` coverage by creating queued tasks through `h.llm.onPrompt(..., pushTask(...))`, not by direct harness task seeding.

For tree/manual-style tests that previously called `h.pushTask(...)` deep in an existing branch, replace that with an explicit seed prompt from the current branch, for example:

```ts
h.llm.onPrompt("queue BBB", pushTask("Task BBB"));
await h.prompt("queue BBB");
```

Branch-context variant:

```ts
h.llm.onPrompt("queue BBB", pushTask("Task BBB", true));
await h.prompt("queue BBB");
```

Then update branch-history assertions to include:

- `user("queue BBB")`
- `assistant("", "toolUse")`
- `task("Task BBB")`

Remove the harness test that depends on literal slash prompts being sent to the faux model.

## Why this design

This split enforces the actual boundary in the test harness:

- the model can respond or call tools
- the simulated user can steer, cancel, or send new prompts

That keeps tests readable and blocks invalid combinations such as user rules returning LLM tool calls.

## Scope check

This refactor is focused enough for a single implementation plan. It does not need a roadmap.

## Acceptance criteria

- No `ReactionEngine` remains in test-helper code or test call sites.
- `MockLLM` and `MockUser` are the only systems used for those responsibilities.
- `FauxProvider` depends only on `MockLLM`.
- `TestHarness` exposes `h.llm`, `h.user`, and a single public `prompt(...)` method.
- `TestHarness.pushTask(...)` is removed.
- Slash-prefixed input is always slash-processed and never sent literally to the faux model through the harness API.
- Literal slash prompt support is removed intentionally and corresponding tests are updated.
- Existing automation and steering coverage still passes after migration.

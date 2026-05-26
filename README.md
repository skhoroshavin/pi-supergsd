# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills for [Pi](https://pi.dev), plus task-automation commands for running skill-driven branches hands-free.

## Install

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload`.

## Philosophy

Pi deliberately avoids subagents — Mario Zechner's design choice gives you a session tree instead, with full control over what the model sees. Subagents are a black box: invisible contexts, token burn, problematic to  inspect and steer. The session tree is transparent — use `/tree` to branch, navigate, summarize or discard, and you always know what context the model is working with.

The task system in this extension is minimal on purpose: one tool (`push-task`) plus a handful of commands. It doesn't create hidden processes or parallel agents. A task runs as a normal branch in the session tree - you can inspect it with `/tree`, intervene mid-task, or abandon it with `/abort-task`. This gives you subagent-like workflows (queue a fresh-context review, run multiple prepared tasks hands-free with `/auto`) while keeping you in full control.

On top of that, this extension bundles a subset of [Superpowers](https://github.com/obra/superpowers) skills, deterministically patched to match Pi conventions (`/skill:` instead of `superpowers:`, `Pi` instead of `Claude Code`, etc) and to use this task system for context control instead of subagent dispatch.

## Skills

### `/skill:brainstorming`

You MUST use this before any creative work - features, components, functionality, or behavior changes. Explores user intent, requirements, and design before implementation.

The skill walks through understanding the current project context, asking questions one at a time, presenting a design, and getting user approval. It enforces a hard gate: no code, no scaffolding, no implementation until the design is approved. A "simple" feature still gets a design - it can be short, but the gate always applies.

After approval, transitions to the right next planning step: `/skill:writing-roadmaps` for multi-phase designs, or `/skill:writing-plans` for single-phase work. Includes a `spec-document-reviewer-prompt.md` for fresh-context spec review via `push-task`.

### `/skill:executing-plans`

Use when you have a written implementation plan to execute with review checkpoints. Loads the plan, reviews it critically, executes all tasks, and reports when complete.

The skill raises concerns before starting (not during), works through tasks methodically, and pauses at review checkpoints. It assumes the plan was written for an engineer with zero context, so every task includes file paths, code patterns, and testing instructions.

### `/skill:finishing-a-development-branch`

Use when implementation is complete, all tests pass, and you need to decide how to integrate the work. Presents structured options for merge, PR, or cleanup.

Verifies tests pass first, detects the environment (GitHub, local), then presents the appropriate workflow. Handles branch cleanup after integration. No premature celebration - verification before presentation.

### `/skill:receiving-code-review`

Use when receiving code review feedback, before implementing suggestions - especially if feedback seems unclear or technically questionable. Requires technical rigor and verification, not performative agreement or blind implementation.

Read the feedback completely, understand the requirement, verify the claim independently, and only then implement (or push back with evidence). The core principle: verify before implementing, ask before assuming.

### `/skill:requesting-code-review`

Use when completing tasks, implementing major features, or before merging. Crafts a precise review request with structured context - the reviewer sees the work product, not your session history.

Includes the `code-reviewer.md` prompt template for fresh-context review via `push-task`. The reviewer evaluates the diff cold, without anchoring to decisions made during implementation.

### `/skill:systematic-debugging`

Use when encountering any bug, test failure, or unexpected behavior - before proposing fixes. Enforces root-cause investigation before any code change.

The iron law: **no fixes without root cause investigation first**. Random fixes waste time and create new bugs. Includes supporting files for condition-based waiting, defense-in-depth strategies, root-cause tracing, and pressure-test scenarios.

### `/skill:test-driven-development`

Use when implementing any feature or bugfix - before writing implementation code. Write the test first, watch it fail, write minimal code to pass.

Core principle: if you didn't watch the test fail, you don't know if it tests the right thing. Includes `testing-anti-patterns.md` documenting common pitfalls.

### `/skill:verification-before-completion`

Use when about to claim work is complete, fixed, or passing - before committing or creating PRs. Requires running verification commands and confirming output before making any success claims.

The iron law: **no completion claims without fresh verification evidence**. Evidence before assertions, always.

### `/skill:writing-plans`

Use when you have a spec, requirements, or selected roadmap phase - before touching code. Writes comprehensive implementation plans assuming the engineer has zero context.

Every plan includes: which files to touch, code patterns, testing strategy, docs to reference, and how to verify. Tasks are bite-sized and ordered. Includes `plan-document-reviewer-prompt.md` for fresh-context plan review via `push-task`.

### `/skill:writing-roadmaps`

Use when an approved design is too large for one implementation plan, needs ordered phases, or may exceed a single context window.

Creates a coarse, phase-level roadmap between brainstorming and detailed planning. Each phase is independently plannable and leaves the project in a sensible intermediate state (tests green, no half-migrations). This is a custom skill - it doesn't exist in upstream Superpowers and lives entirely in this repo.

### `/skill:writing-skills`

Use when creating new skills, editing existing skills, or verifying skills work before deployment. Applies TDD to process documentation: write test cases, watch them fail, write the skill, watch tests pass.

Includes supporting files for Anthropic best practices, persuasion principles, Graphviz conventions, and testing skills with subagents.

## Extension: task automation

The skills above work on their own. But several of them (brainstorming, requesting-code-review, writing-plans, writing-skills) reference `push-task` for fresh-context review patterns. The extension bundled in this package provides the plumbing.

### The `push-task` tool

The LLM calls `push-task({ prompt: "...", context: "fresh" })`. The `context` parameter is optional (defaults to `"fresh"`):
- `"fresh"` - task runs in a clean context (no prior conversation)
- `"branch"` - task runs on the current branch

This stores a task entry in the session tree. Nothing else happens - no navigation, no branching, no context switch. The tool says "Task stored. Use `/start-task` or `/auto` to start it."

When you later run `/start-task`, the command finds the nearest pending task and injects its prompt as the first message of a new branch. On `/finish-task`, the last assistant response is attached as a result and you jump back.

### `/start-task`

Saves a checkpoint and starts the active task. Requires a pending task from `push-task`. The task's `context` controls whether it runs fresh or on the current branch. Use `/finish-task` to return with results, or `/abort-task` to abandon the branch.

### `/finish-task`

Returns to the task start point and attaches the last assistant message as a branch result. If there's another pending task queued, it's still available for the next `/start-task`.

### `/abort-task`

Jumps back to the task start point without attaching any result. The branch is abandoned - use this when the task was a dead end or you changed direction.

### `/discard-task`

Discards the pending task without executing it. Useful when you queued a task with `push-task` but no longer need it.

### `/auto`

Automatically runs all pending tasks to completion. Starts a task, waits for the LLM to finish, calls `/finish-task`, then checks for the next pending task. Continues until there are no more tasks or the LLM's last response was aborted. Use this for hands-free batch processing of queued tasks - queue several reviews or investigations, then `/auto` to run them all without manual intervention.

### How skills use task automation

Skills that need a fresh-context review don't branch themselves - they queue the work and tell you to run it:

```
LLM:     Spec written. Let me queue a fresh-context review.

LLM:     [calls push-task({ prompt: "Review docs/superpowers/specs/
         feature-design.md for completeness, consistency, and scope.
         Flag anything that needs clarification.", context: "fresh" })]

LLM:     Task stored. Run /start-task or /auto.

You:     /auto

Pi:      [runs task in fresh context, returns with findings]

LLM:     [reads findings] Good catches. Let me fix the error
         handling section first.
```

This keeps your main context clean and gives the reviewer fresh eyes.

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- The `writing-roadmaps` skill is a custom addition, not from upstream.
- Task-automation extension inspired by context-management patterns from [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

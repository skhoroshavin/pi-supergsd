# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills for [Pi](https://pi.dev), plus task-automation commands for running skill-driven branches hands-free.

## Install

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload`.

## Philosophy

Pi's author, Mario Zechner, deliberately avoids subagents — zero observability, poor context transfer, painful debugging. As he puts it: "a black box within a black box." Instead, Pi has a session tree, where you can precisely control what the model sees. That said, Mario still sees value in automating new sessions for some use cases, like code review.

This extension implements a minimal task system that tries to respect these design decisions. It introduces one tool (`push-task`) and a few commands. There are no background processes or parallel agents. A task runs as a normal branch in the session tree, so all standard Pi tools for steering it work as expected. You can start a fresh-context review, then bring results back only after double-checking them. Or you can queue a set of prepared tasks and run them hands-free with `/auto` - still fully inspectable, with the ability to stop and reprompt mid-task if needed.

This extension also bundles a subset of [Superpowers](https://github.com/obra/superpowers) skills, patched for Pi conventions (`/skill:` instead of `superpowers:`, `Pi` instead of `Claude Code`, etc) and routed through the task system rather than dispatching subagents.

## Use cases

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

## Tools and commands reference

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

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- The `writing-roadmaps` skill is a custom addition, not from upstream.
- Task-automation extension inspired by context-management patterns from [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

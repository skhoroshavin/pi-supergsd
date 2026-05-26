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

| Command | Action |
|---|---|
| `/start-task` | Start pending task in a new branch |
| `/finish-task` | Return with assistant response as result |
| `/abort-task` | Return without result |
| `/discard-task` | Discard pending task |
| `/auto` | Run all pending tasks hands-free |

### `push-task` tool

Queues a task with `context` `"fresh"` (clean session) or `"branch"` (current branch). Defaults to `"fresh"`. The task sits pending — nothing runs until you start it.

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- The `writing-roadmaps` skill is a custom addition, not from upstream.
- Task-automation extension inspired by context-management patterns from [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

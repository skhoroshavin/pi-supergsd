# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills for [Pi](https://pi.dev), plus minimal task-automation without subagents, using the Pi session tree.

## Install

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload`.

## Philosophy

Pi's author, Mario Zechner, deliberately avoids subagents — zero observability, poor context transfer, painful debugging. As he puts it: "a black box within a black box." Instead, Pi has a session tree, where you can precisely control what the model sees. That said, Mario still sees value in automating new sessions for some use cases, like code review.

This extension implements a minimal task system that tries to respect these design decisions. It introduces one tool (`push-task`) and a few commands. There are no background processes or parallel agents. A task runs as a normal branch in the session tree, so all standard Pi tools for steering it work as expected. You can start a fresh-context review, then bring results back only after double-checking them. Or you can queue a set of prepared tasks and run them hands-free with `/auto` - still fully inspectable, with the ability to stop and reprompt mid-task if needed.

This extension also bundles a subset of [Superpowers](https://github.com/obra/superpowers) skills, patched for Pi conventions (`/skill:` instead of `superpowers:`, `Pi` instead of `Claude Code`, etc) and routed through the task system rather than dispatching subagents.

## Tools and commands reference

| Command | Action |
|---|---|
| `/start-task` | Saves a checkpoint and starts the pending task in a new branch |
| `/finish-task` | Returns from task branch to saved checkpoint with the assistant response as a result |
| `/abort-task` | Returns from task branch to saved checkpoint without attaching any result |
| `/discard-task` | Discards a pending task without executing it |
| `/auto` | Runs all pending tasks hands-free, including any queued during the run |

### `push-task` tool

Queues a task with `inherit_context` defaulting to `false` (fresh session). Set `inherit_context: true` to continue on the current branch. The task sits pending — nothing runs until you start it.

## Use cases

### Review with in-branch fixes

The LLM queues a review after implementation. You start it manually, fix issues right in the branch, then merge findings back.

```
LLM:     Implementation done. Let me queue a fresh review.

LLM:     [calls push-task({ prompt: "Review the implementation
         against the plan. Check correctness, edge cases,
         and test coverage.", inherit_context: true })]

LLM:     Task stored. Run /start-task to review.

You:     /start-task

Pi:      [branches to fresh context, injects review prompt]

LLM:     [reviews code] Two issues: parse() swallows the original
         error, and the cache isn't invalidated on config changes.

You:     I agree with cache invalidation issue, but error handling
         in parse() was intentional. Adjust your report. 

LLM:     [adjusts report]

You:     /finish-task

Pi:      [returns to main branch with report attached]

LLM:     [reads report] Good catches. Let me fix them.
```

### Batch implementation with /auto

You prepared a detailed multi-phase plan for implementing a feature, and run it hands-free.

```
LLM:     Roadmap has 3 phases. Let me queue phase 1.

LLM:     [calls push-task with phase 1 plan]

You:     /auto

Pi:      [branches to fresh context, injects phase 1 plan]

LLM:     Scaffolds project, writes core types. Let me do clean review.

LLM:     [calls push-task with review prompt]

Pi:      [branches to fresh context, injects review prompt]

LLM:     [reviews code] No issues.

Pi:      [returns to phase 1 implementation branch with report attached]

LLM:     [reads report] No issues - good. Phase 1 done, ready for phase 2.

Pi:      [returns to main branch, with report attached]

LLM:     [reads report] Great! Let me queue phase 2.

LLM:     [calls push-task with phase 2 plan]

Pi:      [branches to fresh context, injects phase 2 plan]

LLM:     Implements CLI, adds tests. Let me queue a review.

... and so on until finished, blocked or interrupted by user.
```

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- Context-management ideas were inspired by [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

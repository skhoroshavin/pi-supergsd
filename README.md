# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills for [Pi](https://pi.dev), plus minimal task-automation without subagents, using the Pi session tree.

## Install

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload`.

## Philosophy

Pi coding agent doesn't include a built-in sub-agent tool. Its author [Mario Zechner](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) explains why: they're "a black box within a black box" — you can't see what they do, context doesn't transfer well, and debugging is painful. Pi's session tree gives you that control instead.

This extension adds a minimal task system that keeps those principles: minimal, in your control, nothing hidden. It introduces one tool (`push-task`) and a few commands. No background processes, no parallel agents. A task runs as a branch in the session tree, so standard Pi tools work as expected. Start a fresh-context review, check the results, bring them back. Or queue tasks and run them hands-free with `/auto`, while still seeing everything that's happening and able to stop, reprompt, and continue at any point.

This extension also bundles a subset of [Superpowers](https://github.com/obra/superpowers) skills, adapted for Pi and routed through the task system rather than dispatching subagents.

## Tools and commands reference

| Command               | Action                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| `/start-task [model]` | Saves a checkpoint and starts the pending task in a new branch                       |
| `/finish-task`        | Returns from task branch to saved checkpoint with the assistant response as a result |
| `/abort-task`         | Returns from task branch to saved checkpoint without attaching any result            |
| `/discard-task`       | Discards a pending task without executing it                                         |
| `/auto`               | EXPERIMENTAL! Runs all pending tasks hands-free, including any queued during the run |

If `[model]` is passed to `/start-task`, the model switches before the task prompt is sent. On `/finish-task` or `/abort-task`, the original model is restored.

### `push-task` tool

Queues a task with required `title` and `prompt`. Tasks always start from fresh context. The task sits pending — nothing runs until you start it.

## Use cases

### Review with fresh context

The LLM queues a review after implementation. You start it manually, correct review right in the branch, and then merge findings back.

```
LLM:     Implementation done. Let me queue a fresh review.

LLM:     [calls push-task({ title: "Review implementation", prompt: "Review the implementation
         against the plan. Check correctness, edge cases,
         and test coverage."})]

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

LLM:     [calls push-task({ title: "Implement phase 1", prompt: "..." })]

You:     /auto

Pi:      [branches to fresh context, injects phase 1 plan]

LLM:     Scaffolds project, writes core types. Let me do clean review.

LLM:     [calls push-task({ title: "Review phase 1", prompt: "..." })]

Pi:      [branches to fresh context, injects review prompt]

LLM:     [reviews code] No issues.

Pi:      [returns to phase 1 implementation branch with report attached]

LLM:     [reads report] No issues - good. Phase 1 done, ready for phase 2.

Pi:      [returns to main branch, with report attached]

LLM:     [reads report] Great! Let me queue phase 2.

LLM:     [calls push-task({ title: "Implement phase 2", prompt: "..." })]

Pi:      [branches to fresh context, injects phase 2 plan]

LLM:     Implements CLI, adds tests. Let me queue a review.

... and so on until finished, blocked or interrupted by user.
```

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- Context-management ideas were inspired by [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

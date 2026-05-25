# `/start-task` Migration — Skill Updates Design

**Status:** approved
**Date:** 2026-05-25

## Purpose

Update pi-supergsd skills to use `push-task`'s new `context` parameter, the `/start-task` command, and `/return` verbatim handoff — all introduced in pi-navigator's handoff mode update. Skills currently reference the older `/start-fresh`-based workflow.

## Background

pi-navigator recently added:

- **`push-task` `context` parameter** — `"fresh"` (default) or `"branch"`, controlling context mode
- **`/start-task` command** — consumes a pending task, starts it as a subagent. Uses `last-response` handoff so the result comes back verbatim
- **`/start-branch` and `/start-fresh` no longer consume tasks** — they ignore pending tasks, which stay queued for `/start-task`
- **`/return` overrides** — `/return last` (verbatim), `/return summary` (forced summary)

## Scope

Update four skills that already use `push-task` + `/start-fresh`:

| Skill | Context | Push-task calls |
|---|---|---|
| brainstorming | `fresh` | 1 |
| writing-plans | `fresh` | 1 |
| requesting-code-review | `fresh` | 1 (+ example) |
| writing-skills | `branch` | 3 |

## Per-Skill Changes

### Common pattern for fresh-context skills (brainstorming, writing-plans, requesting-code-review)

**Before:**
```
Call `push-task({ prompt: "..." })`
Tell the user: "Run `/start-fresh` for a fresh-context review..."
After `/return`, incorporate the summary findings...
```

**After:**
```
Call `push-task({ prompt: "...", context: "fresh" })`
Tell the user: "Run `/start-task` for a fresh-context review..."
After `/return`, incorporate the review findings...
```

Key change: "summary findings" → "review findings" because `/start-task` uses `last-response` handoff (verbatim result, not summarized).

### writing-skills (branch context)

**Before:**
```
Call `push-task({ prompt: <pressure scenario> })`
Tell the user: "Run `/start-fresh` to run the baseline scenario."
After `/return`, document the agent's choices...
```

**After:**
```
Call `push-task({ prompt: <pressure scenario>, context: "branch" })`
Tell the user: "Run `/start-task` to run the baseline scenario."
After `/return`, document the agent's choices...
```

All three push-task calls (RED baseline, GREEN with-skill, REFACTOR verification) use `context: "branch"` so the agent retains memory of the skill it just wrote and the design decisions behind it.

### Additional: requesting-code-review example

The example `push-task` call in the narrative body (line ~59) gets the same treatment.

## Design Principles

1. **Conditional with fallback** — unchanged from prior design. Every `push-task` instruction keeps its "Otherwise:" fallback.
2. **User controls transitions** — unchanged. The LLM calls `push-task`, tells the user to run `/start-task`.
3. **Self-contained prompts** — unchanged. Prompts passed to `push-task` must be fully self-contained. This is already true; no prompt content changes.
4. **`context` explicit** — always include the `context` parameter for clarity, even when it matches the default (`"fresh"`).
5. **Verbatim results** — note that `/start-task` returns the last assistant message verbatim (not summarized), which is a benefit for review tasks.

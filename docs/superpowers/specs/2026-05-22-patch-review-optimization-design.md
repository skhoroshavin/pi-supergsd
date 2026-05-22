# Patch Review & Optimization Design

## Context

A review of `pi-supergsd`'s applied patches revealed two issues after verifying all 31 patches match upstream cleanly (updater reports `Failed: 0`).

## Goals

1. Fix broken content in `writing-plans/SKILL.md` where a `delete-block` patch removed the subagent-driven execution option but left a "Two execution options:" intro referring to a non-existent option 1.
2. Remove a dead common patch that never matches upstream content.

## Non-Goals

- Removing subagent references (adapted later via Pi's `/tree` mechanics)
- Modifying `anthropic-best-practices.md` (remains as Anthropic's Claude-specific guide)
- Touching the visual companion (confirmed working in Pi via self-contained scripts)
- Any other patch changes (all 31 patches align with upstream)

## Changes

### 1. Fix `writing-plans` execution handoff intro

**File:** `updater/skills/writing-plans.json`

**Current state:** The `delete-block` patch removes the "Subagent-Driven" section but leaves this intro intact:

```markdown
**"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Two execution options:**


**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints
```

**Problem:** "Two execution options:" promises two choices but only option 2 is visible. The blank line where option 1 used to be is confusing.

**Fix:** Replace the intro framing. After the `delete-block` and `delete-line` patches run, add a `replace` patch that rewrites the handoff paragraph to describe inline execution as the standard workflow, without the "two options" framing.

### 2. Remove dead common patch

**File:** `updater/common-patch.json`

**Current state:** Contains three patches:
1. `Claude Code` → `Pi`
2. `superpowers:` → `/skill:`
3. `TodoWrite` → `a todo list`

**Problem:** Patch #3 never matches upstream content. It was likely needed at one point but upstream removed or changed the text. It adds noise and confusion.

**Fix:** Remove patch #3. The file should contain only the two active patches.

## Verification

After changes:
- `npm run updater` must report `Failed: 0`
- `git diff skills/writing-plans/SKILL.md` must show clean execution handoff text
- `cat updater/common-patch.json` must show exactly 2 patches
- All other generated skills must remain identical to pre-change state

## Risks

| Risk | Mitigation |
|------|------------|
| `writing-plans` patch doesn't match upstream if upstream changed | Run updater before committing; if failed, debug `find` string against upstream content |
| Removing `TodoWrite` patch was actually needed for a file I didn't check | Run updater before and after; any newly-failed patch signals this |

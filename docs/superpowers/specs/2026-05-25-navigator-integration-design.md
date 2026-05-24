# Navigator Integration — Skill Updates Design

**Status:** draft  
**Date:** 2026-05-25

## Purpose

Update pi-supergsd skills to explicitly use the `push-task` tool (from the `pi-navigator` extension) and the `/start-fresh`/`/return` commands where skills currently reference subagent dispatch or fresh-context review. The goal is to make skills actionable when `pi-navigator` is installed, while remaining self-contained with inline fallbacks when it is not.

## Background

Upstream `obra/superpowers` has two skills built entirely on subagent dispatch (`subagent-driven-development`, `dispatching-parallel-agents`) that were excluded from pi-supergsd because Pi had no built-in `Task` tool. The `pi-navigator` extension (local package, already installed) now provides:

- **`push-task` tool** — stores a prompt in the session tree as a custom entry
- **`/start-branch`** — bookmark current position, inject pending task, keep working in place
- **`/start-fresh`** — bookmark current position, jump to empty context, inject pending task
- **`/return`** — navigate back to checkpoint with branch summary
- **`/cancel`** — navigate back without summary
- **`/discard-task`** — mark pending task as consumed without executing

This is a sequential, user-driven branching mechanism. It is not parallel subagent dispatch — the user types commands at transitions, the LLM calls `push-task` but never calls the commands. It replaces the "fresh subagent per task" concept with "fresh context per task, user controls the handoff."

## Design Principles

1. **Conditional with fallback.** Every `push-task` instruction includes an explicit "if available / otherwise" branch. Skills must work whether or not `pi-navigator` is installed.
2. **User controls transitions.** The LLM calls `push-task`, then tells the user which `/start-*` command to run. The user runs it. The LLM does not call commands automatically.
3. **Fresh context, not fresh agent.** Replace "dispatch a subagent" language with "get a fresh-context review using `/start-fresh`" — conceptually accurate for what the navigator does.
4. **Self-contained prompts.** Every prompt passed to `push-task` must be fully self-contained. It cannot reference "above", "previous conversation", or "the design we just discussed" — `/start-fresh` provides empty context. The prompt must include all necessary context (file paths, requirements, scope) in its own text.
5. **Test compliance.** Updated skills must be tested using the `writing-skills` methodology (pressure scenarios, RED-GREEN-REFACTOR).

## Scope

### In scope

Update these skills to conditionally reference `push-task` + `/start-fresh`/`/return`:

| Skill | File(s) | Where subagents / fresh review are mentioned |
|---|---|---|
| `brainstorming` | `SKILL.md`, `spec-document-reviewer-prompt.md` | Step 6 (spec self-review), Step 8 (user review gate) |
| `writing-plans` | `SKILL.md`, `plan-document-reviewer-prompt.md` | Self-review section ("not a subagent dispatch") |
| `requesting-code-review` | `SKILL.md`, `code-reviewer.md` | "Dispatch code reviewer subagent" pattern |
| `writing-skills` | `SKILL.md`, `testing-skills-with-subagents.md`, `examples/CLAUDE_MD_TESTING.md` | "Run pressure scenario with subagent" testing methodology |

### Also in scope

- Update `updater/skills/*.json` patch definitions so regenerated skills include the changes
- Update `updater/common-patch.json` if a global substitution applies
- After patching the 4 in-scope skills, audit remaining skills for stray "subagent" references and patch individually
- Test updated skills using the `writing-skills` RED-GREEN-REFACTOR methodology

### Out of scope

- Creating a new `subagent-driven-development` equivalent skill. The `executing-plans` skill already covers inline plan execution. The navigator mechanism is sequential and user-driven, not automatic per-task dispatch — it does not map cleanly to the upstream skill's continuous execution model.
- `dispatching-parallel-agents`. No parallel execution in navigator. This upstream skill remains out of scope.
- Installing or modifying `pi-navigator` itself. This is a skill update project, not an extension project.

## Per-Skill Changes

### 1. brainstorming

**Current state:** Step 6 is "Write design doc". Step 7 is "Spec self-review" — a checklist run inline. Step 8 asks the user to review the spec before proceeding. `spec-document-reviewer-prompt.md` exists but is never invoked from `SKILL.md`.

**Change:** Step 7 (Spec self-review) becomes a conditional:

```
**Step 7: Spec self-review**

**If the `push-task` tool is available:**
1. Call push-task({ prompt: <content from spec-document-reviewer-prompt.md> })
   The prompt must be self-contained — it cannot reference "above" or prior
   conversation, because `/start-fresh` provides empty context.
2. Tell the user: "Run `/start-fresh` for a fresh-context review of the spec."
3. After the user runs `/return`, incorporate the summary findings and fix any gaps
   in the spec before proceeding to Step 8.

**Otherwise:**
Run the Spec Self-Review checklist inline (existing Step 7 content).
```

Step 7 is updated to say it can be done either via `push-task` + `/start-fresh` or inline.

`spec-document-reviewer-prompt.md` is updated:
- Remove the `Task tool (general-purpose)` YAML wrapper entirely
- Remove metadata lines (`Purpose:`, `Dispatch after:`, `Reviewer returns:`) — these are instructions for the skill user, not content for the reviewing agent
- Keep only the review body (the prompt text that describes what to check, calibration, and output format)
- Rewrite as a plain markdown prompt suitable for passing directly to `push-task({ prompt: ... })`
- Rename title to "Fresh-Context Spec Review Prompt Template"
- Replace "Use this template when dispatching a spec document reviewer subagent" with "Use this template as the prompt argument to `push-task` when requesting a fresh-context spec review."

**Fallback:** Inline self-review checklist (already exists, kept as default).

### 2. writing-plans

**Current state:** The "Self-Review" section says "This is a checklist you run yourself — not a subagent dispatch." There is a `plan-document-reviewer-prompt.md` that is not referenced from `SKILL.md`.

**Change:** Replace the existing "Self-Review" section with a conditional wrapper:

```
## Self-Review

**Fresh-context plan review (optional but recommended):**

**If the `push-task` tool is available:**
1. Call push-task({ prompt: <content from plan-document-reviewer-prompt.md> })
2. Tell the user: "Run `/start-fresh` for a fresh-context review of the plan."
3. After `/return`, fix any gaps before committing the plan.

**Otherwise:**
Run the Self-Review checklist inline (existing content).
```

The "Self-Review" section header is kept. The first paragraph is replaced with the conditional. The existing checklist content becomes the "Otherwise" branch.

`plan-document-reviewer-prompt.md` is updated:
- Remove the `Task tool (general-purpose)` YAML wrapper entirely
- Remove metadata lines (`Purpose:`, `Dispatch after:`, `Reviewer returns:`) — these are instructions for the skill user, not content for the reviewing agent
- Keep only the review body (the prompt text that describes what to check, calibration, and output format)
- Rewrite as a plain markdown prompt suitable for passing directly to `push-task({ prompt: ... })`
- Rename title to "Fresh-Context Plan Review Prompt Template"
- Replace subagent dispatch language with `push-task` language

**Fallback:** Inline self-review checklist (already exists).

### 3. requesting-code-review

**Current state:** Mentions "Dispatch code reviewer subagent" and references subagent-driven development. The `code-reviewer.md` template describes a subagent dispatch pattern.

**Change:** Core review flow becomes:

```
**If the `push-task` tool is available:**
1. Call push-task({ prompt: <review prompt with BASE_SHA, HEAD_SHA, description> })
2. Tell the user: "Run `/start-fresh` for a fresh-context code review."
3. After `/return`, read the branch summary and act on feedback.

**Otherwise:**
Use the code-reviewer.md template for your review process.
```

Remove the entire **Subagent-Driven Development:** section under "## Integration with Workflows" — this skill does not exist in pi-supergsd. Also remove "- After each task in subagent-driven development" from "When to Request Review" and replace with a generic "- After completing a focused task or sub-task".

`code-reviewer.md` is updated:
- Remove any `Task tool (general-purpose)` YAML wrapper if present
- Remove metadata lines (`Purpose:`, `Dispatch after:`, `Reviewer returns:`) — these are instructions for the skill user, not content for the reviewing agent
- Keep only the review body (the prompt text that describes what to check, expected output)
- Rewrite as a plain markdown prompt suitable for passing directly to `push-task({ prompt: ... })`
- Replace "Use this template when requesting a code review" with "Use this template as the prompt argument to `push-task` when requesting a fresh-context code review."
- Ensure the prompt is self-contained (includes all context needed: BASE_SHA, HEAD_SHA, description in the prompt body, not as external fields)

`SKILL.md` example:
- Replace the multi-field structured example (DESCRIPTION:, BASE_SHA:, HEAD_SHA:) with a single prompt string passed to `push-task({ prompt: ... })`
- The example should show the `code-reviewer.md` content (filled in with actual values) as the prompt value
- Replace "[Dispatch code reviewer subagent]" with "[Call push-task with review prompt]"
- Replace "[Subagent returns]" with "[After /return, branch summary contains]"

**Fallback:** Use `code-reviewer.md` template inline (prompt the LLM to self-review using the template as a checklist).

### 4. writing-skills

**Current state:** "You write test cases (pressure scenarios with subagents), watch them fail..." The testing methodology assumes a subagent can be dispatched to run a scenario.

**Change:** Replace "subagent" language with "agent" or "fresh context" throughout. The testing methodology becomes:

```
**RED Phase — Baseline Test:**

**If the `push-task` tool is available:**
1. Call push-task({ prompt: <pressure scenario> })
2. Tell the user: "Run `/start-fresh` to run the baseline scenario."
3. After `/return`, document the agent's choices and rationalizations verbatim.

**Otherwise:**
Run the scenario in the current session and document the agent's behavior.
```

Similarly for GREEN (verify with skill):

```
**GREEN Phase — Verify with Skill:**

**If `push-task` is available:**
1. Call push-task({ prompt: <same scenario + skill loaded> })
2. Tell user: "Run `/start-fresh` to verify the skill works."
3. After `/return`, confirm agent now complies.

**Otherwise:**
Run the scenario in current session with the skill loaded.
```

Similarly for REFACTOR (re-test after closing loopholes):

```
**REFACTOR Phase — Re-Test:**

**If `push-task` is available:**
1. Call push-task({ prompt: <updated scenario + updated skill loaded> })
2. Tell user: "Run `/start-fresh` to verify the updated skill works."
3. After `/return`, confirm agent now complies and no new rationalizations appear.

**Otherwise:**
Run the scenario in current session with the updated skill loaded.
```

`testing-skills-with-subagents.md` — keep the filename and patch content only. The updater architecture maps upstream paths to output paths directly; renaming would require updater code changes. Update all content references from "subagent" to "agent" or "fresh context". Update references in `SKILL.md`.

**Note on filename/content mismatch:** The file retains "subagents" in its name (upstream path) while content will say "agent" or "fresh context". `SKILL.md` should include a brief note: "The filename references a legacy term; the content uses the current navigator terminology."

`examples/CLAUDE_MD_TESTING.md`: Replace "Create subagent test harness" with "Run baseline scenario with fresh context".

**Fallback:** Run scenarios in current session. This is less ideal (agent may be influenced by context) but works without navigator.

## Patch Strategy

All changes go through the updater's declarative patch system:

1. **Per-file patches** in `updater/skills/<name>.json` — target specific upstream content
2. **Common patches** in `updater/common-patch.json` — global substitutions (e.g., "subagent" → "agent")

After updating `.json` definitions, run `npm run updater` to regenerate `skills/`.

### Files to patch (updater/skills/*.json)

| Definition | Files patched |
|---|---|
| `brainstorming.json` | `SKILL.md`, `spec-document-reviewer-prompt.md` |
| `writing-plans.json` | `SKILL.md`, `plan-document-reviewer-prompt.md` |
| `requesting-code-review.json` | `SKILL.md`, `code-reviewer.md` |
| `writing-skills.json` | `SKILL.md`, `testing-skills-with-subagents.md`, `examples/CLAUDE_MD_TESTING.md` |

### Common patch additions

Do NOT add a global `subagent` → `agent` replace to `common-patch.json`. A naive global replace creates grammar errors (e.g., "not a agent dispatch") and risks mutating URLs, compound terms, or file path references. Instead, handle each occurrence via per-file patches where context is controlled.

#### Per-file regex-replace tip

If a per-file patch needs to replace "subagent" with "agent", use word boundaries:
```json
{ "op": "regex-replace", "find": "\\bsubagent\\b", "replace": "agent" }
```

## Testing Plan

After updating skills, test each changed skill using the `writing-skills` methodology. Note: `writing-skills` itself is being updated, so test it first (using its own updated fallback methodology — run scenarios inline if `push-task` is not available). Once `writing-skills` is verified, use it to test the other three skills.

1. **Baseline (RED):** Create a pressure scenario that should trigger the skill's guidance. Run without the skill loaded. Document failures.
2. **With skill (GREEN):** Run same scenario with the updated skill. Verify compliance.
3. **REFACTOR:** If agent finds loopholes, update skill and re-test.

Specific test scenarios:

| Skill | Test scenario |
|---|---|
| `brainstorming` | Agent writes a spec, then at Step 7 should offer fresh-context review via `push-task` as alternative to inline self-review |
| `writing-plans` | Agent writes a plan, then should offer fresh-context review via `push-task` |
| `requesting-code-review` | Agent completes code, then should call `push-task` with a single prompt string containing review context |
| `writing-skills` | Agent should describe testing methodology using `push-task` when available |

## Migration Checklist

- [ ] Update `updater/skills/brainstorming.json`
- [ ] Update `updater/skills/writing-plans.json`
- [ ] Update `updater/skills/requesting-code-review.json`
- [ ] Update `updater/skills/writing-skills.json`
- [ ] Verify no unsafe `subagent` → `agent` additions in `updater/common-patch.json`
- [ ] Audit remaining skills for stray "subagent" references: `grep -ri "subagent" skills/` and patch individually
- [ ] Run `npm run updater`
- [ ] Review generated skills for correctness
- [ ] Run `npm run fix`
- [ ] Run `npm run verify`
- [ ] Test each updated skill (pressure scenarios)
- [ ] Commit all changes

## Risks

| Risk | Mitigation |
|---|---|
| Per-file patches missing a "subagent" occurrence | Run `npm run updater` — unmatched patches fail the build, forcing review |
| `push-task` instructions are verbose, bloat skill docs | Keep fallback sections short; move detailed prompt templates to separate files |
| Testing requires navigator extension installed | Test with navigator installed; verify fallback by testing in a fresh Pi session without pi-navigator loaded |
| Upstream adds new subagent references | updater fails on unmatched patches — intentional drift detection |

## Decision Log

| Decision | Rationale |
|---|---|
| Approach C (conditional with fallback) | Skills must work with or without pi-navigator installed |
| `/start-fresh` for code review, not `/start-branch` | Review benefits from zero prior context; avoids anchoring to implementation decisions |
| No new `subagent-driven-development` equivalent | Navigator is sequential and user-driven, not automatic continuous dispatch; `executing-plans` already covers inline execution |
| Per-file patches for "subagent" → "agent" with word boundaries | Controlled context prevents grammar errors and URL mutation |
| Test compliance using `writing-skills` methodology | Eating our own dogfood; skills that teach testing must themselves be tested |

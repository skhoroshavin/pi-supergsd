# Skill Patch Simplification Design

**Status:** draft  
**Date:** 2026-05-25

## Purpose

Simplify pi-supergsd's current skill patches for task-based review flows while preserving upstream structure as much as possible. The goal is to reduce patch size and drift, make the generated skills more naturally compliant with the built-in `push-task` tool, and stop inserting workflow details at a lower level than the upstream text uses.

## Background

Recent work added task-based review flows to four skills:

- `brainstorming`
- `writing-plans`
- `requesting-code-review`
- `writing-skills`

That work succeeded functionally, but several patches now do more rewriting than necessary:

- they inject `push-task` workflow text into checklist items instead of patching the actual review section
- they add explicit command coaching such as "Run `/start-task` ..." even though the `push-task` tool already tells the user that
- they introduce explicit `push-task({ ... })` call syntax where upstream only referred to subagents or the Task tool at a higher level
- they heavily rewrite reviewer prompt template files even though this project goal is to simplify our patches, not to re-author upstream skills

The task tooling now lives in this package and is always available, so the skills can rely on `push-task` unconditionally. At the same time, the design should stay close to upstream wording so future upstream updates remain easy to absorb.

## Goals

1. Reduce drift between upstream skill content and generated Pi skills.
2. Keep task-tool wording at the same abstraction level as upstream.
3. Patch the actual upstream section that discusses review or subagent use, not a nearby checklist item unless upstream itself does that.
4. Remove redundant user-command coaching from skills.
5. Keep reviewer prompt template edits minimal.

## Non-Goals

- No updater architecture changes.
- No new patch operations or snippet-file system.
- No conversion of reviewer prompt templates into prompt-only documents.
- No broad rewriting of skill structure, flowcharts, or examples unless needed to remove stale subagent wording.
- No changes outside the affected skills and their currently patched template files.

## Design Principles

### 1. Preserve upstream structure

If upstream has a dedicated review section, patch that section. Do not move workflow into checklist numbering just because it is convenient to match text.

### 2. Preserve upstream abstraction level

If upstream says "dispatch a subagent" or "use Task tool," replace that with `push-task` terminology at the same level:

- "dispatch a subagent" → "use the `push-task` tool"
- "subagent returns" → "act on the returned task result when you get it"

Do not introduce explicit `push-task({ prompt: ..., context: ... })` syntax unless upstream already used equally explicit tool-call syntax.

### 3. Do not restate what the tool already says

The `push-task` tool already tells the user to run `/start-task`. Skills should not repeat that instruction unless upstream had a reason to include equivalent user guidance that still matters after the tool change.

### 4. Keep prompt-template edits minimal

Prompt-template files should stay close to upstream. If they need wording changes, those should be limited to stale terminology such as "subagent" or "Task tool" where necessary. Avoid structural rewrites.

### 5. Use task-result wording, not branch-summary wording

The source branch does not see the task branch's interactive prompts. What returns is the task result. Skill wording should say to act on the returned task result when it arrives.

## Scope

### In scope

- `updater/skills/brainstorming.json`
- `updater/skills/writing-plans.json`
- `updater/skills/requesting-code-review.json`
- `updater/skills/writing-skills.json`
- corresponding generated skill files under `skills/`
- currently patched review-template files only where minimal terminology cleanup is still needed

### Out of scope

- `executing-plans`, `receiving-code-review`, `verification-before-completion`, or unrelated skills
- `updater/common-patch.json` unless a truly global low-risk substitution becomes obvious during implementation

## Per-Skill Changes

### 1. `brainstorming`

**Current problem:**
A patch injects a numbered `push-task` mini-workflow directly between checklist items 7 and 8. This creates awkward numbering, duplicates the later self-review section, and patches the wrong part of the document.

**Required simplification:**
- Remove the checklist injection patch.
- Restore checklist item 7 to a short self-review description.
- Patch the real `**Spec Self-Review:**` section instead.
- The new wording should say, in upstream-style prose, that the spec review should use the `push-task` tool with `spec-document-reviewer-prompt.md`, then act on the returned task result and fix issues inline.
- Do not add explicit `push-task({ ... })` syntax.
- Do not add `Run /start-task` instructions.

**Template file handling:**
- Revisit `spec-document-reviewer-prompt.md`.
- Keep or reduce its patching only as needed to remove stale task/subagent wording.
- Do not rewrite it further into a prompt-only artifact.

### 2. `writing-plans`

**Current problem:**
The patch prepends a task-workflow block to `## Self-Review`, but the rest of the section still reads like the old inline checklist. This is workable but heavier than necessary.

**Required simplification:**
- Replace the self-review intro with a short upstream-style sentence or paragraph that says to use the `push-task` tool with `plan-document-reviewer-prompt.md`, act on the returned task result when it arrives, and then run or complete the checklist.
- Preserve the existing checklist content below it.
- Remove explicit tool-call syntax.
- Remove `Run /start-task` coaching.

**Template file handling:**
- Revisit `plan-document-reviewer-prompt.md`.
- Keep any edits minimal and terminology-focused.

### 3. `requesting-code-review`

**Current problem:**
This skill currently adds explicit `push-task({ ... })` call syntax and command coaching in places where upstream discussed reviewer subagents or Task tool usage more generically.

**Required simplification:**
- Patch upstream mentions of dispatching a code-reviewer subagent into using the `push-task` tool.
- Keep the same abstraction level as upstream text.
- Replace wording like "Subagent returns" or "branch summary" with "returned task result" or equivalent.
- Keep the example structure, but simplify labels so they refer to the `push-task` tool rather than a subagent.
- Remove command coaching.

**Template file handling:**
- Revisit `code-reviewer.md`.
- Retain only minimal changes needed for terminology or compatibility.
- Do not keep the current broad rewrite if a lighter patch can express the same intent.

### 4. `writing-skills`

**Current problem:**
The RED/GREEN/REFACTOR sections currently introduce explicit `push-task({ ... })` calls and user-command instructions. That is more specific than upstream's subagent wording.

**Required simplification:**
- Replace subagent-oriented testing instructions with `push-task` terminology at the same level of detail as upstream.
- In RED, GREEN, and REFACTOR sections, say to use the `push-task` tool to run the scenario and then act on the returned task result when it arrives.
- Keep the surrounding testing methodology intact.
- Remove command coaching.
- Preserve `context` details only if the upstream wording already justifies that level of specificity; otherwise avoid embedding literal parameter syntax in the skill text.

**Supporting files:**
- Revisit `testing-skills-with-subagents.md` and `examples/CLAUDE_MD_TESTING.md` only for minimal terminology cleanup.
- Keep filename retention as-is; no renames.

## Patch Strategy

Implementation should prefer the smallest patch that changes the right upstream sentence:

1. Find the upstream sentence or paragraph that discusses inline self-review, Task tool usage, or subagent dispatch.
2. Replace only that sentence or paragraph.
3. Avoid inserting new numbered workflow blocks unless upstream already uses one at that exact location.
4. Avoid patching prompt-template structure unless necessary.

In practice this means fewer large multi-line replacements and more targeted replacements against the actual semantic section.

## Verification

After implementation:

1. Run `npm run updater`.
2. Inspect generated diffs in:
   - `skills/brainstorming/SKILL.md`
   - `skills/writing-plans/SKILL.md`
   - `skills/requesting-code-review/SKILL.md`
   - `skills/writing-skills/SKILL.md`
3. Confirm the generated text:
   - no longer tells the user to run `/start-task`
   - no longer mentions `/finish-task`
   - refers to returned task results rather than branch summaries
   - patches the real review section instead of injecting workflow into an adjacent checklist when upstream already has a review section
4. Review any remaining changes in:
   - `skills/brainstorming/spec-document-reviewer-prompt.md`
   - `skills/writing-plans/plan-document-reviewer-prompt.md`
   - `skills/requesting-code-review/code-reviewer.md`
   to confirm they are minimal and still justified

Recommended grep checks:

```bash
rg -n 'Run `/start-task`|/finish-task|branch summary' skills/brainstorming skills/writing-plans skills/requesting-code-review skills/writing-skills
```

Expected result after regeneration: no matches in the four main `SKILL.md` files for these obsolete or redundant phrasings.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Minimal patches fail to express task-tool behavior clearly enough | Keep wording direct, but at prose level rather than API-syntax level |
| Removing explicit examples causes ambiguity | Preserve existing upstream examples and change only the stale subagent/task terms |
| Template-file patch reduction reintroduces stale wording | Audit generated template files after updater run and keep only the smallest necessary terminology fixes |
| Future upstream edits move the targeted sentences | Prefer small patches against stable semantic text in the actual review section |

## Expected Outcome

The generated skills should still clearly tell Pi to use task-based review flows, but they should read much closer to upstream:

- fewer inserted workflow blocks
- less command coaching
- fewer explicit pseudo-code tool calls
- smaller and easier-to-maintain patch definitions
- better compatibility with future upstream updates

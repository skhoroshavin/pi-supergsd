# Patch Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce updater patches to mechanical substitutions + Pi-specific features, preserving all upstream instructional content.

**Architecture:** Three-phase: fix reviewer-prompt files to use structural translation instead of destructive rewriting; fix writing-skills patches that rewrite instructional content; verify and commit. No code changes — only `updater/skills/*.json` definitions change.

**Tech Stack:** JSON patch definitions, `npm run updater` for regeneration, `npm run verify` for gate.

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

All changes are to `updater/skills/*.json` files. No other files touched.

| File | Changes |
|---|---|
| `updater/skills/brainstorming.json` | Replace spec-document-reviewer-prompt.md patches |
| `updater/skills/writing-plans.json` | Replace plan-document-reviewer-prompt.md patches |
| `updater/skills/requesting-code-review.json` | Replace code-reviewer.md patches |
| `updater/skills/writing-skills.json` | Fix 3 patches that rewrite instead of translate |

`updater/common-patch.json` and other skill definitions unchanged.

### Task 1: Fix `brainstorming.json` — spec-document-reviewer-prompt.md patches

**Files:**
- Modify: `updater/skills/brainstorming.json`

Replace the current 4-patch destructive approach with 2-patch structural translation.

- [ ] **Step 1: Replace spec-document-reviewer-prompt.md patches**

Open `updater/skills/brainstorming.json`. In the `files` array, find the entry with `"path": "spec-document-reviewer-prompt.md"`. Replace its `"patches"` array with:

```json
"patches": [
  {
    "op": "replace",
    "find": "Use this template when dispatching a spec document reviewer subagent.",
    "replace": "Use this template as the prompt argument to `push-task` when requesting a fresh-context spec review."
  },
  {
    "op": "replace",
    "find": "Task tool (general-purpose):\n  description: \"Review spec document\"\n  prompt: |",
    "replace": "push-task:\n  prompt: |"
  }
]
```

This replaces: 1 delete-line, 1 delete-line, 1 regex-replace, and the header replace (which combined header+body into one giant find). The new approach keeps the opening ``` fence, all prompt body content, "Dispatch after", "Reviewer returns", and closing ``` — everything upstream wrote.

- [ ] **Step 2: Run updater to verify patches match**

```bash
npm run updater
```

Expected: exits 0, no "WARNING: patch did not match" for brainstorming spec-document-reviewer-prompt.md.

- [ ] **Step 3: Spot-check generated output**

```bash
grep -n "Reviewer returns" skills/brainstorming/spec-document-reviewer-prompt.md
grep -n "Dispatch after" skills/brainstorming/spec-document-reviewer-prompt.md
```

Expected: both lines present (were previously stripped).

- [ ] **Step 4: Commit**

```bash
git add updater/skills/brainstorming.json skills/brainstorming/spec-document-reviewer-prompt.md
git commit -m "fix(skills): structural translation for spec-document-reviewer-prompt, preserve upstream content"
```

### Task 2: Fix `writing-plans.json` — plan-document-reviewer-prompt.md patches

**Files:**
- Modify: `updater/skills/writing-plans.json`

Same pattern as Task 1.

- [ ] **Step 1: Replace plan-document-reviewer-prompt.md patches**

In `updater/skills/writing-plans.json`, find the entry with `"path": "plan-document-reviewer-prompt.md"`. Replace its `"patches"` array with:

```json
"patches": [
  {
    "op": "replace",
    "find": "Use this template when dispatching a plan document reviewer subagent.",
    "replace": "Use this template as the prompt argument to `push-task` when requesting a fresh-context plan review."
  },
  {
    "op": "replace",
    "find": "Task tool (general-purpose):\n  description: \"Review plan document\"\n  prompt: |",
    "replace": "push-task:\n  prompt: |"
  }
]
```

- [ ] **Step 2: Run updater**

```bash
npm run updater
```

Expected: exits 0, no warnings for writing-plans plan-document-reviewer-prompt.md.

- [ ] **Step 3: Spot-check output**

```bash
grep -n "Reviewer returns" skills/writing-plans/plan-document-reviewer-prompt.md
grep -n "Dispatch after" skills/writing-plans/plan-document-reviewer-prompt.md
```

Expected: both present.

- [ ] **Step 4: Commit**

```bash
git add updater/skills/writing-plans.json skills/writing-plans/plan-document-reviewer-prompt.md
git commit -m "fix(skills): structural translation for plan-document-reviewer-prompt, preserve upstream content"
```

### Task 3: Fix `requesting-code-review.json` — code-reviewer.md patches

**Files:**
- Modify: `updater/skills/requesting-code-review.json`

Same pattern. The code-reviewer.md file is larger (has example output section), and our current patches strip all of it.

- [ ] **Step 1: Replace code-reviewer.md patches**

In `updater/skills/requesting-code-review.json`, find the entry with `"path": "code-reviewer.md"`. Replace its `"patches"` array with:

```json
"patches": [
  {
    "op": "replace",
    "find": "Use this template when dispatching a code reviewer subagent.",
    "replace": "Use this template as the prompt argument to `push-task` when requesting a fresh-context code review."
  },
  {
    "op": "replace",
    "find": "Task tool (general-purpose):\n  description: \"Review code changes\"\n  prompt: |",
    "replace": "push-task:\n  prompt: |"
  }
]
```

This drops: the combine-header+body replace, the fence-stripping replace (`\n```\n\n**Placeholders:**` → `\n\n**Placeholders:**`), and the de-indent regex. All upstream content preserved: purpose, placeholders, "Reviewer returns", **the full example output section**.

- [ ] **Step 2: Run updater**

```bash
npm run updater
```

Expected: exits 0, no warnings for requesting-code-review code-reviewer.md.

- [ ] **Step 3: Verify example output is preserved**

```bash
grep -c "### Strengths" skills/requesting-code-review/code-reviewer.md
grep -c "Ready to merge" skills/requesting-code-review/code-reviewer.md
```

Expected: `### Strengths` appears twice (output format template + example), `Ready to merge` appears once (example section).

- [ ] **Step 4: Commit**

```bash
git add updater/skills/requesting-code-review.json skills/requesting-code-review/code-reviewer.md
git commit -m "fix(skills): structural translation for code-reviewer.md, preserve upstream example and instructions"
```

### Task 4: Fix `writing-skills.json` — translate instead of rewrite

**Files:**
- Modify: `updater/skills/writing-skills.json`

Three patches rewrite instructional content. Fix them to translate mechanism references only, keeping upstream content.

- [ ] **Step 1: Fix "Always use subagents" patch (patch index 2 in current SKILL.md patches)**

Find the patch with `"find": "Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow."`. Replace with:

```json
{
  "op": "replace",
  "find": "Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.",
  "replace": "Use push-task for fresh-context work (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow."
}
```

This keeps the "50-100x context savings" insight and the "REQUIRED: Use [other-skill-name]" reference pattern — just changes the mechanism from "subagents" to "push-task for fresh-context work".

- [ ] **Step 2: Fix "[Dispatch subagent → synthesis]" patch (patch index 19 in current SKILL.md patches)**

Find the patch with `"find": "[Dispatch subagent → synthesis]"`. Replace with:

```json
{
  "op": "replace",
  "find": "[Dispatch subagent → synthesis]",
  "replace": "[push-task → synthesis]"
}
```

- [ ] **Step 3: Fix "pressure scenarios with subagents" patch (patch index 15 in current SKILL.md patches)**

Find the patch with `"find": "You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes)."`. Replace with:

```json
{
  "op": "replace",
  "find": "You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).",
  "replace": "You write test cases (pressure scenarios with push-task), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes)."
}
```

Patches 16-18 (RED/GREEN/REFACTOR sections) are already correct — they add necessary push-task usage notes while keeping the three-phase methodology structure. No change needed.

Patch 20 (testing methodology note) is already minimal — keep as is.

- [ ] **Step 4: Run updater**

```bash
npm run updater
```

Expected: exits 0, no warnings for writing-skills.

- [ ] **Step 5: Commit**

```bash
git add updater/skills/writing-skills.json skills/writing-skills/SKILL.md
git commit -m "fix(skills): translate instead of rewrite in writing-skills patches"
```

### Task 5: Verify remaining patch definitions are correct

**Files:**
- Review: `updater/skills/brainstorming.json` (SKILL.md patches)
- Review: `updater/skills/writing-plans.json` (SKILL.md patches)

- [ ] **Step 1: Verify brainstorming SKILL.md patches are fine as-is**

All 8 patches are targeted replaces at separate, non-overlapping locations. Each replaces a unique string in a different section. No consolidation needed — they follow the "small patch where it suffices" principle.

Confirmation command:
```bash
npm run updater 2>&1 | grep "brainstorming"
```

Expected: No warnings. All 8 SKILL.md patches + 2 spec-reviewer patches match.

- [ ] **Step 2: Verify writing-plans SKILL.md patches are fine as-is**

All 11 patches are targeted replaces/deletes. The Scope Check, Self-Review, and Execution Handoff patches already use single large replaces covering their respective sections — no fragmentation to consolidate.

Confirmation command:
```bash
npm run updater 2>&1 | grep "writing-plans"
```

Expected: No warnings. All SKILL.md patches + 2 plan-reviewer patches match.

- [ ] **Step 3: Full updater run**

```bash
npm run updater
```

Expected: exits 0, zero unmatched per-file patches.

- [ ] **Step 4: Commit (if any regenerated files changed)**

```bash
git add skills/
git diff --cached --stat
git commit -m "chore: regenerate skills after patch fixes"
```

### Task 6: Full verification gate

**Files:**
- All generated skills (verify they pass gate)

- [ ] **Step 1: Run full verify**

```bash
npm run verify
```

Expected: All steps pass (lint → tsc → test → updater → skill drift → pack).

- [ ] **Step 2: Spot-check key content preserved**

```bash
# Reviewer files keep their structure
echo "=== spec-reviewer ===" && grep -c "Reviewer returns\|Dispatch after" skills/brainstorming/spec-document-reviewer-prompt.md
echo "=== plan-reviewer ===" && grep -c "Reviewer returns\|Dispatch after" skills/writing-plans/plan-document-reviewer-prompt.md
echo "=== code-reviewer ===" && grep -c "Reviewer returns\|### Assessment\|Ready to merge" skills/requesting-code-review/code-reviewer.md
echo "=== writing-skills ===" && grep -c "50-100x context savings" skills/writing-skills/SKILL.md
```

Expected:
- spec-reviewer: 2 (Reviewer returns + Dispatch after)
- plan-reviewer: 2
- code-reviewer: at least 2 (Reviewer returns + Assessment section present)
- writing-skills: 1 (the "50-100x context savings" insight preserved)

- [ ] **Step 3: Final commit if clean**

```bash
git status
```

If clean, done. If regenerated files have unstaged changes, commit them.

---

## Verification Checklist

After all tasks complete, confirm:

1. `npm run updater` exits 0 with zero unmatched per-file patches
2. `npm run verify` passes full gate
3. Reviewer prompt files retain: purpose, "Dispatch after", prompt body, closing fence, "Reviewer returns"
4. `code-reviewer.md` retains its full example output section
5. `writing-skills/SKILL.md` retains "50-100x context savings" and "REQUIRED: Use [other-skill-name]" reference pattern
6. All roadmap-aware features preserved (checklist item 9, graphviz labels, terminal state, decomposition paragraph)
7. Phase-boundary checks preserved in writing-plans (Scope Check, Plan Header, Self-Review item 4, Execution Handoff)

# Navigator Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update pi-supergsd skills to conditionally use `push-task` + `/start-fresh`/`/return` for fresh-context reviews, replacing "subagent dispatch" language with navigator-aware instructions and inline fallbacks.

**Architecture:** Four updater JSON definitions (`brainstorming`, `writing-plans`, `requesting-code-review`, `writing-skills`) get per-file patches targeting upstream text. After all definitions are updated, `npm run updater` regenerates `skills/`. Then fix → verify → test.

**Tech Stack:** Node 20+, TypeScript, declarative JSON patches, `node:test`

**Roadmap:** None

**Phase:** Single-plan implementation

---

## Task Overview

| Task | What | Files Modified |
|---|---|---|
| 1 | Update `updater/skills/brainstorming.json` | `updater/skills/brainstorming.json` |
| 2 | Update `updater/skills/writing-plans.json` | `updater/skills/writing-plans.json` |
| 3 | Update `updater/skills/requesting-code-review.json` | `updater/skills/requesting-code-review.json` |
| 4 | Update `updater/skills/writing-skills.json` | `updater/skills/writing-skills.json` |
| 5 | Audit remaining skills for stray "subagent" refs | `updater/skills/*.json` |
| 6 | Regenerate skills via `npm run updater` | `skills/*/*` |
| 7 | Review generated output for correctness | `skills/*/*` |
| 8 | Fix lint/type issues | various |
| 9 | Run verification gate | project root |
| 10 | Test updated skills (pressure scenarios) | interactive |

---

### Task 1: Update `updater/skills/brainstorming.json`

**Files:**
- Modify: `updater/skills/brainstorming.json`

**Goal:** Make Step 7 (Spec self-review) conditional with `push-task` + `/start-fresh` fallback. Replace the prompt template file to remove subagent/YAML wrapper language.

- [ ] **Step 1: Add patch for Step 7 checklist item in `SKILL.md`**

Replace the upstream checklist item 7 with a conditional block. The upstream text is:

```
7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)
```

Replace with:

```
7. **Spec self-review** — check the spec for completeness and consistency before user review

**If the `push-task` tool is available:**
1. Call `push-task({ prompt: "<content from spec-document-reviewer-prompt.md>" })`
   The prompt must be self-contained — it cannot reference "above" or prior
   conversation, because `/start-fresh` provides empty context.
2. Tell the user: "Run `/start-fresh` for a fresh-context review of the spec."
3. After the user runs `/return`, incorporate the summary findings and fix any gaps
   in the spec before proceeding to Step 8.

**Otherwise:**
Run the Spec Self-Review checklist inline (see below).
```

- [ ] **Step 2: Add `spec-document-reviewer-prompt.md` file entry to the definition**

The upstream file contains YAML wrapper (`Task tool (general-purpose):`), metadata (`Purpose:`, `Dispatch after:`), and indented prompt body inside triple-backticks. The target is a plain markdown file with the review prompt as top-level content, no wrapper, no metadata.

Write the `find`/`replace` patches to:
1. Replace the header and subagent language
2. Remove the ``` wrapper lines
3. Unindent the prompt body (remove 4 leading spaces from each line inside the code block)
4. Remove the `**Reviewer returns:**` metadata line

Use `delete-block` for the ``` wrapper, then `replace` for the header, then `regex-replace` to strip leading indentation.

Exact upstream header to replace:
```
# Spec Document Reviewer Prompt Template

Use this template when dispatching a spec document reviewer subagent.

**Purpose:** Verify the spec is complete, consistent, and ready for implementation planning.

**Dispatch after:** Spec document is written to docs/superpowers/specs/

```
Task tool (general-purpose):
  description: "Review spec document"
  prompt: |
```

Replace with:
```
# Fresh-Context Spec Review Prompt Template

Use this template as the prompt argument to `push-task` when requesting a fresh-context spec review.

```

Use `delete-block` to remove the closing ``` and the `**Reviewer returns:**` line.

Use `regex-replace` with `find`: `"^    "` (4 spaces at start of line) and `replace`: `""` — applied after the other patches.

- [ ] **Step 3: Write the updated JSON and save it**

The complete updated `updater/skills/brainstorming.json` is:

```json
{
  "name": "brainstorming",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        {
          "op": "replace",
          "find": "9. **Transition to implementation** — invoke writing-plans skill to create implementation plan",
          "replace": "9. **Transition to planning** — invoke /skill:writing-roadmaps for large/multi-phase designs, otherwise invoke /skill:writing-plans"
        },
        {
          "op": "replace",
          "find": "Invoke writing-plans skill",
          "replace": "Choose writing-roadmaps or writing-plans"
        },
        {
          "op": "replace",
          "find": "**The terminal state is invoking writing-plans.** Do NOT invoke frontend-design, mcp-builder, or any other implementation skill. The ONLY skill you invoke after brainstorming is writing-plans.",
          "replace": "**The terminal state is choosing the next planning skill.** For designs too large for one detailed implementation plan or context window, invoke /skill:writing-roadmaps. For designs that fit in one plan, invoke /skill:writing-plans. Do NOT invoke frontend-design, mcp-builder, or any other implementation skill."
        },
        {
          "op": "replace",
          "find": "- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → plan → implementation cycle.",
          "replace": "- If the project is too large for a single spec, help the user decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built? Then brainstorm the first sub-project through the normal design flow. Each sub-project gets its own spec → roadmap-or-plan → implementation cycle.\n- If the design fits in one spec but is too large for one detailed implementation plan or one context window, finish the design doc, then use /skill:writing-roadmaps to define ordered phases before any detailed plan."
        },
        {
          "op": "replace",
          "find": "> \"Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we start writing out the implementation plan.\"",
          "replace": "> \"Spec written and committed to `<path>`. Please review it and let me know if you want to make any changes before we choose the next planning step.\""
        },
        {
          "op": "replace",
          "find": "- Invoke the writing-plans skill to create a detailed implementation plan\n- Do NOT invoke any other skill. writing-plans is the next step.",
          "replace": "- If the design is large, multi-phase, or likely to exceed one context window as a detailed plan, invoke /skill:writing-roadmaps\n- Otherwise, invoke /skill:writing-plans to create a detailed implementation plan\n- Do NOT invoke any other skill. Roadmap/planning is the next step."
        },
        {
          "op": "replace",
          "find": "7. **Spec self-review** — quick inline check for placeholders, contradictions, ambiguity, scope (see below)",
          "replace": "7. **Spec self-review** — check the spec for completeness and consistency before user review\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<content from spec-document-reviewer-prompt.md>\" })`\n   The prompt must be self-contained — it cannot reference \"above\" or prior\n   conversation, because `/start-fresh` provides empty context.\n2. Tell the user: \"Run `/start-fresh` for a fresh-context review of the spec.\"\n3. After the user runs `/return`, incorporate the summary findings and fix any gaps\n   in the spec before proceeding to Step 8.\n\n**Otherwise:**\nRun the Spec Self-Review checklist inline (see below)."
        }
      ]
    },
    {
      "path": "spec-document-reviewer-prompt.md",
      "patches": [
        {
          "op": "replace",
          "find": "# Spec Document Reviewer Prompt Template\n\nUse this template when dispatching a spec document reviewer subagent.\n\n**Purpose:** Verify the spec is complete, consistent, and ready for implementation planning.\n\n**Dispatch after:** Spec document is written to docs/superpowers/specs/\n\n```\nTask tool (general-purpose):\n  description: \"Review spec document\"\n  prompt: |",
          "replace": "# Fresh-Context Spec Review Prompt Template\n\nUse this template as the prompt argument to `push-task` when requesting a fresh-context spec review."
        },
        {
          "op": "delete-line",
          "find": "```"
        },
        {
          "op": "delete-line",
          "find": "**Reviewer returns:** Status, Issues (if any), Recommendations"
        },
        {
          "op": "regex-replace",
          "find": "^    ",
          "replace": ""
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit the definition**

```bash
git add updater/skills/brainstorming.json
git commit -m "updater: add push-task conditional to brainstorming skill"
```

---

### Task 2: Update `updater/skills/writing-plans.json`

**Files:**
- Modify: `updater/skills/writing-plans.json`

**Goal:** Make the Self-Review section conditional with `push-task` + `/start-fresh` fallback. Replace the plan reviewer prompt template.

- [ ] **Step 1: Replace the Self-Review section in `SKILL.md`**

The upstream Self-Review section starts with:
```
## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.
```

Replace the header and first paragraph with a conditional wrapper, keeping the existing checklist content as the fallback branch.

- [ ] **Step 2: Add `plan-document-reviewer-prompt.md` file entry**

Same transformation pattern as the spec reviewer: remove YAML wrapper, metadata, unindent prompt body.

- [ ] **Step 3: Write the updated JSON**

```json
{
  "name": "writing-plans",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        {
          "op": "replace",
          "find": "description: Use when you have a spec or requirements for a multi-step task, before touching code",
          "replace": "description: Use when you have a spec, requirements, or selected roadmap phase for a multi-step task, before touching code"
        },
        {
          "op": "delete-line",
          "find": "using-git-worktrees"
        },
        {
          "op": "replace",
          "find": "**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`\n- (User preferences for plan location override this default)",
          "replace": "**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`\n- For roadmap phases: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>-phase-N-<phase-name>.md`\n- (User preferences for plan location override this default)"
        },
        {
          "op": "replace",
          "find": "## Scope Check\n\nIf the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.",
          "replace": "## Scope Check\n\n**Roadmap-aware planning:** If a roadmap exists, write a detailed implementation plan for exactly one selected phase. Default to Phase 1, or the next sequential unplanned phase if earlier phase plans already exist. Do not combine phases unless the user explicitly asks. Read the roadmap, identify the target phase in the plan header, and treat other phases as out of scope. If the target phase is unclear, ask before planning.\n\nEach phase plan must leave the project in a sensible intermediate state after execution: functionality not broken, tests/CI expected green, and no half-migrations or dangling integrations.\n\nIf the spec covers multiple independent subsystems, it should have been broken into sub-project specs or a multi-phase roadmap during brainstorming. If it wasn't, suggest breaking this into separate plans or creating a roadmap first. Each plan should produce working, testable software on its own."
        },
        {
          "op": "regex-replace",
          "find": "superpowers:subagent-driven-development \\(recommended\\) or superpowers:executing-plans",
          "replace": "superpowers:executing-plans"
        },
        {
          "op": "replace",
          "find": "**Tech Stack:** [Key technologies/libraries]\n\n---",
          "replace": "**Tech Stack:** [Key technologies/libraries]\n\n**Roadmap:** [Path to roadmap, or \"None\"]\n\n**Phase:** [Phase N: Name, or \"Single-plan implementation\"]\n\n---"
        },
        {
          "op": "replace",
          "find": "**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.",
          "replace": "**1. Spec/roadmap coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? If working from a roadmap, confirm this plan covers the selected phase and excludes later phases. List any gaps."
        },
        {
          "op": "replace",
          "find": "**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.",
          "replace": "**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.\n\n**4. Phase boundary health:** If working from a roadmap, will executing this phase leave the project functional, coherent, and expected-green without half-migrations or dangling integrations? If not, reshape the plan before saving."
        },
        {
          "op": "replace",
          "find": "## Execution Handoff\n\nAfter saving the plan, offer execution choice:\n\n**\"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Two execution options:**\n\n**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration\n\n**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints\n\n**Which approach?\"**\n\n**If Subagent-Driven chosen:**\n- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development\n- Fresh subagent per task + two-stage review\n\n**If Inline Execution chosen:**\n- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans\n- Batch execution with checkpoints for review",
          "replace": "## Execution Handoff\n\nAfter saving the plan, offer execution with phase-boundary clarity:\n\n**\"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Ready to execute it using /skill:executing-plans?\"**\n\nIf this plan covers a roadmap phase, add:\n\n**\"This plan intentionally stops at `[Phase N: Name]`. Future roadmap phases need separate detailed plans.\"**\n\n**If execution chosen:**\n- **REQUIRED SUB-SKILL:** Use /skill:executing-plans\n- Batch execution with checkpoints for review"
        },
        {
          "op": "replace",
          "find": "## Self-Review\n\nAfter writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.",
          "replace": "## Self-Review\n\n**Fresh-context plan review (optional but recommended):**\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<content from plan-document-reviewer-prompt.md>\" })`\n2. Tell the user: \"Run `/start-fresh` for a fresh-context review of the plan.\"\n3. After `/return`, fix any gaps before committing the plan.\n\n**Otherwise:**\nRun the Self-Review checklist inline."
        }
      ]
    },
    {
      "path": "plan-document-reviewer-prompt.md",
      "patches": [
        {
          "op": "replace",
          "find": "# Plan Document Reviewer Prompt Template\n\nUse this template when dispatching a plan document reviewer subagent.\n\n**Purpose:** Verify the plan is complete, matches the spec, and has proper task decomposition.\n\n**Dispatch after:** The complete plan is written.\n\n```\nTask tool (general-purpose):\n  description: \"Review plan document\"\n  prompt: |",
          "replace": "# Fresh-Context Plan Review Prompt Template\n\nUse this template as the prompt argument to `push-task` when requesting a fresh-context plan review."
        },
        {
          "op": "delete-line",
          "find": "```"
        },
        {
          "op": "delete-line",
          "find": "**Reviewer returns:** Status, Issues (if any), Recommendations"
        },
        {
          "op": "regex-replace",
          "find": "^    ",
          "replace": ""
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add updater/skills/writing-plans.json
git commit -m "updater: add push-task conditional to writing-plans skill"
```

---

### Task 3: Update `updater/skills/requesting-code-review.json`

**Files:**
- Modify: `updater/skills/requesting-code-review.json`

**Goal:** Replace "Dispatch code reviewer subagent" with `push-task` + `/start-fresh`. Rewrite `code-reviewer.md` as a plain prompt template. Remove subagent-driven development references.

- [ ] **Step 1: Replace subagent-driven development references in `SKILL.md`**

The upstream `SKILL.md` says:
- "Dispatch a code reviewer subagent to catch issues before they cascade."
- "- After each task in subagent-driven development"
- "## Integration with Workflows\n\n**Subagent-Driven Development:**"
- "[Dispatch code reviewer subagent]" in the example
- "[Subagent returns]:" in the example
- "Use Task tool with `general-purpose` type"

Replace with navigator-aware language and conditional fallback.

- [ ] **Step 2: Rewrite `code-reviewer.md`**

Remove `Task tool (general-purpose)` wrapper, metadata lines, and make it a plain prompt suitable for `push-task({ prompt: ... })`.

- [ ] **Step 3: Write the updated JSON**

```json
{
  "name": "requesting-code-review",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        {
          "op": "replace",
          "find": "Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work.",
          "replace": "Request a code review to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history. This keeps the reviewer focused on the work product, not your thought process, and preserves your own context for continued work."
        },
        {
          "op": "replace",
          "find": "**Mandatory:**\n- After each task in subagent-driven development\n- After completing major feature\n- Before merge to main",
          "replace": "**Mandatory:**\n- After completing a focused task or sub-task\n- After completing major feature\n- Before merge to main"
        },
        {
          "op": "replace",
          "find": "**2. Dispatch code reviewer subagent:**\n\nUse Task tool with `general-purpose` type, fill template at `code-reviewer.md`\n\n**Placeholders:**\n- `{DESCRIPTION}` - Brief summary of what you built\n- `{PLAN_OR_REQUIREMENTS}` - What it should do\n- `{BASE_SHA}` - Starting commit\n- `{HEAD_SHA}` - Ending commit",
          "replace": "**2. Request code review:**\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: \"<review prompt with BASE_SHA, HEAD_SHA, description>\" })`\n2. Tell the user: \"Run `/start-fresh` for a fresh-context code review.\"\n3. After `/return`, read the branch summary and act on feedback.\n\n**Otherwise:**\nUse the code-reviewer.md template for your review process."
        },
        {
          "op": "replace",
          "find": "[Dispatch code reviewer subagent]\n  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types\n  PLAN_OR_REQUIREMENTS: Task 2 from docs/superpowers/plans/deployment-plan.md\n  BASE_SHA: a7981ec\n  HEAD_SHA: 3df7661\n\n[Subagent returns]:\n  Strengths: Clean architecture, real tests\n  Issues:\n    Important: Missing progress indicators\n    Minor: Magic number (100) for reporting interval\n  Assessment: Ready to proceed",
          "replace": "[Call push-task with review prompt]\n`push-task({ prompt: \"You are a Senior Code Reviewer... [review body from code-reviewer.md, filled with BASE_SHA=a7981ec, HEAD_SHA=3df7661, DESCRIPTION=Added verifyIndex() and repairIndex() with 4 issue types, PLAN_OR_REQUIREMENTS=Task 2 from docs/superpowers/plans/deployment-plan.md]\" })`\n\n[After /return, branch summary contains]:\n  Strengths: Clean architecture, real tests\n  Issues:\n    Important: Missing progress indicators\n    Minor: Magic number (100) for reporting interval\n  Assessment: Ready to proceed"
        },
        {
          "op": "replace",
          "find": "## Integration with Workflows\n\n**Subagent-Driven Development:**\n- Review after EACH task\n- Catch issues before they compound\n- Fix before moving to next task\n\n**Executing Plans:**",
          "replace": "## Integration with Workflows\n\n**Executing Plans:**"
        }
      ]
    },
    {
      "path": "code-reviewer.md",
      "patches": [
        {
          "op": "replace",
          "find": "# Code Reviewer Prompt Template\n\nUse this template when dispatching a code reviewer subagent.\n\n**Purpose:** Review completed work against requirements and code quality standards before it cascades into more work.\n\n```\nTask tool (general-purpose):\n  description: \"Review code changes\"\n  prompt: |",
          "replace": "# Fresh-Context Code Review Prompt Template\n\nUse this template as the prompt argument to `push-task` when requesting a fresh-context code review."
        },
        {
          "op": "delete-block",
          "findStart": "```",
          "findEnd": "**Reviewer returns:** Strengths, Issues (Critical / Important / Minor), Recommendations, Assessment"
        },
        {
          "op": "regex-replace",
          "find": "^    ",
          "replace": ""
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add updater/skills/requesting-code-review.json
git commit -m "updater: add push-task conditional to requesting-code-review skill"
```

---

### Task 4: Update `updater/skills/writing-skills.json`

**Files:**
- Modify: `updater/skills/writing-skills.json`

**Goal:** Replace "subagent" language with "agent" or "fresh context" in SKILL.md. Add patches for `testing-skills-with-subagents.md`. Update `examples/CLAUDE_MD_TESTING.md`.

- [ ] **Step 1: Add subagent → fresh-context patches to `SKILL.md`**

Key upstream replacements in `SKILL.md`:
- "You write test cases (pressure scenarios with subagents)" → "You write test cases (pressure scenarios with fresh context)"
- "Pressure scenario with subagent" → "Pressure scenario with agent behavior" (already exists, keep)
- "Run pressure scenario with subagent WITHOUT the skill" → "Run pressure scenario WITHOUT the skill"
- "Run same scenarios WITH skill. Agent should now comply." → keep
- "**Testing methodology:** See @testing-skills-with-subagents.md" → keep filename, content patched separately
- Add note about filename legacy term

- [ ] **Step 2: Add `testing-skills-with-subagents.md` file entry**

Replace "subagent" with "agent" throughout using `regex-replace` with word boundaries. Keep the file reference in SKILL.md unchanged.

- [ ] **Step 3: Update `examples/CLAUDE_MD_TESTING.md`**

Replace "Create subagent test harness" with "Run baseline scenario with fresh context".

- [ ] **Step 4: Write the updated JSON**

```json
{
  "name": "writing-skills",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex)", "replace": "Personal skills live in agent-specific directories (`~/.pi/skills` for Pi, `~/.agents/skills/` for Codex)" },
        { "op": "replace", "find": "Pressure scenario with subagent", "replace": "Pressure scenario with agent behavior" },
        { "op": "replace", "find": "Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.", "replace": "Use the read tool to load skills when needed." },
        { "op": "replace", "find": "Skills help future Claude instances find", "replace": "Skills help future agent instances find" },
        { "op": "replace", "find": "## Claude Search Optimization", "replace": "## Agent Search Optimization" },
        { "op": "replace", "find": "Future Claude needs to FIND", "replace": "The agent needs to FIND" },
        { "op": "replace", "find": "Claude reads description", "replace": "The agent reads description" },
        { "op": "replace", "find": "a description summarizes the skill's workflow, Claude", "replace": "a description summarizes the skill's workflow, the agent" },
        { "op": "replace", "find": "shortcut Claude will take", "replace": "shortcut the agent will take" },
        { "op": "replace", "find": "Claude may follow this", "replace": "the agent may follow this" },
        { "op": "replace", "find": "Use words Claude would search for:", "replace": "Use words an LLM would search for:" },
        { "op": "replace", "find": "How future Claude finds your skill:", "replace": "How the agent finds your skill:" },
        { "op": "replace", "find": "caused Claude to do ONE review", "replace": "caused the agent to do ONE review" },
        { "op": "replace", "find": "Claude correctly read the flowchart", "replace": "the agent correctly read the flowchart" },
        { "op": "replace", "find": "documentation Claude skips", "replace": "documentation the agent skips" },
        { "op": "replace", "find": "You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).", "replace": "You write test cases (pressure scenarios with fresh context), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes)." },
        { "op": "replace", "find": "### RED: Write Failing Test (Baseline)\n\nRun pressure scenario with subagent WITHOUT the skill. Document exact behavior:\n- What choices did they make?\n- What rationalizations did they use (verbatim)?\n- Which pressures triggered violations?", "replace": "### RED: Write Failing Test (Baseline)\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: <pressure scenario> })`\n2. Tell the user: \"Run `/start-fresh` to run the baseline scenario.\"\n3. After `/return`, document the agent's choices and rationalizations verbatim.\n\n**Otherwise:**\nRun the scenario in the current session and document the agent's behavior:\n- What choices did they make?\n- What rationalizations did they use (verbatim)?\n- Which pressures triggered violations?" },
        { "op": "replace", "find": "Run same scenarios WITH skill. Agent should now comply.", "replace": "Run same scenarios WITH skill. Agent should now comply.\n\n**If `push-task` is available:** Call `push-task({ prompt: \"<pressure scenario with skill loaded>\" })` and tell the user to run `/start-fresh`. After `/return`, confirm compliance.\n\n**Otherwise:** Run in the current session." },
        { "op": "replace", "find": "### REFACTOR: Close Loopholes\n\nAgent found new rationalization? Add explicit counter. Re-test until bulletproof.", "replace": "### REFACTOR: Close Loopholes\n\n**If the `push-task` tool is available:**\n1. Call `push-task({ prompt: <updated scenario + updated skill loaded> })`\n2. Tell the user: \"Run `/start-fresh` to verify the updated skill works.\"\n3. After `/return`, confirm the agent now complies and no new rationalizations appear.\n\n**Otherwise:**\nAgent found new rationalization? Add explicit counter. Re-test until bulletproof." },
        { "op": "replace", "find": "**Testing methodology:** See @testing-skills-with-subagents.md for the complete testing methodology:", "replace": "**Testing methodology:** See @testing-skills-with-subagents.md for the complete testing methodology (filename references a legacy term; content uses current navigator terminology):" }
      ]
    },
    {
      "path": "testing-skills-with-subagents.md",
      "patches": [
        { "op": "replace", "find": "# Testing Skills With Subagents", "replace": "# Testing Skills With Agents" },
        { "op": "regex-replace", "find": "\\bsubagent\\b", "replace": "agent" }
      ]
    },
    {
      "path": "examples/CLAUDE_MD_TESTING.md",
      "patches": [
        { "op": "replace", "find": "~/.claude/skills/", "replace": "~/.pi/skills/" },
        { "op": "replace", "find": "Claude might think it knows how to approach tasks", "replace": "An agent might think it knows how to approach tasks" },
        { "op": "replace", "find": "Claude.AI Emphatic Style", "replace": "Anthropic Emphatic Style" },
        { "op": "replace", "find": "Create subagent test harness", "replace": "Run baseline scenario with fresh context" }
      ]
    }
  ],
  "exclude": ["render-graphs.js"]
}
```

- [ ] **Step 5: Commit**

```bash
git add updater/skills/writing-skills.json
git commit -m "updater: replace subagent with fresh-context in writing-skills"
```

---

### Task 5: Audit Remaining Skills for Stray "subagent" References

**Files:**
- Modify: potentially `updater/skills/*.json`

- [ ] **Step 1: Search all generated skills**

```bash
grep -ri "subagent\|sub-agent" skills/ --include="*.md" | grep -v node_modules
```

- [ ] **Step 2: For each hit, determine if it's upstream-derived or custom**

If upstream-derived: add a per-file patch to the relevant `updater/skills/<name>.json`.
If custom: patch the file directly in `skills/` (but these are generated, so prefer updater patches).

- [ ] **Step 3: Verify `common-patch.json` has no unsafe global replace**

Current content is safe ("Claude Code" → "Pi", "superpowers:" → "/skill:", "TodoWrite" → "a todo list"). Do NOT add "subagent" → "agent" here.

---

### Task 6: Regenerate Skills via `npm run updater`

**Files:**
- Regenerated: `skills/*/*`

- [ ] **Step 1: Run the updater**

```bash
npm run updater
```

Expected: all patches match. If any fail, the updater exits non-zero with warnings. Fix the failing patch and re-run.

- [ ] **Step 2: Check git diff to verify output**

```bash
git diff --stat skills/
```

Expected: changes in the 4 targeted skills + any audit fixes. No unexpected changes.

---

### Task 7: Review Generated Output for Correctness

**Files:**
- Read: `skills/brainstorming/SKILL.md`, `skills/brainstorming/spec-document-reviewer-prompt.md`
- Read: `skills/writing-plans/SKILL.md`, `skills/writing-plans/plan-document-reviewer-prompt.md`
- Read: `skills/requesting-code-review/SKILL.md`, `skills/requesting-code-review/code-reviewer.md`
- Read: `skills/writing-skills/SKILL.md`, `skills/writing-skills/testing-skills-with-subagents.md`

- [ ] **Step 1: Verify no "subagent" language remains in generated files**

```bash
grep -ri "subagent\|sub-agent" skills/ --include="*.md"
```

Expected: zero matches (or only in `testing-skills-with-subagents.md` filename, which is acceptable).

- [ ] **Step 2: Verify `push-task` conditional blocks are present and well-formed**

Each SKILL.md should have a clearly demarcated "If the `push-task` tool is available:" block followed by an "Otherwise:" fallback.

- [ ] **Step 3: Verify prompt templates are self-contained**

The reviewer prompt files should not reference "above", "previous conversation", or have YAML wrappers. They should be plain markdown suitable for direct use as a `push-task` prompt argument.

---

### Task 8: Fix Lint/Type Issues

**Files:**
- Modify: any source files with issues

- [ ] **Step 1: Run autofix**

```bash
npm run fix
```

- [ ] **Step 2: Check for remaining issues**

```bash
npm run lint
```

Fix any remaining issues manually.

---

### Task 9: Run Verification Gate

**Files:**
- All project files

- [ ] **Step 1: Full gate**

```bash
npm run verify
```

Expected output:
- lint: clean
- tsc: no errors
- test: all pass
- updater: patches match, no drift
- pack: succeeds

If any step fails, fix and re-run.

---

### Task 10: Test Updated Skills (Pressure Scenarios)

**Files:**
- Interactive testing

- [ ] **Step 1: Test `writing-skills` first**

Using the updated `writing-skills` methodology, create a pressure scenario for one of the updated skills (e.g., `brainstorming`).

RED: Run without the updated skill. Document baseline.
GREEN: Run with the updated skill. Verify the agent offers `push-task` conditional.
REFACTOR: Close any loopholes.

- [ ] **Step 2: Test each updated skill**

| Skill | Test |
|---|---|
| `brainstorming` | Agent writes spec → at Step 7, should offer `push-task` + `/start-fresh` or inline fallback |
| `writing-plans` | Agent writes plan → should offer `push-task` + `/start-fresh` for plan review |
| `requesting-code-review` | Agent completes code → should call `push-task` with a single prompt string |
| `writing-skills` | Agent should describe testing methodology using `push-task` when available |

- [ ] **Step 3: Document test results**

Record pass/fail for each skill. If any fail, return to Task 1-4 to patch.

---

## Execution Handoff

**"Plan complete and saved to `docs/superpowers/plans/2026-05-25-navigator-integration.md`. Ready to execute it using /skill:executing-plans?"**

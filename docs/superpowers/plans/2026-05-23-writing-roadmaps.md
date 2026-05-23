# Writing Roadmaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local `writing-roadmaps` skill and make `brainstorming`/`writing-plans` route large work through phase roadmaps.

**Architecture:** Keep `writing-roadmaps` as a local committed runtime skill under `skills/`. Continue using the existing updater patch system for upstream-derived `brainstorming` and `writing-plans`; generated outputs are refreshed by `npm run updater`.

**Tech Stack:** Markdown Agent Skills, JSON patch definitions, TypeScript updater, Node/npm test commands.

---

### Task 1: Add the local `writing-roadmaps` skill

**Files:**
- Create: `skills/writing-roadmaps/SKILL.md`

- [ ] **Step 1: Verify the skill does not already exist**

Run:

```bash
test -f skills/writing-roadmaps/SKILL.md
```

Expected: command exits with status `1` because the file does not exist yet.

- [ ] **Step 2: Create the local skill file**

Create `skills/writing-roadmaps/SKILL.md` with this exact content:

````markdown
---
name: writing-roadmaps
description: Use when an approved design or spec is too large for one implementation plan, needs ordered phases, or may exceed a single context window
---

# Writing Roadmaps

## Overview

Create a coarse, phase-level roadmap between brainstorming and detailed planning. The roadmap divides a large approved design into ordered, independently plannable phases so each phase can later get its own `writing-plans` document.

**Announce at start:** "I'm using the writing-roadmaps skill to break this design into implementation phases."

**Save roadmaps to:** `docs/superpowers/roadmaps/YYYY-MM-DD-<feature-name>-roadmap.md`
- User preferences for roadmap location override this default.

## When to Use

Use this after a design/spec is approved when any of these are true:

- The work likely will not fit in one context window as a detailed implementation plan.
- The design has multiple phases, migrations, subsystems, or rollout steps.
- The first detailed plan would be too large to write or execute safely in one session.
- You need ordering, dependency, or risk decisions before writing task-level steps.

Skip this for small designs that can become one detailed implementation plan.

## Roadmap Rules

- Stay coarse: phases, goals, dependencies, risks, context boundaries, and verification only.
- Do not write task-level implementation steps or full code blocks.
- Phases are executed in order starting with Phase 1 unless the user explicitly changes the order.
- Each phase must be independently plan-worthy and small enough for one detailed `writing-plans` document.
- Use as many phases as needed, but no more than needed.
- Split any phase that cannot fit comfortably in one detailed plan or context window.

## Phase Boundary Rule

Each phase must leave the project in a sensible intermediate state:

- functionality is not broken
- tests and CI are expected to be green
- no half-migrations, dangling integrations, or unusable transitional states remain
- later phases may add capability, but earlier phases remain coherent on their own

If a proposed phase cannot satisfy this rule, split or reshape it before writing the roadmap.

## Roadmap Document Header

Every roadmap MUST start with this header:

```markdown
# [Feature Name] Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** [One sentence describing the full outcome]

**Design Spec:** [`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`](../specs/YYYY-MM-DD-<topic>-design.md)

**Planning Strategy:** [Why this needs multiple phases and how the phases protect context limits]

---
```

## Phase Format

Use this structure for each phase:

```markdown
## Phase N: [Phase Name]

**Outcome:** [What exists when this phase is complete]

**Why now:** [Dependency/order rationale]

**Scope:**
- [Included capability/change]
- [Included capability/change]

**Out of scope:**
- [Deferred capability/change]

**Key files/areas likely affected:**
- `path/or/area`: [reason]

**Dependencies:**
- [Prior phase, external decision, migration, or none]

**Verification:**
- [Coarse acceptance check]
- [Test/build/manual check]

**Phase boundary health:** [Why the project remains functional and tests/CI should be green after this phase]

**Risks:**
- [Risk and mitigation]

**Context notes:** [What to keep in mind when writing this phase's detailed plan]
```

## Self-Review

Before handing off, check:

1. **Complete coverage:** Every important spec requirement appears in a phase, or is explicitly deferred.
2. **Sequential order:** Phase 1 is the correct first implementation target, and each later phase depends only on earlier phases or stated external decisions.
3. **Phase boundaries:** Every phase leaves the project functional, coherent, and expected-green.
4. **Size check:** Each phase can plausibly fit in one detailed `writing-plans` document.
5. **No detailed-plan leakage:** Remove task-level checkboxes, full implementations, and step-by-step code.

Fix issues inline before presenting the roadmap.

## Handoff

After saving the roadmap, say:

> "Roadmap complete and saved to `<path>`. Next step is to use /skill:writing-plans for Phase 1."

Do not skip ahead to later phases unless the user explicitly changes the phase order.
````

- [ ] **Step 3: Verify frontmatter and key rules are present**

Run:

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('skills/writing-roadmaps/SKILL.md','utf8'); for (const text of ['name: writing-roadmaps','description: Use when','Phase Boundary Rule','Start with Phase 1','tests and CI are expected to be green']) { if (!s.includes(text)) throw new Error('missing '+text); }"
```

Expected: no output and exit status `0`.

- [ ] **Step 4: Commit the new local skill**

Run:

```bash
git add skills/writing-roadmaps/SKILL.md
git commit -m "feat: add writing roadmaps skill"
```

Expected: commit succeeds and includes only `skills/writing-roadmaps/SKILL.md`.

---

### Task 2: Patch `brainstorming` to choose roadmap or plan

**Files:**
- Modify: `updater/skills/brainstorming.json`
- Generated by updater: `skills/brainstorming/SKILL.md`

- [ ] **Step 1: Verify current generated brainstorming text still has only the plan handoff**

Run:

```bash
rg -n "writing-roadmaps|Transition to planning|choose the next planning step" skills/brainstorming/SKILL.md
```

Expected: command exits with status `1` because the roadmap language is not present yet.

- [ ] **Step 2: Replace the brainstorming patch definition**

Replace the entire contents of `updater/skills/brainstorming.json` with:

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
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Run updater to generate patched brainstorming skill**

Run:

```bash
npm run updater
```

Expected: output ends with:

```text
Done. Skills: 10, Files: 34, Patches: 35, Failed: 0
```

If the file count differs because upstream added or removed included files, the important expected result is `Failed: 0`.

- [ ] **Step 4: Verify generated brainstorming language**

Run:

```bash
rg -n "Transition to planning|writing-roadmaps|choose the next planning step|Roadmap/planning is the next step" skills/brainstorming/SKILL.md
```

Expected: output includes all four phrases.

- [ ] **Step 5: Commit brainstorming patch and generated output**

Run:

```bash
git add updater/skills/brainstorming.json skills/brainstorming/SKILL.md
git commit -m "feat: route brainstorming to roadmaps for large designs"
```

Expected: commit succeeds and includes only the brainstorming patch definition and generated brainstorming skill.

---

### Task 3: Patch `writing-plans` for one phase at a time

**Files:**
- Modify: `updater/skills/writing-plans.json`
- Generated by updater: `skills/writing-plans/SKILL.md`

- [ ] **Step 1: Verify current writing-plans text is not roadmap-aware**

Run:

```bash
rg -n "selected roadmap phase|Roadmap-aware planning|next sequential unplanned phase|phase boundary" skills/writing-plans/SKILL.md
```

Expected: command exits with status `1` because roadmap-aware planning language is not present yet.

- [ ] **Step 2: Replace the writing-plans patch definition**

Replace the entire contents of `updater/skills/writing-plans.json` with:

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
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Run updater to generate patched writing-plans skill**

Run:

```bash
npm run updater
```

Expected: output ends with `Failed: 0`. The total patch count should include the expanded writing-plans patch set; exact file count may vary with upstream.

- [ ] **Step 4: Verify generated writing-plans language**

Run:

```bash
rg -n "selected roadmap phase|Roadmap-aware planning|next sequential unplanned phase|Phase boundary health|Future roadmap phases need separate detailed plans" skills/writing-plans/SKILL.md
```

Expected: output includes all five phrases.

- [ ] **Step 5: Verify old subagent-driven handoff was removed**

Run:

```bash
! rg -n "Subagent-Driven|subagent-driven-development" skills/writing-plans/SKILL.md
```

Expected: no output and exit status `0`.

- [ ] **Step 6: Commit writing-plans patch and generated output**

Run:

```bash
git add updater/skills/writing-plans.json skills/writing-plans/SKILL.md
git commit -m "feat: make writing plans roadmap-aware"
```

Expected: commit succeeds and includes only the writing-plans patch definition and generated writing-plans skill.

---

### Task 4: Final verification across the skill workflow

**Files:**
- Read/verify: `skills/writing-roadmaps/SKILL.md`
- Read/verify: `skills/brainstorming/SKILL.md`
- Read/verify: `skills/writing-plans/SKILL.md`
- Read/verify: `updater/skills/brainstorming.json`
- Read/verify: `updater/skills/writing-plans.json`

- [ ] **Step 1: Run full updater verification**

Run:

```bash
npm run updater
```

Expected: output ends with `Failed: 0`.

- [ ] **Step 2: Run updater unit tests**

Run:

```bash
npm test
```

Expected: output reports all updater tests passing, including `fail 0`.

- [ ] **Step 3: Run updater-only TypeScript check**

Run:

```bash
npx tsc --noEmit --ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node updater/updater.ts updater/lib/*.ts
```

Expected: no output and exit status `0`.

- [ ] **Step 4: Document known full-project type-check limitation if checked**

Run:

```bash
npx tsc --noEmit
```

Expected in this repository unless Pi runtime types are installed locally:

```text
index.ts(3,35): error TS2307: Cannot find module '@earendil-works/pi-coding-agent' or its corresponding type declarations.
```

If this exact missing Pi runtime type error appears and the updater-only type-check passed, treat TypeScript verification as acceptable per `AGENTS.md`.

- [ ] **Step 5: Verify all required roadmap workflow terms are present**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const checks = [
  ['skills/writing-roadmaps/SKILL.md', ['name: writing-roadmaps', 'Phase Boundary Rule', 'Start with Phase 1', 'tests and CI are expected to be green']],
  ['skills/brainstorming/SKILL.md', ['writing-roadmaps', 'writing-plans', 'choose the next planning step']],
  ['skills/writing-plans/SKILL.md', ['selected roadmap phase', 'Roadmap-aware planning', 'next sequential unplanned phase', 'Phase boundary health', 'Future roadmap phases need separate detailed plans']]
];
for (const [file, terms] of checks) {
  const text = fs.readFileSync(file, 'utf8');
  for (const term of terms) {
    if (!text.includes(term)) {
      throw new Error(`${file} missing ${term}`);
    }
  }
}
NODE
```

Expected: no output and exit status `0`.

- [ ] **Step 6: Confirm working tree status**

Run:

```bash
git status --short
```

Expected: no output if all generated files are committed. If `npm run updater` changed generated files after the last commit, inspect the diff, commit intended changes, and repeat this step.
```

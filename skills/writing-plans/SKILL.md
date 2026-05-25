---
name: writing-plans
description: Use when you have a spec, requirements, or selected roadmap phase for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."


**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- For roadmap phases: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>-phase-N-<phase-name>.md`
- (User preferences for plan location override this default)

## Scope Check

**Roadmap-aware planning:** If a roadmap exists, write a detailed implementation plan for exactly one selected phase. Default to Phase 1, or the next sequential unplanned phase if earlier phase plans already exist. Do not combine phases unless the user explicitly asks. Read the roadmap, identify the target phase in the plan header, and treat other phases as out of scope. If the target phase is unclear, ask before planning.

Each phase plan must leave the project in a sensible intermediate state after execution: functionality not broken, tests/CI expected green, and no half-migrations or dangling integrations.

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs or a multi-phase roadmap during brainstorming. If it wasn't, suggest breaking this into separate plans or creating a roadmap first. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Roadmap:** [Path to roadmap, or "None"]

**Phase:** [Phase N: Name, or "Single-plan implementation"]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

**Fresh-context plan review (optional but recommended):**

**If the `push-task` tool is available:**
1. Call `push-task({ prompt: "<content from plan-document-reviewer-prompt.md>", context: "fresh" })`
2. Tell the user: "Run `/start-task` for a fresh-context review of the plan."
3. After `/return`, fix any gaps before committing the plan.

**Otherwise:**
Run the Self-Review checklist inline.

**1. Spec/roadmap coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? If working from a roadmap, confirm this plan covers the selected phase and excludes later phases. List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

**4. Phase boundary health:** If working from a roadmap, will executing this phase leave the project functional, coherent, and expected-green without half-migrations or dangling integrations? If not, reshape the plan before saving.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Execution Handoff

After saving the plan, offer execution with phase-boundary clarity:

**"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Ready to execute it using /skill:executing-plans?"**

If this plan covers a roadmap phase, add:

**"This plan intentionally stops at `[Phase N: Name]`. Future roadmap phases need separate detailed plans."**

**If execution chosen:**
- **REQUIRED SUB-SKILL:** Use /skill:executing-plans
- Batch execution with checkpoints for review

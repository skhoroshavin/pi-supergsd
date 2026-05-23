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

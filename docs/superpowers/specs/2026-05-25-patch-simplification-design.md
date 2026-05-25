# Patch Simplification Design

Reduce `updater/skills/*.json` patches to the bare minimum — mechanical
substitutions and Pi-specific feature additions — while preserving all upstream
instructional content and structure.

## Goals

1. **No content loss.** Upstream instructional content (purpose statements,
   placeholders, "Reviewer returns", examples, subagent methodology) stays
   intact. Only mechanism references change.

2. **Structural translation, not rewrites.** When upstream uses a `Task tool
   (general-purpose):` wrapper, translate it to the `push-task:` equivalent
   without stripping surrounding structure.

3. **Small patches where they suffice.** Don't consolidate unless a section is
   entirely our content. Targeted `replace` ops are more maintainable than
   wholesale block replacements.

4. **All Pi-specific features preserved.** Roadmap-aware planning, phase
   boundary checks, writing-roadmaps integration remain intact.

## Per-Skill Changes

### `common-patch.json` — no change

Three patches (`Claude Code` → `Pi`, `superpowers:` → `/skill:`, `TodoWrite` →
`a todo list`). Applied globally, all correct.

### `brainstorming.json`

**SKILL.md:** Keep roadmap-aware additions. Consolidate adjacent replaces where
they touch the same concern, keep isolated replaces as is. No change to
non-roadmap instructional content.

**spec-document-reviewer-prompt.md:** Replace from the current destructive
approach (delete fences, delete "Reviewer returns", de-indent) to a two-patch
structural translation:

1. Replace header line: `Use this template when dispatching a spec document
   reviewer subagent.` → `Use this template as the prompt argument to
   \`push-task\` when requesting a fresh-context spec review.`
2. Replace wrapper: `Task tool (general-purpose):\n  description: "Review spec
   document"\n  prompt: |` → `push-task:\n  prompt: |`

All other content preserved — purpose, "Dispatch after", the prompt body,
closing fence, "Reviewer returns".

### `writing-plans.json`

**SKILL.md:** Three sections are entirely our content — consolidate with
`delete-block` + `append`:

- **Scope Check** — original upstream paragraph → our roadmap-aware planning
  text
- **Self-Review** — original inline review paragraph → our push-task review text
- **Execution Handoff** — original two-option dispatch → our single-option text

Other replaces stay as targeted small patches:
- description line add "or selected roadmap phase"
- git-worktrees delete (as is)
- save-paths add roadmap phase path
- Plan Header add Roadmap/Phase fields
- "REQUIRED SUB-SKILL" line translate subagent → executing-plans
- self-review checklist items add roadmap/phase language

**plan-document-reviewer-prompt.md:** Same structural translation as spec
reviewer — two replaces, keep all upstream content.

### `requesting-code-review.json`

**SKILL.md:** Five replaces, all mechanism translations, all correct. No
consolidation needed. Keep as is.

**code-reviewer.md:** Same structural translation pattern:

1. Replace header: `Use this template when dispatching a code reviewer
   subagent.` → `Use this template as the prompt argument to \`push-task\` when
   requesting a fresh-context code review.`
2. Replace wrapper: `Task tool (general-purpose):\n  description: "Review code
   changes"\n  prompt: |` → `push-task:\n  prompt: |`

Keep all upstream content: purpose, placeholders, "Reviewer returns", example
output section, everything. Drop the current destructive patches (delete fence,
de-indent, strip reviewer-returns).

### `writing-skills.json`

Most patches are `Claude` → `agent`/`Pi` substitutions — keep as small
replaces.

Three patches currently rewrite instructional content instead of translating:

**Patch 1 — subagent usage advice (line ~240):**

Upstream:
```
Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.
```
Current (rewrites completely):
```
Use the read tool to load skills when needed.
```
Fix (translate mechanism only):
```
Use push-task for fresh-context work (50-100x context savings). REQUIRED: Use /skill:other-skill-name for workflow.
```
The "50-100x context savings" and "REQUIRED" enforcement pattern are upstream
instructional content worth keeping.

**Patch 2 — search workflow (line ~253):**

Upstream:
```
[Dispatch subagent → synthesis]
```
Current (changes concept):
```
[Fresh context search → synthesis]
```
Fix:
```
[push-task → synthesis]
```

**Patch 3 — RED/GREEN/REFACTOR testing section (lines ~536-556):**

Keep the three-phase structure and all methodology text. Only change:
- "Run pressure scenario with subagent" → "Run pressure scenario with
  push-task"
- "with subagent WITHOUT the skill" → "with push-task WITHOUT the skill"
- Add "Act on the returned task result when you get it" after each
  push-task invocation (necessary because Pi's push-task returns results
  the agent must process — this is mechanism information, not a rewrite)
- GREEN section already says "Agent should now comply" — that's fine as is

The `testing-skills-with-subagents.md` header change (`# Testing Skills With
Subagents` → `# Testing Skills With Agents`) is fine as is.
`examples/CLAUDE_MD_TESTING.md` patches are mechanical (`~/.claude/skills/` →
`~/.pi/skills/`, `Claude` → `An agent`), fine as is.
`render-graphs.js` already excluded, fine.

### `executing-plans.json`

Two delete-line patches (subagent notice, git-worktrees). Keep as is — simple,
correct.

### Skills with no per-file patches

`finishing-a-development-branch.json`, `receiving-code-review.json`,
`systematic-debugging.json` (exclude only), `test-driven-development.json`,
`verification-before-completion.json` — common-patch only. No change needed.

## Mechanism Translation Convention

For all files following the upstream "subagent dispatch" pattern, the
translation is:

```
Before (upstream):
  Task tool (general-purpose):
    description: "<task description>"
    prompt: |
      <indented prompt body>

After (our output):
  push-task:
    prompt: |
      <indented prompt body>
```

The `description` field is dropped because Pi's `push-task` takes only a prompt
string. Everything else — purpose, dispatch context, prompt body, closing fence,
"Reviewer returns", placeholders — stays exactly as upstream wrote it.

## Files Affected

| File | Change type |
|---|---|
| `updater/skills/brainstorming.json` | Merge roadmap replaces; fix reviewer file patches |
| `updater/skills/writing-plans.json` | Block-consolidate 3 sections; fix reviewer file patches |
| `updater/skills/requesting-code-review.json` | Fix code-reviewer.md patches |
| `updater/skills/writing-skills.json` | Fix 3 instructional-content rewrites |
| `updater/skills/executing-plans.json` | No change |
| `updater/skills/finishing-a-development-branch.json` | No change |
| `updater/skills/receiving-code-review.json` | No change |
| `updater/skills/systematic-debugging.json` | No change |
| `updater/skills/test-driven-development.json` | No change |
| `updater/skills/verification-before-completion.json` | No change |
| `updater/common-patch.json` | No change |

## Verification

1. `npm run updater` — exits 0, no unmatched patches
2. `npm run verify` — full gate passes
3. Spot-check output files: reviewer prompt files retain purpose, placeholders,
   "Reviewer returns", examples
4. Diff upstream → output confirms only mechanism translations + Pi feature
   additions differ

# AGENTS.md — pi-supergsd

A Pi extension packaging patched [Superpowers](https://github.com/obra/superpowers) skills.

## Architecture

- **`skills/`** — generated skills (from updater) + custom skills (`writing-roadmaps`). Committed. Served at runtime via `package.json` → `pi.skills`.
- **`updater/`** — build-time only. Clones upstream, applies declarative patches, writes results to `skills/`.

```
updater/
├── updater.ts              # Entry: clones, patches, writes
├── common-patch.json       # Patches applied to every file after per-file patches
├── skills/                 # JSON defs (brainstorming.json, …)
└── lib/                    # patcher, source, types (all with tests)
```

## Conventions

- TypeScript, ES modules, Node 20+, `tsx` for execution
- Node built-in test runner (`node:test`)
- Patches: per-file first, then `common-patch.json` across all files

## Commands

```bash
npm run fix           # Prettier then ESLint autofix
npm test              # All tests (updater/ + scripts/)
npm run updater       # Regenerate skills from upstream + patches
npx tsc --noEmit      # Type-check updater/ + scripts/
npm run verify        # Full gate: tsc → eslint → test → updater → prettier --check
```

The updater exits non-zero if any patch fails to match — intentional drift detection.

**Commit sequence:** `fix` first to autofix what it can, then `verify` for the full gate (tsc → eslint → test → updater → prettier --check). Never skip `fix`.

## Formatting

- **Prettier** formats all `.ts` files. Default config except `singleQuote: true` to match codebase conventions.
- Generated `skills/` directory is ignored via `.prettierignore`.
- `npm run fix` runs Prettier write then ESLint autofix.
- `npm run verify` includes `prettier --check` to enforce formatting in CI.

## Testing policy

- Prefer integration tests through public API: tools and commands
- Don't export internals (helpers, types, constants) for testing
- Single `makeHarness()` with blocking `waitForIdle`; use `releaseNextIdle()` to advance
- Use harness wrappers (`runStartTask`, `runFinishTask`, etc.) to invoke commands cleanly
- Manual session injection only for Pi-produced entries (user/assistant messages), not task state

## Adding or modifying a skill

### Upstream-derived skills

1. Create `updater/skills/<name>.json` (see existing for format)
2. `npm run updater`
3. Verify output in `skills/<name>/`
4. `npm run fix` — autofix lint issues first
5. `npm run verify` — full gate before commit
6. Commit definition + generated files

### Custom skills

1. Create `skills/<name>/SKILL.md` with frontmatter (`name`, `description`)
2. Add supporting files alongside
3. Commit

Custom skills coexist with updater-generated ones. The updater only touches skills with definitions in `updater/skills/`.

### Skill definition format

```json
{
  "name": "my-skill",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [{ "op": "replace", "find": "Claude Code", "replace": "Pi" }]
    }
  ],
  "exclude": ["optional-file-to-skip.md"]
}
```

### Patch operations

| Op              | Behavior                                              |
| --------------- | ----------------------------------------------------- |
| `replace`       | Exact string replacement, all occurrences             |
| `regex-replace` | Regex replacement with capture groups (`$1`, …)       |
| `delete-line`   | Delete lines containing `find`                        |
| `delete-block`  | Delete from `findStart` through `findEnd` (inclusive) |
| `prepend`       | Add text at start of file                             |
| `append`        | Add text at end of file                               |

## Gotchas

- **Patches are sequential.** A `delete-line` removing a line will cause later patches targeting that line to fail. Merge or order carefully.
- **Per-file patches target upstream text** (`superpowers:`, not `/skill:`). Common patches normalize afterward.
- **Verify after running updater.** Check generated files before committing.

## Agent skills

### Issue tracker

Issues for this repo live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default triage label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

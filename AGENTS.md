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
npm test              # All tests (updater/ + scripts/)
npm run updater       # Regenerate skills from upstream + patches
npx tsc --noEmit      # Type-check updater/ + scripts/
```

The updater exits non-zero if any patch fails to match — intentional drift detection.

## Adding or modifying a skill

### Upstream-derived skills

1. Create `updater/skills/<name>.json` (see existing for format)
2. `npm run updater`
3. Verify output in `skills/<name>/`
4. Commit definition + generated files

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
      "patches": [
        { "op": "replace", "find": "Claude Code", "replace": "Pi" }
      ]
    }
  ],
  "exclude": ["optional-file-to-skip.md"]
}
```

### Patch operations

| Op | Behavior |
|---|---|
| `replace` | Exact string replacement, all occurrences |
| `regex-replace` | Regex replacement with capture groups (`$1`, …) |
| `delete-line` | Delete lines containing `find` |
| `delete-block` | Delete from `findStart` through `findEnd` (inclusive) |
| `prepend` | Add text at start of file |
| `append` | Add text at end of file |

## Gotchas

- **Patches are sequential.** A `delete-line` removing a line will cause later patches targeting that line to fail. Merge or order carefully.
- **Per-file patches target upstream text** (`superpowers:`, not `/skill:`). Common patches normalize afterward.
- **Verify after running updater.** Check generated files before committing.

# AGENTS.md — pi-supergsd

## What this project is

A Pi extension that packages curated, patched [Superpowers](https://github.com/obra/superpowers) skills for Pi users.

**Build time:** `npm run updater` clones the upstream Superpowers repo, applies declarative patches, and writes patched skills to `skills/`.

**Runtime:** `index.ts` serves skills via Pi's `resources_discover` event.

## Architecture

```
pi-supergsd/
├── index.ts                    # Pi extension entry point (runtime, no network calls)
├── skills/                     # Generated: patched skill files (committed)
├── updater/
│   ├── updater.ts              # Entry script: clones, patches, writes
│   ├── common-patch.json       # Patches applied to EVERY file after per-file patches
│   ├── skills/                 # One JSON definition per included skill
│   │   ├── brainstorming.json
│   │   ├── systematic-debugging.json
│   │   └── ... (10 total)
│   └── lib/
│       ├── patcher.ts          # Pure patch engine (no side effects)
│       ├── patcher.test.ts     # Unit tests for patch engine
│       ├── source.ts           # Git clone/update and local file reader
│       ├── source.test.ts      # Black-box tests for git source module
│       └── types.ts            # Shared TypeScript types
```

## Key conventions

- **TypeScript**, ES modules (`"type": "module"`), Node 20+, `tsx` for execution
- **Native `fetch`**, Node built-in test runner (`node:test`)
- Patches are applied in order: **per-file patches first, then common patches**
- The `updater/` directory is build-time tooling. `index.ts` and `skills/` are runtime assets.

## How to test

```bash
# Run patch engine unit tests (11 tests)
npm test

# Run the updater — fetches fresh skills from upstream, applies patches
npm run updater

# Type-check everything
npx tsc --noEmit
```

The updater exits non-zero if any patch fails to match upstream content. This is intentional — it catches upstream drift.

## How to add or modify a skill

1. Create `updater/skills/<name>.json` (see existing files for format)
2. Run `npm run updater`
3. Verify the output in `skills/<name>/`
4. Commit both the definition and generated files

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
| `regex-replace` | Regex replacement with `$1`, `$2` capture groups |
| `delete-line` | Delete any line containing the find string |
| `delete-block` | Delete lines from `findStart` through `findEnd` (inclusive) |
| `prepend` | Add text at start of file |
| `append` | Add text at end of file |

Patches that don't match are returned in `unmatched` and reported as warnings. The updater exits non-zero if any fail.

## Important gotchas

- **Patches are applied sequentially.** A `delete-line` that removes a line will cause later patches targeting text on that same line to fail. Merge or order carefully.
- **Per-file patches run first.** They operate on original upstream content. Common patches normalize afterward. Write per-file `find` strings against upstream text (e.g. `superpowers:`, not `/skill:`).
- **Always verify after running updater.** Check that generated files look correct before committing.
- **`index.ts` is not type-checked cleanly without Pi's runtime types.** The `@earendil-works/pi-coding-agent` types are provided at runtime by Pi. Only `updater/` files need to compile with `npx tsc --noEmit`.

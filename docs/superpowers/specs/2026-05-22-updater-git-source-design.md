# Updater Git Source Refactor — Design Spec

## Problem

Current updater fetches every file individually from `raw.githubusercontent.com`. Skill definitions must explicitly list every file. Adding a new upstream file requires updating the JSON definition. Per-file patches are authored against post-common-patch content (e.g. must use "Pi" instead of "Claude Code"), which is confusing and fragile.

## Goals

1. **Default copy**: All files in a skill directory are copied by default; only exceptions need configuration.
2. **Patch merge**: Per-file patches run against original upstream content, then common patches normalize.
3. **Git clone**: Replace raw GitHub fetches with a local git clone for discovery and reading.
4. **Simple interface**: Hardcode the source repo and ref; infer skill paths; minimal parameters.

## Design

### New File: `updater/lib/source.ts`

Three functions, no parameters to the main entry point:

```ts
// Clone or update the hardcoded repo into a temp cache directory.
// Idempotent: safe to call multiple times.
export async function superpowersUpdate(): Promise<void>;

// Return all file paths (relative to repo root) under skills/{name}/.
// Synchronous: reads from already-cloned local filesystem.
export function superpowersGetSkill(name: string): string[];

// Return file content by repo-relative path.
// Synchronous: reads from already-cloned local filesystem.
export function superpowersGetFile(filePath: string): string;
```

**Hardcoded values:**
- Repo: `obra/superpowers`
- Ref: `main`
- Cache dir: `{os.tmpdir()}/pi-supergsd-updater/superpowers-main/`

**Implementation:**
- If cache dir does not exist: `git clone --depth 1 --branch main https://github.com/obra/superpowers.git {cacheDir}`
- If cache dir exists: try `cd {cacheDir} && git fetch --depth 1 origin main && git reset --hard origin/main`. On any failure, delete the cache dir recursively and fall back to fresh clone.
- `superpowersGetSkill` uses `fs.readdirSync` with `recursive: true`, filters to files under `skills/{name}/`, strips the prefix, returns repo-relative paths.
- `superpowersGetFile` prepends cache dir and reads with `readFileSync`.

### Skill Definition Format Change

`updater/lib/types.ts`:

```ts
export interface SkillDefinition {
  name: string;
  files?: SkillFile[];   // sparse: only files needing per-file patches
  exclude?: string[];    // paths relative to skill dir to skip
}
```

Remove `SkillSource` interface entirely — no longer needed.

### Patch Order Change

In `updater/updater.ts`, replace:

```ts
const afterCommon = applyPatches(raw, commonPatches);
const afterFile = applyPatches(afterCommon.result, file.patches);
```

With:

```ts
const mergedPatches = [...file.patches, ...commonPatches];
const { result, unmatched } = applyPatches(raw, mergedPatches);
```

Per-file patches now see original upstream content. Common patches run last.

### Updater Flow

```
for each definition:
  getSkill(name) → all file paths under skills/{name}/
  filter out excluded paths
  for each remaining file:
    getFile(path) → raw content
    applyPatches(raw, [...perFilePatches, ...commonPatches])
    write output
```

### Testing Strategy

**Black-box tests** in `updater/lib/source.test.ts`:

1. Call `superpowersUpdate()` — assert does not throw.
2. Call `superpowersGetSkill('brainstorming')` — assert returns non-empty array of strings.
3. Call `superpowersGetFile(path)` for one of those paths — assert returns non-empty string.
4. Call `superpowersUpdate()` again — assert still works (idempotent update).

No mocks. Tests create their own temp cache dir (via an internal test-only override or env var) to avoid clobbering the default cache.

## Skill Definition Simplification

After the change, a skill like `systematic-debugging` goes from listing 6 files to:

```json
{
  "name": "systematic-debugging"
}
```

A skill like `brainstorming` goes from 7 files to:

```json
{
  "name": "brainstorming",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "invoke writing-plans skill", "replace": "invoke the /skill:writing-plans command" },
        { "op": "replace", "find": "Invoke writing-plans skill", "replace": "Invoke the /skill:writing-plans command" }
      ]
    }
  ]
}
```

## Files to Modify

| File | Change |
|------|--------|
| `updater/lib/source.ts` | **New** — git clone/pull, getSkill, getFile |
| `updater/lib/source.test.ts` | **New** — black-box tests |
| `updater/lib/types.ts` | Remove `SkillSource`, simplify `SkillDefinition` |
| `updater/updater.ts` | Use source.ts, reverse patch order, handle discovery, remove `output` logic |
| `updater/lib/patcher.ts` | No changes |
| `updater/skills/*.json` | Simplify — remove `source`, remove files with empty patches |
| `updater/skills/using-superpowers.json` | **Delete** |
| `index.ts` | Remove `before_agent_start` handler that injects `system-prompt.md` |
| `system-prompt.md` | **Delete** (no longer generated) |

## Error Handling

- `git` not installed: throw clear error at startup.
- `superpowersUpdate` fails: propagate error, don't proceed.
- `superpowersGetSkill` for missing skill: return empty array (will fail naturally when no files match).
- `superpowersGetFile` for missing file: throw `ENOENT` error.

## Spec Self-Review

- **Placeholder scan**: None. All values are explicit.
- **Internal consistency**: Hardcoded repo/ref in source.ts matches the upstream source previously declared in skill definitions.
- **Scope check**: This is a focused refactor — git source, default copy, patch order. Nothing else.
- **Ambiguity check**: `exclude` paths are relative to skill dir, not repo root. This is consistent with `files[].path`.

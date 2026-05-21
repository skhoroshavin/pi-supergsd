# Superpowers for Pi — Extension Design

> **Date:** 2026-05-21  
> **Status:** Awaiting implementation  
> **Scope:** Build a Pi extension that packages curated, patched Superpowers skills for Pi users.

---

## 1. Overview & Goal

### What We're Building

A Pi extension called `pi-supergsd` that packages a curated, patched subset of the [Superpowers skills library](https://github.com/obra/superpowers) for Pi users.

### How It Works

1. **Build time:** An `update.ts` script downloads selected Superpowers skills from GitHub.
2. It applies **declarative patches** to remove harness-specific concepts (subagents, `TodoWrite`, Claude's `Skill` tool, etc.).
3. It writes the **patched skills** to a `skills/` directory inside the extension.
4. **Runtime:** The Pi extension serves those skills statically via `resources_discover` — no network calls, fast, works offline.

### Goal

Pi users get high-quality Superpowers skills (brainstorming, TDD, debugging, code review, etc.) adapted for Pi's toolset and conventions, with an easy update path when Superpowers upstream changes.

---

## 2. Architecture & Components

```
pi-supergsd/
├── index.ts                    # Pi extension entry point
├── package.json                # Extension metadata + npm scripts
├── updater/
│   ├── updater.ts              # Thin entry point script
│   ├── common-patch.json       # Patches applied to EVERY file
│   ├── lib/                    # Updater logic + tests
│   │   ├── patcher.ts          # Patch engine (pure function)
│   │   ├── fetcher.ts          # GitHub raw content fetcher
│   │   ├── types.ts            # Shared types
│   │   └── patcher.test.ts     # Unit tests for patch engine
│   └── skills/                 # One definition file per included skill
│       ├── brainstorming.json
│       ├── test-driven-development.json
│       ├── systematic-debugging.json
│       ├── verification-before-completion.json
│       ├── requesting-code-review.json
│       ├── receiving-code-review.json
│       ├── using-git-worktrees.json
│       ├── finishing-a-development-branch.json
│       ├── writing-plans.json
│       ├── writing-skills.json
│       └── using-superpowers.json
└── skills/                     # Generated at build time (committed)
    ├── brainstorming/
    │   ├── SKILL.md
    │   └── references/
    │       └── testing-anti-patterns.md
    ├── systematic-debugging/
    │   ├── SKILL.md
    │   ├── root-cause-tracing.md
    │   ├── defense-in-depth.md
    │   └── condition-based-waiting.md
    └── ...
```

### 2.1 Extension (`index.ts`)

Exports a default factory function. On `resources_discover`, discovers all subdirectories under `skills/` and returns them as `skillPaths`.

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", () => {
    const skillDir = join(baseDir, "skills");
    return { skillPaths: [skillDir] };
  });
}
```

No runtime network calls. No dynamic fetching. Pure static file serving.

### 2.2 Skill Definition File (`updater/skills/<name>.json`)

Each file is a **standalone skill definition** — no root manifest needed.

**Minimal example (no extra files):**

```json
{
  "name": "brainstorming",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/brainstorming"
  },
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        {
          "op": "replace",
          "find": "invoke writing-plans skill",
          "replace": "invoke the /skill:writing-plans command"
        }
      ]
    }
  ]
}
```

**With additional files:**

```json
{
  "name": "systematic-debugging",
  "source": {
    "repo": "obra/superpowers",
    "ref": "main",
    "path": "skills/systematic-debugging"
  },
  "files": [
    { "path": "SKILL.md", "patches": [] },
    { "path": "root-cause-tracing.md", "patches": [] },
    { "path": "defense-in-depth.md", "patches": [] },
    { "path": "condition-based-waiting.md", "patches": [] }
  ]
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill name (must match directory name in upstream) |
| `source.repo` | string | Yes | GitHub repo (`owner/repo`) |
| `source.ref` | string | Yes | Git ref (branch, tag, or SHA) |
| `source.path` | string | Yes | Path within repo to skill directory |
| `files` | array | Yes | List of files to fetch and patch |
| `files[].path` | string | Yes | Relative path within skill directory |
| `files[].patches` | array | Yes | Ordered list of patch ops (empty array = fetch only) |

### 2.3 Common Patch (`updater/common-patch.json`)

Applied to **every fetched file** before per-file patches:

```json
[
  { "op": "replace", "find": "Claude Code", "replace": "Pi" },
  { "op": "replace", "find": "the Skill tool", "replace": "the read tool" },
  { "op": "replace", "find": "superpowers:", "replace": "/skill:" },
  { "op": "replace", "find": "TodoWrite", "replace": "a todo list" },
  { "op": "regex-replace", "find": "Task\\(\"", "replace": "subagent dispatch (\"" }
]
```

### 2.4 Patch Engine (`updater/lib/patcher.ts`)

The patch engine is a pure function with no side effects — all replacement logic lives here:

```typescript
function applyPatches(content: string, patches: Patch[]): { result: string; unmatched: Patch[] };
```

Returns the patched content plus a list of patches that failed to match (for reporting).

**Patch Operation Types:**

| Op | Parameters | Behavior |
|---|---|---|
| `replace` | `find`, `replace` | Exact string replacement. All occurrences. |
| `regex-replace` | `find`, `replace` | Regex replacement. Supports capture groups in `replace` via `$1`, `$2`, etc. |
| `delete-line` | `find` | Delete any line containing the exact string. |
| `delete-block` | `findStart`, `findEnd` | Delete all lines from the line matching `findStart` (inclusive) through the line matching `findEnd` (inclusive). |
| `prepend` | `text` | Add text at the start of the file. |
| `append` | `text` | Add text at the end of the file. |

**Order of application:**
1. Fetch raw content from GitHub
2. Apply `common-patch.json` operations in order
3. Apply per-file `patches` operations in order
4. Write result to `skills/{name}/{file-path}`

---

## 3. Data Flow

The `updater.ts` script runs in this sequence:

1. **Discover skill definitions** — reads all `update/skills/*.json` files.
2. **Load common patch** — reads `update/common-patch.json`.
3. **For each skill definition:**
   a. **Resolve source URL** — build `https://raw.githubusercontent.com/{repo}/{ref}/{path}/`
   b. **For each file in `files` array:**
      i. `fetch()` the raw file from GitHub.
      ii. Apply **common patches** in order.
      iii. Apply **per-file patches** in order.
      iv. Write result to `skills/{skill-name}/{file-path}`.
4. **Report summary** — list fetched skills, files per skill, patch count, any failures.

**Example flow for `systematic-debugging`:**

```
updater/skills/systematic-debugging.json
  → fetch https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/SKILL.md
  → fetch https://raw.githubusercontent.com/obra/superpowers/main/skills/systematic-debugging/root-cause-tracing.md
  → fetch .../defense-in-depth.md
  → fetch .../condition-based-waiting.md
  → apply common-patch.json to each
  → apply per-file patches to each
  → write to skills/systematic-debugging/{SKILL.md, root-cause-tracing.md, ...}
```

---

## 4. Error Handling

| Failure | Behavior |
|---|---|
| **Network failure** (GitHub down, rate limit) | Script exits non-zero. Prints which file failed. No partial writes committed. |
| **Patch fails to match** (upstream changed text) | Print warning with context (line number, surrounding text). Skip that patch (continue with remaining patches). Exit non-zero at end. |
| **File write failure** | Exit immediately with error. |
| **Missing skill definition** | Not an error — simply means that skill isn't packaged. Skipped silently. |
| **Invalid patch operation** | Exit immediately with clear error showing invalid op name. |
| **Non-200 HTTP response** | Print error with URL and status code. Exit non-zero. |

**Rate limiting:** Add a 100ms delay between fetches. If `429` received, respect `Retry-After` header and retry up to 3 times with exponential backoff.

**Deterministic output:** The script always overwrites `skills/` completely on each run. Old skills not in definitions are preserved (or we can add `--clean` flag to purge them — see Future Work).

---

## 5. Testing

| Test | Approach |
|---|---|
| **Unit: patch application** | Small test harness that feeds known input + patches through `applyPatches()`, asserts expected output. Tests each operation type in isolation and in combination. |
| **Integration: full update run** | Run `npm run updater`, verify `skills/` directory structure matches definitions, spot-check 2–3 files for expected replacements (e.g., "Claude Code" → "Pi"). |
| **Regression: upstream drift** | A CI workflow (GitHub Actions) that runs `npm run update` nightly against `obra/superpowers@main`. Fails if any patch no longer matches (catches upstream text changes early). |

The patch engine is a pure function in `updater/lib/patcher.ts`:

```typescript
function applyPatches(content: string, patches: Patch[]): { result: string; unmatched: Patch[] };
```

Unit tests in `updater/lib/patcher.test.ts` cover each operation type in isolation, combinations, and edge cases (no match, overlapping rules, regex capture groups). No network calls needed. |

---

## 6. Excluded Skills

| Skill | Reason |
|---|---|
| `subagent-driven-development` | Core mechanic is dispatching subagents per task. Pi has no built-in `Task` tool for subagent dispatch. |
| `dispatching-parallel-agents` | Entirely about parallel subagent dispatch via `Task()` calls. |
| `executing-plans` | Heavily references `subagent-driven-development` as the preferred execution path; inline version references `TodoWrite`. |

These could be revisited if Pi's subagent extension becomes a standard, documented dependency. For now they are out of scope.

---

## 7. package.json

```json
{
  "name": "pi-supergsd",
  "version": "1.0.0",
  "description": "Superpowers skills packaged for Pi",
  "scripts": {
    "updater": "tsx updater/updater.ts",
    "test:updater": "node --test updater/lib/**/*.test.ts"
  },
  "pi": {
    "extensions": ["./index.ts"]
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

---

## 8. Included Skills (v1)

| Skill | Files | Notes |
|---|---|---|
| `brainstorming` | `SKILL.md` | Remove TodoWrite, adapt `writing-plans` reference |
| `test-driven-development` | `SKILL.md`, `references/testing-anti-patterns.md` | Remove subagent references in examples |
| `systematic-debugging` | `SKILL.md`, `root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md` | Update tool references |
| `verification-before-completion` | `SKILL.md` | Minimal changes |
| `requesting-code-review` | `SKILL.md`, `code-reviewer.md` | Remove subagent dispatch references |
| `receiving-code-review` | `SKILL.md` | Minimal changes |
| `using-git-worktrees` | `SKILL.md` | Update native tool references for Pi |
| `finishing-a-development-branch` | `SKILL.md` | Minimal changes |
| `writing-plans` | `SKILL.md` | Remove subagent references |
| `writing-skills` | `SKILL.md`, `references/anthropic-best-practices.md` | Remove subagent/TodoWrite references |
| `using-superpowers` | `SKILL.md` | Major rewrite — this is the "getting started" skill that teaches how to use skills in Pi |

---

## 9. Future Work (Post v1)

- **`--clean` flag** for `update.ts` to remove skills no longer in definitions.
- **CI workflow** for nightly upstream drift detection.
- **Version pinning** — allow `source.ref` to be a specific commit SHA for reproducible builds.
- **Subagent skills** — revisit `subagent-driven-development`, `dispatching-parallel-agents`, `executing-plans` if Pi's subagent extension becomes standard.
- **Patch validation mode** — `npm run update -- --check` that validates all patches match without writing files (useful for CI).

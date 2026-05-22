# Updater Git Source Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw GitHub fetches with git clone, add default file copying, reverse patch order so per-file patches run against original upstream content.

**Architecture:** A new `source.ts` module handles cloning/updating a local copy of the upstream repo. The updater discovers files by reading the local filesystem instead of explicit JSON lists. The patch engine remains unchanged; only the order of patch application changes.

**Tech Stack:** Node.js 20+, TypeScript, ES modules, native `node:test`, `child_process.exec` for git commands.

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `updater/lib/source.ts` | **Create** | Clone/update repo, list skill files, read file content |
| `updater/lib/source.test.ts` | **Create** | Black-box tests: clone, list, read, idempotency |
| `updater/lib/types.ts` | **Modify** | Remove `SkillSource`, simplify `SkillDefinition` |
| `updater/updater.ts` | **Modify** | Use source.ts, reverse patch order, remove `output` logic |
| `updater/lib/patcher.ts` | **No change** | Patch engine stays as-is |
| `updater/skills/*.json` | **Modify** | Remove `source`, remove empty file entries |
| `updater/skills/using-superpowers.json` | **Delete** | No longer needed |
| `index.ts` | **Modify** | Remove `before_agent_start` handler |
| `system-prompt.md` | **Delete** | No longer generated |

---

### Task 1: Create `updater/lib/source.ts`

**Files:**
- Create: `updater/lib/source.ts`

- [ ] **Step 1: Write `source.ts`**

```ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execAsync = promisify(exec);

const REPO = 'obra/superpowers';
const REF = 'main';
const CACHE_DIR = join(tmpdir(), 'pi-supergsd-updater', 'superpowers-main');

function cacheDir(): string {
  return process.env.PI_SUPERGSD_CACHE_DIR || CACHE_DIR;
}

export async function superpowersUpdate(): Promise<void> {
  const dir = cacheDir();

  try {
    statSync(dir);
  } catch {
    // Directory does not exist — clone fresh
    await execAsync(
      `git clone --depth 1 --branch ${REF} https://github.com/${REPO}.git "${dir}"`
    );
    return;
  }

  // Directory exists — try to update
  try {
    await execAsync(`cd "${dir}" && git fetch --depth 1 origin ${REF} && git reset --hard origin/${REF}`);
  } catch {
    // Update failed — wipe and re-clone
    rmSync(dir, { recursive: true, force: true });
    await execAsync(
      `git clone --depth 1 --branch ${REF} https://github.com/${REPO}.git "${dir}"`
    );
  }
}

export function superpowersGetSkill(name: string): string[] {
  const dir = cacheDir();
  const skillPath = join(dir, 'skills', name);
  const results: string[] = [];

  function walk(currentPath: string, prefix: string): void {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        results.push(`skills/${name}/${relativePath}`);
      }
    }
  }

  walk(skillPath, '');
  return results;
}

export function superpowersGetFile(filePath: string): string {
  const dir = cacheDir();
  return readFileSync(join(dir, filePath), 'utf-8');
}
```

- [ ] **Step 2: Verify `source.ts` type-checks**

Run: `npx tsc --noEmit`
Expected: No errors in `updater/lib/source.ts`

- [ ] **Step 3: Commit**

```bash
git add updater/lib/source.ts
git commit -m "feat: add git source module for updater"
```

---

### Task 2: Create `updater/lib/source.test.ts`

**Files:**
- Create: `updater/lib/source.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { superpowersUpdate, superpowersGetSkill, superpowersGetFile } from './source.js';

describe('source', () => {
  before(async () => {
    // Use a test-specific cache dir to avoid clobbering the default
    process.env.PI_SUPERGSD_CACHE_DIR = '/tmp/pi-supergsd-test-cache';
    await superpowersUpdate();
  });

  it('update does not throw', async () => {
    await assert.doesNotReject(superpowersUpdate());
  });

  it('getSkill returns non-empty array for known skill', () => {
    const files = superpowersGetSkill('brainstorming');
    assert.ok(files.length > 0, 'Expected non-empty file list');
    assert.ok(files.every(f => typeof f === 'string'), 'Expected all items to be strings');
    assert.ok(files.every(f => f.startsWith('skills/brainstorming/')), 'Expected repo-relative paths');
  });

  it('getFile returns non-empty string for known file', () => {
    const files = superpowersGetSkill('brainstorming');
    assert.ok(files.length > 0, 'Need at least one file to test');
    const content = superpowersGetFile(files[0]);
    assert.ok(typeof content === 'string' && content.length > 0, 'Expected non-empty string');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: All tests pass. Output shows:
```
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

- [ ] **Step 3: Commit**

```bash
git add updater/lib/source.test.ts
git commit -m "test: add black-box tests for git source module"
```

---

### Task 3: Simplify `updater/lib/types.ts`

**Files:**
- Modify: `updater/lib/types.ts`

- [ ] **Step 1: Replace the entire file**

```ts
export type PatchOp =
  | { op: 'replace'; find: string; replace: string }
  | { op: 'regex-replace'; find: string; replace: string }
  | { op: 'delete-line'; find: string }
  | { op: 'delete-block'; findStart: string; findEnd: string }
  | { op: 'prepend'; text: string }
  | { op: 'append'; text: string };

export type Patch = PatchOp;

export interface PatchResult {
  result: string;
  unmatched: Patch[];
}

export interface SkillFile {
  path: string;
  patches: Patch[];
}

export interface SkillDefinition {
  name: string;
  files?: SkillFile[];
  exclude?: string[];
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add updater/lib/types.ts
git commit -m "refactor: remove SkillSource, simplify SkillDefinition"
```

---

### Task 4: Rewrite `updater/updater.ts`

**Files:**
- Modify: `updater/updater.ts`

- [ ] **Step 1: Replace the entire file**

```ts
#!/usr/bin/env node
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches } from './lib/patcher.js';
import { superpowersUpdate, superpowersGetSkill, superpowersGetFile } from './lib/source.js';
import type { SkillDefinition, Patch } from './lib/types.js';

const baseDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(baseDir, '..');
const skillsOutputDir = join(projectDir, 'skills');
const commonPatchPath = join(baseDir, 'common-patch.json');
const skillDefsDir = join(baseDir, 'skills');

function loadDefinitions(): SkillDefinition[] {
  const files = readdirSync(skillDefsDir).filter((f) => f.endsWith('.json'));
  return files.map((f: string) => {
    const content = readFileSync(join(skillDefsDir, f), 'utf-8');
    const def: SkillDefinition = JSON.parse(content);
    return def;
  });
}

function getPatchesForFile(def: SkillDefinition, filePath: string): Patch[] {
  // filePath is relative to skill dir, e.g. "SKILL.md"
  const entry = def.files?.find((f) => f.path === filePath);
  return entry?.patches ?? [];
}

async function main(): Promise<void> {
  const commonPatches: Patch[] = JSON.parse(
    readFileSync(commonPatchPath, 'utf-8')
  );
  const definitions = loadDefinitions();

  await superpowersUpdate();

  let totalFiles = 0;
  let totalPatches = 0;
  let failedPatches = 0;

  for (const def of definitions) {
    console.log(`Processing: ${def.name}`);

    const outputPath = join(skillsOutputDir, def.name);
    mkdirSync(outputPath, { recursive: true });

    const skillFiles = superpowersGetSkill(def.name);

    for (const repoPath of skillFiles) {
      // repoPath is "skills/{name}/{filePath}"
      const relativePath = repoPath.slice(`skills/${def.name}/`.length);

      // Check excludes
      if (
        def.exclude?.some(
          (e) => relativePath === e || relativePath.startsWith(e + '/')
        )
      ) {
        console.log(`  Skipping (excluded): ${relativePath}`);
        continue;
      }

      console.log(`  Copying: ${relativePath}`);

      const raw = superpowersGetFile(repoPath);
      const perFilePatches = getPatchesForFile(def, relativePath);

      // Per-file patches first (against original content), then common patches
      const mergedPatches = [...perFilePatches, ...commonPatches];
      const { result, unmatched } = applyPatches(raw, mergedPatches);

      totalPatches += perFilePatches.length;
      failedPatches += unmatched.length;

      for (const u of unmatched) {
        console.warn(
          `    WARNING: patch did not match in ${relativePath}: ${JSON.stringify(u)}`
        );
      }

      const fileOutputPath = join(outputPath, relativePath);
      mkdirSync(dirname(fileOutputPath), { recursive: true });
      writeFileSync(fileOutputPath, result);

      totalFiles++;
    }
  }

  console.log(
    `\nDone. Skills: ${definitions.length}, Files: ${totalFiles}, Patches: ${totalPatches}, Failed: ${failedPatches}`
  );

  if (failedPatches > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify type-checks**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests to ensure patcher still works**

Run: `npm test`
Expected: All tests pass (existing patcher tests + new source tests)

- [ ] **Step 4: Commit**

```bash
git add updater/updater.ts
git commit -m "refactor: updater uses git source, default copy, reversed patch order"
```

---

### Task 5: Simplify Skill Definitions

**Files:**
- Modify: `updater/skills/brainstorming.json`
- Modify: `updater/skills/executing-plans.json`
- Modify: `updater/skills/finishing-a-development-branch.json`
- Modify: `updater/skills/receiving-code-review.json`
- Modify: `updater/skills/requesting-code-review.json`
- Modify: `updater/skills/systematic-debugging.json`
- Modify: `updater/skills/test-driven-development.json`
- Modify: `updater/skills/verification-before-completion.json`
- Modify: `updater/skills/writing-plans.json`
- Modify: `updater/skills/writing-skills.json`
- Delete: `updater/skills/using-superpowers.json`

- [ ] **Step 1: Replace `brainstorming.json`**

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

- [ ] **Step 2: Replace `executing-plans.json`**

```json
{
  "name": "executing-plans"
}
```

- [ ] **Step 3: Replace `finishing-a-development-branch.json`**

```json
{
  "name": "finishing-a-development-branch"
}
```

- [ ] **Step 4: Replace `receiving-code-review.json`**

```json
{
  "name": "receiving-code-review"
}
```

- [ ] **Step 5: Replace `requesting-code-review.json`**

```json
{
  "name": "requesting-code-review",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Dispatch a code reviewer subagent to catch issues before they cascade.", "replace": "Request a code review to catch issues before they cascade." },
        { "op": "replace", "find": "Dispatch code reviewer subagent:", "replace": "Request code review:" },
        { "op": "replace", "find": "Use Task tool with `general-purpose` type, fill template at `code-reviewer.md`", "replace": "Use the code-reviewer.md template for your review process." }
      ]
    },
    {
      "path": "code-reviewer.md",
      "patches": [
        { "op": "replace", "find": "Use this template when dispatching a code reviewer subagent.", "replace": "Use this template when requesting a code review." },
        { "op": "replace", "find": "Task tool (general-purpose):", "replace": "Review request:" }
      ]
    }
  ]
}
```

- [ ] **Step 6: Replace `systematic-debugging.json`**

```json
{
  "name": "systematic-debugging"
}
```

- [ ] **Step 7: Replace `test-driven-development.json`**

```json
{
  "name": "test-driven-development"
}
```

- [ ] **Step 8: Replace `verification-before-completion.json`**

```json
{
  "name": "verification-before-completion"
}
```

- [ ] **Step 9: Replace `writing-plans.json`**

```json
{
  "name": "writing-plans"
}
```

- [ ] **Step 10: Replace `writing-skills.json`**

```json
{
  "name": "writing-skills",
  "files": [
    {
      "path": "SKILL.md",
      "patches": [
        { "op": "replace", "find": "Personal skills live in agent-specific directories (`~/.claude/skills` for Pi, `~/.agents/skills/` for Codex)", "replace": "Personal skills live in agent-specific directories (`~/.pi/skills` for Pi, `~/.agents/skills/` for Codex)" },
        { "op": "replace", "find": "Pressure scenario with subagent", "replace": "Pressure scenario with agent behavior" },
        { "op": "replace", "find": "Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.", "replace": "Use the read tool to load skills when needed." }
      ]
    }
  ]
}
```

- [ ] **Step 11: Delete `using-superpowers.json`**

Run: `rm updater/skills/using-superpowers.json`

- [ ] **Step 12: Commit all skill definition changes**

```bash
git add updater/skills/
git commit -m "refactor: simplify skill definitions — remove source, empty file lists"
```

---

### Task 6: Remove `system-prompt.md` and `output` Logic

**Files:**
- Modify: `index.ts`
- Delete: `system-prompt.md`

- [ ] **Step 1: Replace `index.ts`**

```ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on('resources_discover', () => {
    const skillDir = join(baseDir, 'skills');
    return { skillPaths: [skillDir] };
  });
}
```

- [ ] **Step 2: Delete `system-prompt.md`**

Run: `rm system-prompt.md`

- [ ] **Step 3: Commit**

```bash
git add index.ts
git rm system-prompt.md
git commit -m "refactor: remove system-prompt.md generation and injection"
```

---

### Task 7: Update Per-File Patches for Reversed Patch Order

**Files:**
- Modify: `updater/skills/brainstorming.json`
- Modify: `updater/skills/requesting-code-review.json`
- Modify: `updater/skills/writing-skills.json`

With the patch order reversed (per-file first, common last), per-file patches now run against original upstream content. The common patch already replaces "Claude Code" → "Pi" and "superpowers:" → "/skill:", so per-file patches should use original upstream strings.

Verify each per-file patch still matches upstream content. If a patch referenced post-common-patch text (like "Pi" or "/skill:"), it would now fail. Review each patch:

- `brainstorming`: patches target "invoke writing-plans skill" — this is original upstream text, no change needed.
- `requesting-code-review`: patches target "Dispatch a code reviewer subagent", "Task tool with `general-purpose`" — original upstream text, no change needed.
- `writing-skills`: patches target "~/.claude/skills", "Pressure scenario with subagent", "Always use subagents" — original upstream text, no change needed.

No code changes required for this task — just verification.

- [ ] **Step 1: Verify by running the updater**

Run: `npm run updater`
Expected: Exits 0, no "patch did not match" warnings for per-file patches.

- [ ] **Step 2: If any per-file patch fails, fix it**

Check the warning, locate the string in upstream content, update the `find` field in the skill definition to match original upstream text.

- [ ] **Step 3: Commit if changes were needed**

```bash
git add updater/skills/*.json
git commit -m "fix: align per-file patches with original upstream content"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run the full updater**

Run: `npm run updater`
Expected: Exits 0, outputs correct file counts, generates `skills/` directory with expected content.

- [ ] **Step 4: Inspect generated output**

Run: `ls skills/`
Expected: 10 directories (brainstorming, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, systematic-debugging, test-driven-development, verification-before-completion, writing-plans, writing-skills)

Run: `ls skills/brainstorming/`
Expected: All upstream files copied (SKILL.md, visual-companion.md, scripts/ subdir, etc.)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: updater uses git clone, default copy, reversed patch order"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Git clone with fallback on update failure → Task 1
- ✅ `superpowersGetSkill` returns file list → Task 1, tested in Task 2
- ✅ `superpowersGetFile` reads content → Task 1, tested in Task 2
- ✅ Default copy of all files → Task 4 (`superpowersGetSkill` + loop over all files)
- ✅ `exclude` support → Task 4 (filter check)
- ✅ Reversed patch order → Task 4 (`[...perFilePatches, ...commonPatches]`)
- ✅ Remove `SkillSource` → Task 3
- ✅ Simplify skill definitions → Task 5
- ✅ Delete `using-superpowers` → Task 5
- ✅ Remove `system-prompt.md` injection → Task 6
- ✅ Verify per-file patches work with reversed order → Task 7

**2. Placeholder scan:**
- No TBD, TODO, or "implement later"
- No vague instructions like "add appropriate error handling"
- All code blocks contain complete, runnable code
- No "similar to Task N" references

**3. Type consistency:**
- `superpowersUpdate()` returns `Promise<void>` — consistent everywhere
- `superpowersGetSkill(name: string)` returns `string[]` — consistent
- `superpowersGetFile(filePath: string)` returns `string` — consistent
- `SkillDefinition.files` is optional (`?`) — used with `def.files?.find()` in Task 4
- `exclude` checked with `?.some()` — consistent with optional type

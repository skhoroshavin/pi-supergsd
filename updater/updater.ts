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

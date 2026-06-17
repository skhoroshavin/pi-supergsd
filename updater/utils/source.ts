import { execFile } from "node:child_process";

import { promisify } from "node:util";

import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";

import { join } from "node:path";

import { tmpdir } from "node:os";

export async function superpowersUpdate(): Promise<void> {
  const dir = cacheDir();

  try {
    statSync(dir);
  } catch {
    // Directory does not exist — clone fresh
    await execFileAsync("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      REF,
      `https://github.com/${REPO}.git`,
      dir,
    ]);
    return;
  }

  // Directory exists — try to update
  try {
    await execFileAsync("git", ["fetch", "--depth", "1", "origin", REF], {
      cwd: dir,
    });
    await execFileAsync("git", ["reset", "--hard", `origin/${REF}`], {
      cwd: dir,
    });
  } catch {
    // Update failed — wipe and re-clone
    rmSync(dir, { recursive: true, force: true });
    await execFileAsync("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      REF,
      `https://github.com/${REPO}.git`,
      dir,
    ]);
  }
}

export function superpowersGetSkill(name: string): string[] {
  const dir = cacheDir();
  const skillPath = join(dir, "skills", name);
  const results: string[] = [];

  try {
    statSync(skillPath);
  } catch {
    return [];
  }

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

  walk(skillPath, "");
  return results;
}

export function superpowersGetFile(filePath: string): string {
  const dir = cacheDir();
  return readFileSync(join(dir, filePath), "utf-8");
}

const REPO = "obra/superpowers";

const REF = "v5.1.0";

function cacheDir(): string {
  return process.env.PI_SUPERGSD_CACHE_DIR || CACHE_DIR;
}

const CACHE_DIR = join(tmpdir(), "pi-supergsd-updater", "superpowers-main");

const execFileAsync = promisify(execFile);

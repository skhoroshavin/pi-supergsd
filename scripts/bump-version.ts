import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(rootDir, "package.json");
const packageLockPath = join(rootDir, "package-lock.json");
const BUMP_ARGS = ["major", "minor", "patch"] as const;

type BumpArg = (typeof BUMP_ARGS)[number];

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

interface PackageJsonFile extends Record<string, unknown> {
  version: string;
}

interface PackageLockFile extends PackageJsonFile {
  packages?: Record<string, { version?: string } & Record<string, unknown>>;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args.find(isBumpArg);
  const noGit = args.includes("--no-git");

  if (!command) {
    throw new Error(`Missing command. Valid: ${BUMP_ARGS.join(", ")}`);
  }

  if (args.some((arg) => arg !== command && arg !== "--no-git")) {
    throw new Error(
      `Unknown argument. Valid: ${BUMP_ARGS.join(", ")}, --no-git`,
    );
  }

  if (!noGit) {
    const status = execSync("git status --porcelain", {
      cwd: rootDir,
      encoding: "utf8",
    }).trim();

    if (status) {
      throw new Error(
        "Working tree is not clean. Commit or stash changes first.",
      );
    }
  }

  const packageJson = readJson<PackageJsonFile>(packageJsonPath);
  const currentVersion = packageJson.version;
  const nextVersion = formatVersion(
    computeNext(parseVersion(currentVersion), command),
  );

  packageJson.version = nextVersion;
  writeJson(packageJsonPath, packageJson);

  const packageLock = readJson<PackageLockFile>(packageLockPath);
  packageLock.version = nextVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = nextVersion;
  }
  writeJson(packageLockPath, packageLock);

  if (noGit) {
    process.stdout.write(nextVersion);
    return;
  }

  execSync("git add package.json package-lock.json", {
    cwd: rootDir,
    stdio: "inherit",
  });
  execSync(`git commit -m "Bump version to ${nextVersion}"`, {
    cwd: rootDir,
    stdio: "inherit",
  });

  console.log(`\nBumped ${currentVersion} → ${nextVersion}`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, undefined, 2) + "\n");
}

function isBumpArg(value: string): value is BumpArg {
  return (BUMP_ARGS as readonly string[]).includes(value);
}

export function parseVersion(version: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid version (expected MAJOR.MINOR.PATCH): ${version}`);
  }

  const [, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

export function computeNext(
  current: ParsedVersion,
  command: BumpArg,
): ParsedVersion {
  switch (command) {
    case "major":
      return { major: current.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case "patch":
      return {
        major: current.major,
        minor: current.minor,
        patch: current.patch + 1,
      };
  }
}

export function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

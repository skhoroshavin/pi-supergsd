# npm-Publishable Pi Package Design

> **Date:** 2026-05-23  
> **Status:** Drafted for review  
> **Scope:** Make `pi-supergsd` publishable to npm as a Pi package installable via `pi install npm:pi-supergsd`.

---

## 1. Goal

Package this repository as a public npm package whose primary consumption path is:

```bash
pi install npm:pi-supergsd
```

This is a Pi package first, not a general-purpose npm library. The published artifact should expose this repository as a Pi extension package containing the committed `skills/` assets and runtime `index.ts`.

The package must also present clear provenance:

- **Direct upstream content source:** [`obra/superpowers`](https://github.com/obra/superpowers)
- **Additional inspiration:** [`gsd-build/gsd-2`](https://github.com/gsd-build/gsd-2)
- **Non-affiliation:** this project is **not affiliated with, endorsed by, or part of** the GSD project.

The repository license for this package should be **MIT**.

---

## 2. Current State

Today the repository already has the important runtime pieces:

- `index.ts` registers a Pi `resources_discover` handler that exposes `skills/`
- `package.json` already contains a `pi.extensions` manifest pointing at `./index.ts`
- `skills/` contains committed generated skill assets
- `updater/` contains the build-time updater and tests

What is missing is the packaging and release surface needed for public npm distribution:

- standard npm package metadata
- publish tarball boundaries
- user-facing README
- LICENSE file
- CI validation workflow
- manual release workflow for npm publication
- automated version bump/tag flow matching the maintainer’s preferred release style

---

## 3. Chosen Approach

### Recommendation

Use a **minimal Pi-package publish approach with no runtime build step**.

### Why

Pi can load TypeScript extensions directly, so there is no need to add a dist build solely for `pi install npm:pi-supergsd`.

This keeps the published package small and aligned with the actual usage model:

- publish `index.ts`
- publish `skills/**`
- exclude `updater/` and other maintainer-only files from the npm tarball

### Explicit non-goals

- No support commitment for direct `npm install` consumption outside Pi
- No conversion into a conventional compiled JavaScript library
- No runtime networking or postinstall behavior

---

## 4. Package Architecture

The published package should contain only runtime and documentation assets needed by Pi users and npm consumers reviewing the package:

- `index.ts`
- `skills/**`
- `README.md`
- `LICENSE`
- `package.json`

The updater remains repository-local tooling for maintainers and CI verification, but not part of the published tarball.

### Runtime flow

1. User runs `pi install npm:pi-supergsd`
2. Pi installs the package from npm
3. Pi reads the package manifest
4. Pi discovers `pi.extensions = ["./index.ts"]`
5. The extension contributes `skills/` through `resources_discover`
6. Pi loads the packaged skills for use in sessions

No additional build, bootstrap, or network step is required at install time.

---

## 5. Package Manifest Changes

`package.json` should be updated to clearly describe a Pi package published on npm.

### Required metadata

- `name: "pi-supergsd"`
- `license: "MIT"`
- `keywords` including `pi-package`
- `repository`
- `homepage`
- `bugs`
- `readme` may be added explicitly if desired, though npm can infer it

### Pi manifest

Keep:

```json
"pi": {
  "extensions": ["./index.ts"]
}
```

### Publish boundary

Add a `files` allowlist so the published tarball contains only the intended assets:

```json
"files": [
  "index.ts",
  "skills",
  "README.md",
  "LICENSE"
]
```

### Pi runtime compatibility

Declare Pi runtime compatibility as a peer dependency:

```json
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*"
}
```

This package is not expected to execute as a normal library import; the peer dependency exists to express runtime coupling to Pi.

---

## 6. README Content

Add a top-level `README.md` tailored to npm and Pi users.

### Required sections

1. **What this package is**
   - a curated, patched Superpowers skill pack for Pi
2. **Installation**
   - `pi install npm:pi-supergsd`
3. **What it provides**
   - packaged Pi skills served by the extension
4. **How this repo is maintained**
   - updater-based workflow from upstream Superpowers
5. **Credits / Attribution**
   - direct attribution to `obra/superpowers`
   - inspiration attribution to `gsd-build/gsd-2`
6. **Non-affiliation statement**
   - explicit statement that this project is not affiliated with or endorsed by GSD
7. **License**
   - MIT for this repository/package

### Provenance wording requirements

The README should make these distinctions clearly:

- **Upstream skills/content origin:** `obra/superpowers`
- **Inspirational ideas/reference:** `gsd-build/gsd-2`
- **This repo’s contribution:** curation, patching, packaging, and Pi distribution

The attribution must be prominent enough that a casual reader does not mistake this project for an official Superpowers or GSD release.

---

## 7. License and Notice Handling

Add an MIT `LICENSE` file for this repository.

The README should also preserve provenance context so downstream users understand that the package includes adapted content derived from upstream Superpowers skills.

This design does not add a separate `NOTICE` file. Attribution and provenance live in the README through explicit credits, links, and the non-affiliation statement.

---

## 8. CI Validation Workflow

Add a validation workflow in `.github/workflows/test.yml`, modeled after the maintainer’s `eslint-plugin-unslop` style.

### Trigger

- `pull_request`
- `push` to `main`

### Permissions

- minimal read permissions are sufficient for validation

### Suggested steps

1. checkout
2. setup Node 24 with npm cache
3. `npm ci`
4. run a repository verification command
5. run tests
6. run `npm pack --dry-run`

### Verification scope

A repository-level verification script should cover the publishable package, not just updater unit tests. At minimum it should validate:

- package metadata is present
- tarball contents match expectations
- updater tests pass
- updater output is reproducible if updater verification is included

Add a new `npm run verify` command with this exact intent:

- run updater tests via `npm test`
- regenerate packaged skills via `npm run updater`
- fail if regeneration changes committed `skills/` output
- run `npm pack --dry-run`

CI should call this single canonical verification entrypoint.

---

## 9. Manual Release Workflow

Add a manual release workflow in `.github/workflows/release.yml`, closely mirroring `eslint-plugin-unslop`.

### Trigger

```yaml
on:
  workflow_dispatch:
    inputs:
      bump:
        description: Bump type
        required: true
        type: choice
        options: [patch, minor, major]
```

### Permissions

```yaml
permissions:
  contents: write
  id-token: write
```

### Why these permissions

- `contents: write` allows the workflow to commit the version bump and push the new tag
- `id-token: write` enables npm trusted publishing through OIDC

### Release steps

1. checkout `main`
2. setup Node 24 with npm registry configuration
3. `npm ci`
4. run a local version bump script
5. commit updated version files
6. create annotated tag `vX.Y.Z`
7. push `main` and tags back to GitHub
8. run verify
9. run tests if not already covered by verify
10. `npm publish`
11. create a GitHub release with generated notes

### Important difference from the current `phaser-pixui` pattern

This release is **manual-dispatch driven** and self-contained, not tag-push driven.

---

## 10. Version Bump Script

Add a repository script similar to `eslint-plugin-unslop/scripts/bump-version.ts`.

### Responsibilities

- accept one of `patch | minor | major`
- require a clean working tree unless explicitly bypassed for local testing
- update `package.json`
- update `package-lock.json`
- create a commit for the version bump

### Expected behavior

Given current version `1.2.3`:

- `patch` -> `1.2.4`
- `minor` -> `1.3.0`
- `major` -> `2.0.0`

The workflow then derives the tag from the new `package.json` version.

---

## 11. OIDC / npm Trusted Publishing

Publishing should use npm trusted publishing via GitHub Actions OIDC.

### Repository-side workflow requirements

- `permissions.id-token: write`
- `actions/setup-node` configured with npm registry
- `npm publish` executed in GitHub-hosted Actions

### npm-side one-time maintainer setup

Configure the package on npmjs.com with a trusted publisher relationship pointing to this repository’s release workflow filename.

### Important note

No long-lived npm automation token is required when trusted publishing is configured correctly.

The workflow should not depend on a `DEPLOY_KEY` for npm publishing. In this design, pushes back to the repository are expected to use the standard workflow GitHub token with `contents: write`, assuming repository settings permit it.

---

## 12. Files to Add or Modify

### Modify

- `package.json`
- `package-lock.json` (via release bumps and any dependency/script adjustments)

### Add

- `README.md`
- `LICENSE`
- `.github/workflows/test.yml`
- `.github/workflows/release.yml`
- `scripts/bump-version.ts`

### Likely optional additions

- `scripts/` directory for release helpers
- updated npm scripts such as `verify`

No runtime changes to `index.ts` are required for this publishability work unless implementation discovers a packaging-specific issue.

---

## 13. Error Handling and Failure Modes

### CI failures

Block merge/release if:

- dependencies fail to install
- tests fail
- verify fails
- `npm pack --dry-run` exposes incorrect publish contents
- updater regeneration produces unexpected diffs if reproducibility checking is enabled

### Release failures

Stop publish if:

- version bump script fails
- commit or tag creation fails
- push to GitHub fails
- verification or tests fail
- npm trusted publisher configuration is missing or incorrect
- `npm publish` fails

### Recovery expectations

- failed validation leaves repository unchanged
- failed release after version bump/tag push may require maintainer cleanup or a follow-up release run, depending on failure point
- release documentation should mention this operational caveat for maintainers

---

## 14. Testing Strategy

Implementation should verify the package at three levels.

### 14.1 Repository tests

- existing updater tests continue to pass via `npm test`

### 14.2 Packaging tests

- `npm pack --dry-run` shows only the intended files
- package metadata is present and correct
- README and LICENSE are included

### 14.3 Pi package usability test

A maintainer should validate at least once after implementation that a clean install path works:

```bash
pi install npm:pi-supergsd
```

And then confirm the extension contributes the expected skills in Pi.

---

## 15. Acceptance Criteria

This work is complete when all of the following are true:

1. `pi-supergsd` can be published to npm as a Pi package
2. users can install it with `pi install npm:pi-supergsd`
3. the npm package includes only the intended runtime/docs assets
4. the repository has an MIT license file
5. the README includes clear attribution to `obra/superpowers`
6. the README includes inspiration attribution to `gsd-build/gsd-2`
7. the README clearly states non-affiliation with GSD
8. CI validates package health on pull requests and pushes to `main`
9. a manual GitHub Actions release workflow can bump version, tag, publish to npm, and create a GitHub release
10. npm publication uses trusted publishing via OIDC rather than a long-lived npm token

---

## 16. Research Notes Informing This Design

This design intentionally mirrors the maintainer’s `eslint-plugin-unslop` release style:

- validation workflow on PR/push to `main`
- manual `workflow_dispatch` release
- required `bump` input
- scripted version bump in-repo
- `contents: write` and `id-token: write`
- `npm publish`
- GitHub release creation after publish

The OIDC/trusted publishing model follows current npm guidance: configure the trusted publisher on npm, grant `id-token: write` in GitHub Actions, and publish without a long-lived npm token.

# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills packaged as a [Pi](https://pi.dev) extension.

## Installation

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload` after installation.

## What this package provides

This package installs a Pi extension that exposes the committed `skills/` directory from this repository. The skills are generated from upstream Superpowers content and patched for Pi's toolset and workflow conventions.

## Maintenance

The `skills/` directory is generated and committed. Maintainers update it by editing `updater/skills/*.json` and then running:

```bash
npm run updater
```

Releases are published through the manual GitHub Actions workflow in `.github/workflows/release.yml`. Before the first release, configure npm trusted publishing for `release.yml` on npmjs.com.

## Credits and attribution

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- This repository curates, patches, and packages a subset of that upstream material for Pi.
- Additional ideas and release-process inspiration were informed by [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## Non-affiliation

This project is not affiliated with, endorsed by, or part of the GSD project.

## License

MIT. See [LICENSE](./LICENSE).

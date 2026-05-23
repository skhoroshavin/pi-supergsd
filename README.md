# pi-supergsd

Curated, patched [Superpowers](https://github.com/obra/superpowers) skills for [Pi](https://pi.dev), that don't depend on any other extensions.

## Install

```bash
pi install npm:pi-supergsd
```

If Pi is already running, restart it or run `/reload`.

## Maintaining

Edit definitions in `updater/skills/*.json`, then:

```bash
npm run updater
```

Releases are automated using GitHub actions: `.github/workflows/release.yml`

## Credits

- Skill content originates from [obra/superpowers](https://github.com/obra/superpowers).
- Context-management ideas were inspired by [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).

## License

MIT. See [LICENSE](./LICENSE).

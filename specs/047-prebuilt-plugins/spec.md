# 047 — Pre-built Plugins

## Summary

Change plugin distribution from "download source + npm install + build" to "download pre-built tarball with dist/ + node_modules/ included". This removes the need for build toolchain in production and is a prerequisite for all subsequent deployment work.

## Acceptance Criteria

- [ ] Plugin releases on GitHub include a pre-built tarball asset (`sowel-plugin-{id}-{version}.tar.gz`)
- [ ] Tarball contains: `manifest.json`, `dist/`, `node_modules/` (production only), `package.json`
- [ ] `PluginManager.installFromGitHub()` downloads the pre-built asset instead of source tarball
- [ ] `PluginManager.update()` uses the same pre-built asset strategy
- [ ] Remove `installAndBuild()` logic (npm install + tsc) from plugin-manager
- [ ] Plugin install works without npm, python3, make, or g++ on the host
- [ ] Existing 3 plugins (smartthings, weather-forecast, netatmo-security) have updated release pipelines
- [ ] Fallback: if no pre-built asset found, log error (no source build fallback)
- [ ] End-to-end validation: uninstall + reinstall each of the 3 plugins from the store, verify they load and function correctly
- [ ] End-to-end validation: update each plugin to a new version via UI, verify update succeeds

## Plugin Release Pipeline (GitHub Actions per plugin repo)

```yaml
on:
  push:
    tags: ["v*"]

jobs:
  release:
    steps:
      - npm ci
      - npm run build
      - npm prune --production
      - tar czf sowel-plugin-{id}-{version}.tar.gz manifest.json package.json dist/ node_modules/
      - gh release create --attach tarball
```

## PluginManager Changes

Current: `downloadRelease() → extract source → npm install → build → load`
New: `downloadPrebuiltAsset() → extract (ready to load) → load`

## File Changes

| File                                   | Change                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/plugins/plugin-manager.ts`        | Rewrite download + install logic, remove installAndBuild() |
| `.github/workflows/plugin-release.yml` | Template for plugin repos                                  |
| Each plugin repo                       | Add GitHub Actions workflow                                |

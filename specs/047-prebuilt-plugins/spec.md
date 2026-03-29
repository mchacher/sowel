# 047 — Pre-built Plugins

## Summary

Change plugin distribution from "download source + npm install + build" to "download pre-built tarball with dist/ + node_modules/ included". This removes the need for build toolchain in production and is a prerequisite for all subsequent deployment work.

## Acceptance Criteria

- [x] Plugin releases on GitHub include a pre-built tarball asset (`sowel-plugin-{id}-{version}.tar.gz`)
- [x] Tarball contains: `manifest.json`, `dist/`, `package.json` (no node_modules needed — plugins have no prod deps)
- [x] `PluginManager.installFromGitHub()` downloads the pre-built asset instead of source tarball
- [x] `PluginManager.update()` uses the same pre-built asset strategy
- [x] Remove `installAndBuild()` logic (npm install + tsc) from plugin-manager
- [x] Plugin install works without npm, python3, make, or g++ on the host
- [x] Existing 3 plugins (smartthings, weather-forecast, netatmo-security) have updated release pipelines
- [x] Fallback: if no pre-built asset found, log error (no source build fallback)
- [x] End-to-end validation: uninstall + reinstall weather-forecast from store — loads and functions correctly
- [x] End-to-end validation: update smartthings + weather-forecast to new version via API — succeeds

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

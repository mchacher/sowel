# Architecture: 047 — Pre-built Plugins

## No Data Model Changes

No new SQLite tables, no new types. Only changes to `PluginManager` internal logic.

## PluginManager Changes

### Current Flow (source install)

```
installFromGitHub(repo)
  → downloadRelease(repo)           # GitHub API → tarball_url (source) or .tar.gz asset
    → fetch tarball → extract with --strip-components=1
  → installAndBuild(pluginDir)      # npm install + npx tsc
  → register in DB
  → loadPlugin()
```

### New Flow (pre-built install)

```
installFromGitHub(repo)
  → downloadPrebuiltAsset(repo)     # GitHub API → find sowel-plugin-*.tar.gz asset
    → fetch asset → extract (NO --strip-components — tarball root IS the plugin)
  → register in DB (no build step)
  → loadPlugin()
```

### Key Differences

| Aspect            | Before                                                          | After                                     |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Download target   | Source tarball (fallback) or any .tar.gz asset                  | Only `sowel-plugin-{id}-*.tar.gz` asset   |
| Extract           | `--strip-components=1` (GitHub source tarballs have a root dir) | NO strip (pre-built tarball root is flat) |
| Post-extract      | `npm install` + `npx tsc`                                       | Nothing — dist/ already present           |
| Missing asset     | Fallback to source tarball_url                                  | Error: "No pre-built asset found"         |
| Host requirements | npm, node, python3, make, g++                                   | None (just tar)                           |

## Plugin Tarball Format

```
sowel-plugin-smartthings-0.6.0.tar.gz
├── manifest.json
├── package.json
├── dist/
│   └── index.js (+ other compiled files)
└── node_modules/    (only if plugin has production deps — currently none do)
```

Built by GitHub Actions in each plugin repo on tag push.

## GitHub Actions Workflow (per plugin repo)

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npm prune --production
      - name: Package tarball
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          PLUGIN_ID=$(node -p "require('./manifest.json').id")
          tar czf sowel-plugin-${PLUGIN_ID}-${VERSION}.tar.gz manifest.json package.json dist/
      - name: Create release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          PLUGIN_ID=$(node -p "require('./manifest.json').id")
          gh release create ${{ github.ref_name }} \
            sowel-plugin-${PLUGIN_ID}-${VERSION}.tar.gz \
            --title "${{ github.ref_name }}" \
            --generate-notes
```

## File Changes

| File                                                          | Change                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `src/plugins/plugin-manager.ts`                               | Replace `downloadRelease()` + remove `installAndBuild()` |
| `sowel-plugin-smartthings/.github/workflows/release.yml`      | Add CI workflow                                          |
| `sowel-plugin-weather-forecast/.github/workflows/release.yml` | Add CI workflow                                          |
| `sowel-plugin-netatmo-security/.github/workflows/release.yml` | Add CI workflow                                          |

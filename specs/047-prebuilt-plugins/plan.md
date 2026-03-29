# Implementation Plan: 047 — Pre-built Plugins

## Tasks

### Plugin repos (GitHub Actions + releases)

1. [x] Create `.github/workflows/release.yml` template
2. [x] Add workflow to sowel-plugin-smartthings, tag + release v0.7.0
3. [x] Add workflow to sowel-plugin-weather-forecast, tag + release v0.4.0
4. [x] Add workflow to sowel-plugin-netatmo-security, tag + release v0.4.0
5. [x] Verify all 3 releases contain pre-built tarball assets

### Sowel core (PluginManager)

6. [x] Rewrite `downloadRelease()` → `downloadPrebuiltAsset()` (find + download named .tar.gz asset)
7. [x] Remove `installAndBuild()` method entirely
8. [x] Remove `installAndBuild()` calls from `installFromGitHub()` and `update()`
9. [x] Adjust tar extraction (remove `--strip-components=1` for pre-built assets)
10. [x] Error if no pre-built asset found (no source fallback)
11. [x] TypeScript compilation check
12. [x] All tests pass

### Validation

13. [x] Uninstall + reinstall weather-forecast from store → plugin loads and functions (Playwright)
14. [x] Update smartthings + weather-forecast via API → update succeeds
15. [x] Deploy UI via deploy-ui.sh

## Testing

- Playwright: navigate to Plugins page, uninstall a plugin, reinstall from store, verify it appears as connected
- Playwright: trigger plugin update, verify new version shows
- Manual: confirm no npm/tsc calls in server logs during install

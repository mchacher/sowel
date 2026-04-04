# 053 — Implementation Plan

## Task Breakdown

### Step 1: Types

- [ ] Add `PackageType = "integration" | "recipe"` to `src/shared/types.ts`
- [ ] Add `type: PackageType` to `PluginManifest` (optional for backward compat, defaults to `"integration"`)
- [ ] Add `InstalledPackage` interface to `src/shared/types.ts`

### Step 2: Database Migration

- [ ] Create migration adding `type` column to `plugins` table (default `'integration'`)

### Step 3: PackageManager

- [ ] Create `src/packages/package-manager.ts`
- [ ] Extract from PluginManager: download, install, update, uninstall, enable, disable
- [ ] Extract: registry.json management, manifest validation
- [ ] Extract: DB operations (prepared statements)
- [ ] Add `getInstalledByType()` and `getStoreByType()` query methods

### Step 4: PluginLoader

- [ ] Create `src/plugins/plugin-loader.ts`
- [ ] Move from PluginManager: loadPlugin, unloadPlugin, loadAll
- [ ] Move: coreDeps, loadedPlugins map, integrationRegistry interaction
- [ ] Compose with PackageManager for install/update/uninstall/enable/disable
- [ ] Add `getInstalled()` returning enriched PluginInfo[]

### Step 5: Wiring

- [ ] Update `src/index.ts`: create PackageManager + PluginLoader, replace PluginManager
- [ ] Update `src/api/server.ts`: update ServerDeps, route registration
- [ ] Update `src/api/routes/plugins.ts`: use PackageManager + PluginLoader

### Step 6: Cleanup

- [ ] Delete `src/plugins/plugin-manager.ts`
- [ ] Verify no remaining imports of PluginManager

### Step 7: Registry + External Plugins

- [ ] Update `plugins/registry.json`: add `type: "integration"` to all 10 entries
- [ ] Update all 10 plugin repos: add `type: "integration"` to manifest.json, bump version
- [ ] Create GitHub releases for all 10 plugins
- [ ] Update `plugins/registry.json` with new versions

### Step 8: Validation

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all tests pass
- [ ] `npx eslint src/ --ext .ts` — zero errors

## Testing Strategy

- No new unit tests needed (pure refactoring, behavior unchanged)
- Existing tests must continue to pass
- Manual verification: plugins page in admin UI still works

## Risk Assessment

- **Low risk**: This is a code-level refactoring with no behavior change
- **Main risk**: Import paths — ensure all consumers reference the new files
- **Mitigation**: TypeScript compiler will catch missing/broken imports

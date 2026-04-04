# 053 — Architecture

## File Changes

### New Files

| File                              | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `src/packages/package-manager.ts` | Generic distribution: download, install, update, uninstall, registry, DB |
| `src/plugins/plugin-loader.ts`    | Integration-specific: import, createPlugin, register, load/unload        |

### Modified Files

| File                        | Change                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `src/shared/types.ts`       | Add `type` to `PluginManifest`, add `PackageType`                |
| `src/index.ts`              | Wire PackageManager + PluginLoader instead of PluginManager      |
| `src/api/routes/plugins.ts` | Use PackageManager + PluginLoader instead of PluginManager       |
| `src/api/server.ts`         | Replace PluginManager with PackageManager + PluginLoader in deps |
| `plugins/registry.json`     | Add `type: "integration"` to all 10 entries                      |

### Deleted Files

| File                            | Reason                                    |
| ------------------------------- | ----------------------------------------- |
| `src/plugins/plugin-manager.ts` | Replaced by PackageManager + PluginLoader |

### Migration

| File                             | Purpose                              |
| -------------------------------- | ------------------------------------ |
| `migrations/0XX_plugin_type.sql` | Add `type` column to `plugins` table |

## Class Design

### PackageManager

Extracted from PluginManager — all distribution logic, zero domain knowledge.

```typescript
class PackageManager {
  // -- DB --
  private db: Database.Database;
  private stmts: { getAll; getById; insert; updateEnabled; updateManifest; remove };
  private pluginsDir: string;
  private logger: Logger;

  // -- Distribution --
  installFromGitHub(repo: string): Promise<PluginManifest>;
  update(pluginId: string): Promise<PluginManifest>;
  uninstall(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;

  // -- Query --
  getInstalled(): InstalledPackage[]; // raw DB + manifest data
  getInstalledByType(type: PackageType): InstalledPackage[];
  getStore(): PluginManifest[]; // registry minus installed
  getStoreByType(type: PackageType): PluginManifest[];
  getPluginDir(pluginId: string): string; // resolve path for consumers

  // -- Internal --
  private downloadPrebuiltAsset(repo, tmpDir): Promise<string>;
  private getRepoFromRegistry(pluginId): string | undefined;
  private getLatestVersions(): Map<string, string>;
  private validateManifest(manifest): void;
}
```

Key difference from PluginManager: no `loadedPlugins` map, no `createPlugin()`, no `integrationRegistry`, no `coreDeps`.

### PluginLoader

Integration-specific consumer of PackageManager.

```typescript
class PluginLoader {
  private packageManager: PackageManager;
  private integrationRegistry: IntegrationRegistry;
  private coreDeps: Omit<PluginDeps, "pluginDir">;
  private loadedPlugins: Map<string, IntegrationPlugin>;
  private logger: Logger;

  // -- Lifecycle --
  loadAll(): Promise<void>; // load all enabled integration packages
  loadPlugin(pluginId: string): Promise<void>; // import + createPlugin + register
  unloadPlugin(pluginId: string): Promise<void>; // stop + unregister

  // -- Delegated to PackageManager (with domain hooks) --
  install(repo: string): Promise<PluginManifest>; // PM.install + load
  update(pluginId: string): Promise<PluginManifest>; // unload + PM.update + reload
  uninstall(pluginId: string): Promise<void>; // unload + PM.uninstall
  enable(pluginId: string): Promise<void>; // PM.enable + load
  disable(pluginId: string): Promise<void>; // PM.disable + unload

  // -- Query (enriched with runtime info) --
  getInstalled(): PluginInfo[]; // adds status, deviceCount, latestVersion
}
```

### InstalledPackage (new type)

Raw package data from DB — no runtime info (status, device count, etc.).

```typescript
interface InstalledPackage {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
}
```

## Data Flow

### Install Flow

```
API: POST /plugins/install { repo }
  → PluginLoader.install(repo)
    → PackageManager.installFromGitHub(repo)  // download, extract, validate, DB insert
    → PluginLoader.loadPlugin(id)             // import, createPlugin, register
  → Response: PluginInfo
```

### Load on Startup

```
main():
  PackageManager created
  PluginLoader created
  PluginLoader.loadAll()
    → PackageManager.getInstalledByType("integration")
    → for each enabled: PluginLoader.loadPlugin(id)
  IntegrationRegistry.startAll()  // unchanged
```

### Get Installed (API)

```
API: GET /plugins
  → PluginLoader.getInstalled()
    → PackageManager.getInstalled()         // raw DB data
    → enrich with: status, deviceCount from IntegrationRegistry
    → enrich with: latestVersion from PackageManager.getLatestVersions()
  → Response: PluginInfo[]
```

## Database Migration

```sql
-- migrations/0XX_plugin_type.sql
ALTER TABLE plugins ADD COLUMN type TEXT NOT NULL DEFAULT 'integration';
```

Existing rows get `type = 'integration'` via DEFAULT. New recipe packages will insert with `type = 'recipe'`.

## API Routes

No endpoint changes. The routes call PluginLoader instead of PluginManager. The store endpoint uses PackageManager directly.

| Endpoint                    | Before                            | After                       |
| --------------------------- | --------------------------------- | --------------------------- |
| GET /plugins                | pluginManager.getInstalled()      | pluginLoader.getInstalled() |
| GET /plugins/store          | pluginManager.getStore()          | packageManager.getStore()   |
| POST /plugins/install       | pluginManager.installFromGitHub() | pluginLoader.install()      |
| POST /plugins/:id/update    | pluginManager.update()            | pluginLoader.update()       |
| POST /plugins/:id/uninstall | pluginManager.uninstall()         | pluginLoader.uninstall()    |
| POST /plugins/:id/enable    | pluginManager.enable()            | pluginLoader.enable()       |
| POST /plugins/:id/disable   | pluginManager.disable()           | pluginLoader.disable()      |
| GET /plugins/:id/oauth/\*   | pluginManager + registry          | pluginLoader + registry     |

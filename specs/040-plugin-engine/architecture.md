# Architecture: Plugin Engine

## Data Model Changes

### New SQLite table: `plugins`

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  manifest TEXT NOT NULL -- full manifest.json as JSON string
);
```

### New types in types.ts

- `PluginManifest` — manifest.json schema
- `PluginInfo` — runtime info (manifest + status + integration status)
- `PluginDeps` — dependencies injected into plugins
- `PluginFactory` — `(deps: PluginDeps) => IntegrationPlugin`

## API Changes

| Method | Endpoint                      | Description                                          |
| ------ | ----------------------------- | ---------------------------------------------------- |
| GET    | /api/v1/plugins               | List installed plugins with status                   |
| GET    | /api/v1/plugins/store         | List available plugins from registry                 |
| POST   | /api/v1/plugins/install       | Install plugin from GitHub repo URL                  |
| POST   | /api/v1/plugins/:id/uninstall | Remove plugin (stop + delete files + remove from DB) |
| POST   | /api/v1/plugins/:id/enable    | Enable and start plugin                              |
| POST   | /api/v1/plugins/:id/disable   | Stop and disable plugin                              |

## UI Changes

New page: Administration > Plugins (`/plugins`)

- Tab "Installed": list of installed plugins with enable/disable/remove
- Tab "Store": available plugins from registry with install button

## File Changes

| File                            | Change                                               |
| ------------------------------- | ---------------------------------------------------- |
| `src/shared/plugin-api.ts`      | NEW: PluginDeps, PluginFactory, PluginManifest types |
| `src/shared/types.ts`           | Add PluginManifest, PluginInfo types                 |
| `src/plugins/plugin-manager.ts` | NEW: Plugin lifecycle management                     |
| `src/api/routes/plugins.ts`     | NEW: Plugin API routes                               |
| `src/api/server.ts`             | Register plugin routes                               |
| `src/index.ts`                  | Create PluginManager, load plugins on startup        |
| `plugins/registry.json`         | NEW: Known plugins list                              |
| `migrations/XXX-plugins.sql`    | NEW: plugins table                                   |
| `ui/src/pages/PluginsPage.tsx`  | NEW: Plugins admin page                              |
| `ui/src/api.ts`                 | Add plugin API functions                             |
| `ui/src/types.ts`               | Add PluginManifest, PluginInfo types                 |
| `docs/plugin-development.md`    | NEW: Developer guide                                 |

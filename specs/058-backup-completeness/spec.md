# 058 — Backup Completeness & Plugin Auto-Download

## Summary

Ensure backup/restore cycle is complete for deployment to a new machine. Two changes:

1. **Plugin auto-download**: At startup, if a plugin exists in the `plugins` DB table but its directory is missing on disk, automatically download it from GitHub using the repo field in the stored manifest.

2. **Data files**: Backup all token files and secrets from `data/` directory dynamically, instead of a hardcoded list that misses new plugins' token files.

## Plugin Auto-Download

### Flow

```
Startup:
  PluginLoader.loadAll()
    → for each enabled integration plugin in DB:
      → if plugins/<id>/dist/index.js missing:
        → log warn "Plugin <id> missing on disk, downloading..."
        → PackageManager.installFromGitHub(manifest.repo)  // already exists
        → loadPlugin(id)
      → else: loadPlugin(id) as usual

  RecipeLoader.loadAll()
    → same logic for recipe packages
```

### Edge cases

- No internet → download fails, plugin stays unloaded, error logged
- Manifest in DB has no repo → skip, warn log
- Plugin already on disk → no download, normal flow

## Data Files

### Current (hardcoded, incomplete)

```typescript
const DATA_FILES = [".jwt-secret", "panasonic-tokens.json", "netatmo-tokens.json"];
```

### After (dynamic scan)

Export: scan `data/` for `*.json` and `.*` files (excluding `sowel.db`, `sowel.pid`, logs).
Restore: extract all files from `data/` directory in the ZIP.

This automatically covers any future plugin token files without code changes.

## Files Changed

| File                           | Change                                               |
| ------------------------------ | ---------------------------------------------------- |
| `src/plugins/plugin-loader.ts` | Auto-download missing plugins before loading         |
| `src/recipes/recipe-loader.ts` | Auto-download missing recipes before loading         |
| `src/api/routes/backup.ts`     | Dynamic data file scanning instead of hardcoded list |

## Acceptance Criteria

- [ ] Missing integration plugins auto-downloaded at startup
- [ ] Missing recipe packages auto-downloaded at startup
- [ ] Backup exports all `data/*.json` + `data/.*` files (not hardcoded)
- [ ] Restore recreates all data files from ZIP
- [ ] TypeScript compiles, all tests pass, lint clean

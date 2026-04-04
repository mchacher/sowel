# 053 — PackageManager Extraction + Plugin Adaptation

## Summary

Refactor the current `PluginManager` into a generic **`PackageManager`** (handles download, install, update, registry) and a domain-specific **`PluginLoader`** (handles integration lifecycle). Add a `type` field to the manifest schema. Bump all 10 existing integration plugins to include `type: "integration"` in their manifest.

This is a **pure refactoring** — zero functional change. Everything works exactly as before. This lays the foundation for spec 054 (recipe packages).

## Motivation

Today `PluginManager` mixes two responsibilities:

1. **Distribution** — download tarballs, install, update, versioning, registry
2. **Domain** — `createPlugin(deps)`, `integrationRegistry.register()`, start/stop lifecycle

Adding recipe support directly to `PluginManager` would create an `if (type === "recipe") ... else ...` mess. By extracting the distribution layer, we get a clean extension point for any future package type.

## Architecture

### Before (current)

```
PluginManager
  ├── download / install / update / registry   (distribution)
  └── createPlugin(deps) / integrationRegistry (domain)
```

### After

```
PackageManager (generic)
  ├── download tarball from GitHub release
  ├── install to plugins/<id>/
  ├── update (compare versions, download new)
  ├── registry.json management
  ├── SQLite `plugins` table + `type` column
  └── expose installed packages to consumers

PluginLoader (integration-specific)
  ├── import() + createPlugin(deps)
  ├── integrationRegistry.register()
  └── integration lifecycle (start/stop)
```

### Decisions

- **API routes**: keep `/api/v1/plugins/*` (no rename)
- **SQLite table**: keep `plugins` table, add `type` column (no rename)
- **Backward compat**: manifests without `type` default to `"integration"`

### Manifest Evolution

```jsonc
// Before
{
  "id": "zigbee2mqtt",
  "name": "Zigbee2MQTT",
  "version": "1.0.2"
  // no type field
}

// After
{
  "id": "zigbee2mqtt",
  "name": "Zigbee2MQTT",
  "version": "1.0.2",
  "type": "integration"    // NEW
}
```

### Registry Evolution

```jsonc
// registry.json — each entry gets "type"
{
  "id": "zigbee2mqtt",
  "type": "integration",
  // ... rest unchanged
}
```

## Plugin Version Bumps

All 10 integration plugins get a minor version bump to add `type: "integration"` to their manifest:

| Plugin           | Current | New   |
| ---------------- | ------- | ----- |
| zigbee2mqtt      | 1.0.1   | 1.1.0 |
| lora2mqtt        | 1.0.0   | 1.1.0 |
| panasonic_cc     | 1.0.0   | 1.1.0 |
| mcz_maestro      | 1.0.0   | 1.1.0 |
| legrand_energy   | 1.0.0   | 1.1.0 |
| legrand_control  | 1.0.0   | 1.1.0 |
| netatmo_weather  | 1.0.1   | 1.1.0 |
| netatmo-security | 0.4.0   | 0.5.0 |
| weather-forecast | 0.4.1   | 0.5.0 |
| smartthings      | 0.7.0   | 0.8.0 |

## Acceptance Criteria

- [ ] `PackageManager` class extracted with all distribution logic
- [ ] `PluginLoader` class handles integration-specific loading
- [ ] `PluginManifest` type includes `type: "integration" | "recipe"` field
- [ ] SQLite migration adds `type` column to `plugins` table (default `"integration"`)
- [ ] `registry.json` updated with `type` field for all entries
- [ ] All 10 plugin repos: manifest updated with `type: "integration"`, version bumped
- [ ] All 10 plugins: GitHub release created with pre-built tarball
- [ ] API routes unchanged (`/api/v1/plugins/*`)
- [ ] Existing installed plugins continue to work after upgrade (backward compat)
- [ ] TypeScript compiles, all tests pass, lint clean

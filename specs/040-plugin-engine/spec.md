# Plugin Engine

## Summary

Dynamic plugin engine enabling third-party integrations to be installed, enabled/disabled, and removed at runtime without restarting Sowel. Includes a store UI to discover and install plugins from GitHub repositories.

## Acceptance Criteria

- [ ] PluginDeps interface defines the contract between core and plugins
- [ ] PluginManager loads plugins from `plugins/*/manifest.json` on startup
- [ ] Plugins can be installed from GitHub releases via API
- [ ] Plugins can be enabled/disabled/removed without restart (hot-reload)
- [ ] Plugin store UI shows available plugins from registry
- [ ] Installed plugins UI shows status with enable/disable/remove actions
- [ ] Developer documentation explains how to create a plugin
- [ ] Embryo plugin (netatmo-security) validates the engine end-to-end

## Scope

### In Scope

- PluginManager with hot-load/unload
- Plugin manifest.json format
- PluginDeps interface (Logger, EventBus, SettingsManager, DeviceManager, MqttConnector factory)
- API routes for plugin CRUD
- UI page with installed + store tabs
- Registry JSON with known plugins
- Developer documentation
- Embryo plugin for validation

### Out of Scope

- Migrating existing built-in integrations to plugin format
- Plugin auto-updates
- Plugin sandboxing/security
- Plugin marketplace (external hosted registry)

## Edge Cases

- Plugin with missing manifest.json → skip with warning
- Plugin with incompatible sowelVersion → show warning in UI
- Install fails (network, invalid tarball) → cleanup partial download, show error
- Plugin crashes on start → catch error, set status to "error", don't affect other plugins
- Two plugins with same ID → reject second install

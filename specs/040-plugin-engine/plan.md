# Implementation Plan: Plugin Engine

## Tasks

### Backend

1. [ ] Add PluginManifest, PluginInfo, PluginDeps types to types.ts
2. [ ] Create src/shared/plugin-api.ts with PluginDeps and PluginFactory
3. [ ] Create migration for plugins table
4. [ ] Implement PluginManager (load, start, stop, install, uninstall, enable, disable)
5. [ ] Create API routes for plugins
6. [ ] Register routes in server.ts
7. [ ] Create PluginManager in index.ts, load plugins on startup
8. [ ] Create plugins/registry.json with netatmo-security entry

### Frontend

9. [ ] Add plugin types to ui/src/types.ts
10. [ ] Add plugin API functions to ui/src/api.ts
11. [ ] Create PluginsPage with installed + store tabs
12. [ ] Add Plugins link to sidebar navigation

### Documentation

13. [ ] Create docs/plugin-development.md

### Validation

14. [ ] TypeScript compiles (zero errors)
15. [ ] All tests pass
16. [ ] Manual verification with netatmo-security embryo plugin

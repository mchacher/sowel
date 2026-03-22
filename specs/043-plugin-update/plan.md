# Implementation Plan: Plugin Update

## Tasks

1. [ ] Extract `downloadRelease(repo)` private method from `installFromGitHub` in plugin-manager.ts
2. [ ] Add `update(pluginId)` method to PluginManager
3. [ ] Add `getLatestVersions()` to compare installed vs registry versions
4. [ ] Enrich `getInstalled()` to include `latestVersion` per plugin
5. [ ] Add `POST /api/v1/plugins/:id/update` route
6. [ ] Add `updatePlugin()` to UI api.ts
7. [ ] Add `latestVersion` to PluginInfo type in UI types.ts
8. [ ] Add update badge + button on PluginRow component
9. [ ] Add banner notification in header for admins
10. [ ] Add i18n keys (en + fr)
11. [ ] Type-check backend + frontend
12. [ ] Create PR

## Testing

- Install weather-forecast plugin v0.1.0
- Set registry.json to v0.2.0
- Verify badge shows "Update available"
- Click Update → verify files replaced, version updated, plugin restarts
- Verify settings, devices, equipments unchanged

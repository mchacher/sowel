# Plugin Update

## Summary

Add the ability to update installed plugins to their latest version without losing configuration (settings, devices, equipments, bindings). Display a notification in the top banner and on the plugin card when an update is available.

## Acceptance Criteria

- [ ] `update(pluginId)` method in PluginManager: stops plugin, replaces files, updates version in DB, restarts plugin
- [ ] Settings, devices, and equipment bindings are preserved after update
- [ ] API endpoint `POST /api/v1/plugins/:id/update`
- [ ] Plugin card shows "Update available" badge when installed version < registry version
- [ ] Update button on plugin card triggers the update
- [ ] Top banner shows "X plugin update(s) available" for admin users only
- [ ] Banner links to Plugins page

## Scope

### In Scope

- Backend update method (download new release, replace files, keep DB row)
- API endpoint
- UI: update badge + button on installed plugin card
- UI: banner notification for admins

### Out of Scope

- Automatic updates (always manual)
- Rollback to previous version
- Changelog display

## Edge Cases

- Plugin has no `repo` in manifest → update not available, no badge shown
- Download fails mid-update → plugin files may be corrupted, log error
- Plugin was disabled before update → stays disabled after update (don't auto-start)
- Registry not available / no registry.json → no update badges shown

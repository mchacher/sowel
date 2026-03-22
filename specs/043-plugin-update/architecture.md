# Architecture: Plugin Update

## Data Model Changes

None. The `plugins` table already has `version` and `manifest` columns, and the `updateManifest` prepared statement exists.

## API Changes

### New endpoint

| Method | Path                         | Auth  | Description                            |
| ------ | ---------------------------- | ----- | -------------------------------------- |
| POST   | `/api/v1/plugins/:id/update` | admin | Update plugin to latest GitHub release |

**Response:** `{ success: true, manifest: PluginManifest }`

### Changed endpoint

| Method | Path              | Change                                       |
| ------ | ----------------- | -------------------------------------------- |
| GET    | `/api/v1/plugins` | Add `latestVersion` field to each PluginInfo |

## UI Changes

### PluginRow (installed tab)

- Compare `plugin.manifest.version` vs `plugin.latestVersion`
- If update available: show version badge "⬆ vX.Y.Z" + "Update" button
- Button triggers `POST /api/v1/plugins/:id/update`, then refreshes

### Banner (header)

- Count plugins with available updates
- If count > 0 and user is admin: show "N plugin update(s) available" in top banner
- Clickable → navigates to Plugins page

## File Changes

| File                                                | Change                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/plugins/plugin-manager.ts`                     | Add `update()` method, extract `downloadRelease()` from `installFromGitHub`, add `getLatestVersions()` |
| `src/api/routes/plugins.ts`                         | Add `POST /api/v1/plugins/:id/update` endpoint                                                         |
| `ui/src/api.ts`                                     | Add `updatePlugin()` function                                                                          |
| `ui/src/types.ts`                                   | Add `latestVersion?: string` to `PluginInfo`                                                           |
| `ui/src/pages/PluginsPage.tsx`                      | Update badge + button on PluginRow                                                                     |
| `ui/src/components/layout/Header.tsx` or equivalent | Banner notification for admins                                                                         |
| `ui/src/i18n/locales/en.json`                       | i18n keys for update UI                                                                                |
| `ui/src/i18n/locales/fr.json`                       | i18n keys for update UI                                                                                |

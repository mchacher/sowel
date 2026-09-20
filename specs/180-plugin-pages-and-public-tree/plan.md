# Spec 180 — Implementation plan

## Steps (in dependency order)

1. ✅ **Contract** — `PluginUiDef`, `PluginPageInfo`, the request/response pair
   and `ui` / `publicTree` on `PluginManifest` (`src/shared/types.ts`, mirrored
   in `ui/src/types.ts`); `dataDir` on `PluginDeps` and the two optional
   handlers on `IntegrationPlugin` (`src/shared/plugin-api.ts`);
   `publicTreeSettingKey()` (`src/shared/constants.ts`).
2. ✅ **Data directory** — `getDataDir` / `ensureDataDir` in
   `package-manager.ts`, created before the factory runs by
   `integration-registry.ts`, untouched by install, update and uninstall.
3. ✅ **Backup** — `scanPluginDataFiles` in `backup-manager.ts`, same extension
   whitelist as the rest of `data/`.
4. ✅ **Page listing** — `PluginLoader.getPages()` off the installed manifests,
   `entryUrl` carrying the version.
5. ✅ **Scoped deps** — the two handlers wrapped with the spec 111 degradation;
   the plugin's own `plugins.<id>.public_enabled` made readable, not writable.
6. ✅ **Routes** — `plugin-surface.ts`: the page API, the asset tree and the
   anonymous tree, with the header allowlists, the timeouts, the rate limit and
   the `X-Robots-Tag`; registered from `server.ts`.
7. ✅ **Admin switch** — `PUT /api/v1/plugins/:id/public`, audit-logged and
   warn-logged.
8. ✅ **UI** — `PluginPage.tsx` + `pluginModuleLoader.ts`, the route in
   `App.tsx`, `usePluginPages` and the sidebar entries, the public-tree block in
   `PluginDetailSheet`, i18n en/fr.
9. ✅ **Tests** — see the test plan below.
10. ✅ **Docs** — `docs/technical/plugin-development.md` (+ `.fr`) for the three
    capabilities, `docs/technical/api-reference.md` (+ `.fr`) for the routes,
    and the row in both spec indexes.

## Test plan

### Modules to test

- `api/routes/plugin-surface` (who may call, what gets through, what comes back)
- `plugins/plugin-loader` (the page listing)
- `packages/package-manager` (`getDataDir`)
- `backup/backup-manager` (the archive)
- `plugins/scoped-deps` (the one readable core key)
- `ui/pages/PluginPage` (mount, context, and the three failure screens)

### Scenarios per module

| Module          | Scenario                                                                    | Expected                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| plugin-surface  | `GET /api/v1/plugins/pages` and `/plugins/<id>/page/*` as a `standard` user | 403 before the plugin is reached                                                                                                           |
| plugin-surface  | Page call as an admin                                                       | The plugin is handed `user: { id, username, role }`, never the bearer                                                                      |
| plugin-surface  | Request carrying a header outside the allowlist                             | Not forwarded                                                                                                                              |
| plugin-surface  | Plugin answers `set-cookie`                                                 | Dropped, warn log naming the header                                                                                                        |
| plugin-surface  | Plugin answers a header inside `PLUGIN_RESPONSE_HEADERS`                    | Sent through                                                                                                                               |
| plugin-surface  | Plugin never returns                                                        | 504 (15 s page / 30 s public)                                                                                                              |
| plugin-surface  | Plugin throws                                                               | 500, nothing of the plugin echoed back                                                                                                     |
| plugin-surface  | `/p/<id>/*` on a plugin that does not declare `publicTree`                  | 404                                                                                                                                        |
| plugin-surface  | `/p/<id>/*` declared but `public_enabled` unset                             | The **same** 404 — the setting cannot be probed                                                                                            |
| plugin-surface  | `/p/<id>/*` declared and enabled                                            | Served, with `X-Robots-Tag: noindex, nofollow`                                                                                             |
| plugin-surface  | Public call carrying `authorization`                                        | Passed through (it is the plugin's own token, not Sowel's)                                                                                 |
| plugin-surface  | 61st public call in a minute from one IP                                    | 429                                                                                                                                        |
| plugin-surface  | Asset path containing `..`                                                  | 404                                                                                                                                        |
| plugin-surface  | Asset with an extension outside the allowlist                               | 404                                                                                                                                        |
| plugin-surface  | Asset of a disabled plugin, or of one declaring no page                     | 404                                                                                                                                        |
| plugin-loader   | Two installed plugins, one declaring `ui`                                   | One page listed, `entryUrl` carrying the version                                                                                           |
| plugin-loader   | Plugin whose integration failed to start                                    | Its page is still listed                                                                                                                   |
| plugin-loader   | `i18n.<lang>.ui` present                                                    | Overrides `label`                                                                                                                          |
| package-manager | `getDataDir("guest-access")`                                                | `data/plugins/guest-access`, never the package directory                                                                                   |
| package-manager | Traversing id                                                               | Refused                                                                                                                                    |
| package-manager | `updateFiles` on a plugin holding data                                      | The data directory survives                                                                                                                |
| backup-manager  | `data/plugins/<id>/store.json`                                              | Inside the archive, restored in place                                                                                                      |
| backup-manager  | `data/plugins/<id>/run.sh`                                                  | Excluded, like everywhere else in `data/`                                                                                                  |
| scoped-deps     | Plugin reads its own `plugins.<id>.public_enabled`                          | Allowed                                                                                                                                    |
| scoped-deps     | Plugin reads another plugin's, or writes its own                            | Refused                                                                                                                                    |
| PluginPage      | Module exporting `mount`                                                    | Imported from `entryUrl`, mounted in the container; `api()` bound to `/api/v1/plugins/<id>/page/*`, a path without a leading slash refused |
| PluginPage      | No installed plugin offers that page                                        | Says so, does not import anything                                                                                                          |
| PluginPage      | Module without `mount()`, or that fails to load                             | Says so and names the reason; SPA stays navigable                                                                                          |
| PluginPage      | Leaving the route                                                           | `unmount(container)` called, container emptied                                                                                             |

### Counts

24 route cases (`src/api/routes/plugin-surface.test.ts`), 7 on the page listing
(`src/plugins/plugin-pages.test.ts`), 3 on `getDataDir`
(`src/packages/package-manager.test.ts`), 3 on the settings proxy
(`src/plugins/scoped-deps.test.ts`), 2 on the backup
(`src/backup/backup-manager.test.ts`), 6 on the SPA page
(`ui/src/pages/PluginPage.test.tsx`).

### Retro-compat

Every field is optional, every route is new, `PluginDeps` only grows. A plugin
built before this spec loads and runs unchanged — covered by the existing
`plugin-loader` and `scoped-deps` suites, which are untouched apart from the two
new cases.

## Gate 4 checks

- `npx tsc --noEmit`, `npx tsc -p tsconfig.test.json`, `cd ui && npx tsc -b --noEmit`
- `npx vitest run` and `cd ui && npx vitest run`
- `npx eslint src/`, `npx prettier --check`
- `bash scripts/check-specs-complete.sh && bash scripts/check-docs-parity.sh && bash scripts/check-docs-impact.sh && bash scripts/check-specs-index.sh folders`

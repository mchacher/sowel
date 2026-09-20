# Spec 180 — Architecture

Everything here is plumbing on purpose. The core decides **who** may call and
**how much** they may say; what the call means is the plugin's business, and the
core never parses it.

## Contract (`src/shared/`)

**`types.ts`** — `PluginManifest` gains two optional fields:

```ts
/** Spec 180 — the plugin brings its own page into the Sowel UI. */
ui?: PluginUiDef;          // { entry, label, icon? }
/** Spec 180 — the plugin serves anonymous callers under `/p/<id>/*`. */
publicTree?: boolean;
```

plus `PluginPageInfo` (`{ pluginId, label, icon, entryUrl }`), the shape the
sidebar reads, and the request/response pair a plugin answers with
(`{ status, body, contentType, headers }`). Mirrored in `ui/src/types.ts`.

**`plugin-api.ts`** — `PluginDeps` gains `dataDir: string`, and
`IntegrationPlugin` gains two optional handlers, `handlePageRequest` and
`handlePublicRequest`. Both optional: a plugin that implements neither is
unaffected, which is why the migration section of the spec is empty.

**`constants.ts`** — `publicTreeSettingKey(pluginId)` → `plugins.<id>.public_enabled`.
Core-owned, deliberately outside `integration.<id>.*`: that namespace belongs to
the plugin, and a door a plugin can open for itself is not a door anyone guards.

## Backend

### `src/api/routes/plugin-surface.ts` (new)

Three route trees, registered from `src/api/server.ts`:

| Route                        | Auth  | Timeout | Notes                                                |
| ---------------------------- | ----- | ------- | ---------------------------------------------------- |
| `/api/v1/plugins/:id/page/*` | admin | 15 s    | `user: { id, username, role }` named to the plugin   |
| `/plugin-ui/:id/*`           | none  | —       | static assets from the entry's own directory         |
| `/p/:id/*`                   | none  | 30 s    | 60 req/min per IP, `X-Robots-Tag: noindex, nofollow` |

- **Request headers are an allowlist**, not a pass-through: `accept`,
  `accept-language`, `content-type`, `user-agent`, plus `authorization` on the
  public surface only. On the page API the bearer belongs to the core and never
  reaches the plugin (R1.5 / R4.14).
- **Response headers are an allowlist** too (`PLUGIN_RESPONSE_HEADERS`).
  Anything else is dropped with a warn log naming the header — `set-cookie`
  deliberately included, so a plugin can never write on Sowel's origin.
- **The query map is built with `Object.fromEntries`, and drops `__proto__`,
  `constructor` and `prototype`.** Its keys are whatever the caller typed after
  the `?`, and the plugin reads them by name: `fromEntries` defines each one as
  an own data property rather than going through a setter, so no caller-chosen
  name reaches the object's own shape on the way in.
- `withTimeout` turns a plugin that never answers into a 504; a plugin that
  throws is already degraded to `undefined` by spec 111, and the route answers
  500 without echoing anything back.
- The asset tree resolves inside the entry's directory and serves by extension
  allowlist (`ASSET_CONTENT_TYPES`). A path that leaves it, an extension outside
  the list, a disabled plugin and a plugin declaring no page are all the same 404.
- `/p/:id/*` answers that same 404 while the manifest does not declare
  `publicTree`, **and** while `plugins.<id>.public_enabled` is not set — so the
  setting cannot be probed from outside.

### `src/plugins/plugin-loader.ts`

`getPages(): PluginPageInfo[]` reads the **installed manifests**, not the loaded
plugins: a plugin whose integration failed to start still has its page, and a
sidebar entry that vanishes when a broker is down would be worse than useless.
`entryUrl` is composed by the exported `pluginAssetUrl()`, which the route test
uses too: it names the file **inside the entry's directory**, because that
directory is what the asset route serves as its root. It carries the installed
version (`?v=1.2.0`) because ESM caches a
module by URL for the life of the document — without it, an admin who updates a
plugin and returns to its page runs the previous release's panel against the new
API. `i18n.<lang>.ui` overrides `label` when present.

### `src/plugins/scoped-deps.ts`

- Wraps the two new handlers with the existing `wrapAsync` degradation, so an
  exception becomes a missing answer the route turns into a 500 — never a stack
  reaching an anonymous caller, never a double log.
- The settings proxy gains exactly one core-owned readable key: the plugin's
  **own** `plugins.<id>.public_enabled` (R2.8.bis). A plugin that cannot tell
  whether its door is open cannot say so on its own page. Writing it stays
  refused like any other foreign key, which is the whole reason it does not live
  in the plugin's namespace.

### `src/packages/package-manager.ts`

`getDataDir(packageId)` / `ensureDataDir(packageId)` → `data/plugins/<id>/`,
resolved under the writable data root and refusing a traversing id. Created
before the factory runs (`integration-registry.ts` passes it as `deps.dataDir`),
and `install`, `updateFiles` and `uninstall` never touch it — an uninstall
leaves it, because a plugin removed by mistake and reinstalled the same
afternoon must not have dropped what it held.

### `src/backup/backup-manager.ts`

`scanPluginDataFiles` walks `data/plugins/` to `PLUGIN_DATA_MAX_DEPTH = 4` under
the same extension whitelist as the rest of `data/` (`.sh` excluded), so the
directory rides inside the archive and the restore puts it back where it was.

## UI

- **`pages/PluginPage.tsx`** (route `/plugins/:pluginId/page`, admin-only) —
  imports the declared module and calls `mount(container, ctx)`, then
  `unmount(container)` and `replaceChildren()` on the way out. `ctx` is
  `{ pluginId, api, locale, theme, navigate }`; `api()` is the SPA's own
  authenticated client pointed at `/api/v1/plugins/<id>/page/*`, so the plugin
  never sees a token and never has to think about the refresh dance. Three
  failure screens — unknown page, module without `mount()`, module that would
  not load — each naming the reason and leaving the SPA navigable.
- **`pages/pluginModuleLoader.ts`** — the one place the SPA imports code it did
  not build, extracted as a seam so the page's behaviour can be tested without a
  real plugin on disk.
- **`components/layout/usePluginPages.ts` + `Sidebar.tsx`** — the pages appear
  in the Administration menu with their Lucide icon (`Puzzle` as fallback).
  `refreshPluginPages()` is called after an install, update, uninstall, enable or
  disable. A sidebar that cannot list the pages shows none, which is what it
  showed before any plugin brought one.
- **`components/plugins/PluginDetailSheet.tsx`** — the anonymous door gets its
  own block, above the ordinary actions, with the sentence that is the point of
  showing it there: "This plugin serves pages to anonymous visitors under
  `/p/<id>/`. Turn it on only if you mean to."

## Why plain DOM and not React

A plugin is built in its own repository against its own dependencies. Two Reacts
in one page is a class of bug nobody should have to debug, and pinning a plugin
to the SPA's React version would make every core upgrade a plugin release. The
contract is a DOM node and a context object — something both sides can keep
across versions.

## Security posture

Nothing here widens spec 111: a plugin already runs in-process. What the two
surfaces add is reachability, and both are opt-in twice — declared in the
manifest, then turned on by an admin (audit-logged as
`plugin.public.enable` / `.disable`, and warn-logged) — so nothing new is
reachable by accident. No plugin route lives under `/api/`, so no plugin can
shadow or precede a core route.

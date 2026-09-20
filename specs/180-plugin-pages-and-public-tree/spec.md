# Spec 180 — Plugin pages, an anonymous tree, and somewhere to keep state

## Context

Since spec 053 everything is a plugin, and a plugin is handed four things:
`logger`, `eventBus`, `settingsManager`, `deviceManager`. That is exactly right
for what plugins were built for — turning a protocol into devices — and it is
the whole surface. Three consequences show up the moment a plugin owns
something the device model does not describe:

1. **A plugin cannot show anything.** Its entire UI is the settings form the
   manifest declares (`text`, `password`, `number`, `boolean`) plus whatever its
   devices happen to look like on an equipment page. A plugin holding a list of
   records the owner edits — grants, schedules, licences, guests — has nowhere
   to put them, and the owner ends up administering them in another application
   on another machine.
2. **A plugin cannot be reached by anyone but an admin.** Every route under
   `/api/` is authenticated by default (spec 105 S6), which is right, and there
   is no other tree. A plugin whose job involves someone who is not a Sowel user
   — a visitor, a delivery, a guest at a gate — has no way to serve them.
3. **A plugin has nowhere to keep state.** `pluginDir` looks like the place, and
   it is a trap: `PackageManager.updateFiles` removes that directory and unpacks
   the new release in its place, so anything written beside the code disappears
   at the next version, silently, on the day the plugin is improved.

Each of the three has been worked around in the field by moving the feature out
of Sowel — to a second service on another host, with its own database, its own
reverse proxy entry and its own backup. The engine then holds the equipment and
another machine holds the reason it exists.

## Goals

1. A plugin may bring **one page** into the Sowel UI, rendered inside the app,
   under the Administration menu, admin-only, with its own API behind it.
2. A plugin may serve **anonymous callers** under `/p/<id>/*` — opt-in in the
   manifest, off until an admin turns it on, rate-limited, and never able to set
   a cookie on Sowel's origin.
3. A plugin has a **data directory** that survives updates and is inside the
   backup.
4. Nothing above is specific to any plugin. The core learns no domain.

## Non-goals

- Rendering plugin UI from React components. A plugin is built in its own
  repository against its own dependencies; two Reacts in one page is a class of
  bug nobody should debug. The contract is a DOM node and a context object.
- More than one page per plugin. One entry in a menu is what a plugin earns;
  a plugin that wants tabs draws them inside its own page.
- Letting a plugin add routes under `/api/`. Everything it serves is under its
  own prefix, so no plugin can shadow or precede a core route.
- Hard isolation. A plugin already runs in-process (spec 111 says so plainly);
  these surfaces do not widen that, and the manifest opt-in plus the admin
  switch exist so that nothing new is reachable by accident.

## Functional rules

### R1 — The page

1. A manifest may declare `ui: { entry, label, icon? }`. `entry` is a path
   inside the package, relative, to an **ES module**.
2. The core lists the declared pages at `GET /api/v1/plugins/pages`, admin-only,
   reading the **manifest** and not the loaded plugin: a plugin whose
   integration failed to start still has its page, and a sidebar entry that
   disappears when a broker is down would be worse than useless.
3. The module's URL carries the installed **version** (`?v=1.2.0`). ESM caches a
   module by URL for the life of the document, so without it an admin who
   updates a plugin and returns to its page runs the previous release's panel
   against the new API.
4. The SPA imports the module at `/plugins/<id>/page` and calls
   `mount(container, ctx)`, then `unmount(container)` when leaving. `ctx` gives
   the plugin `api()` — the SPA's own authenticated client, pointed at that
   plugin's tree — plus `locale`, `theme` and `navigate`.
5. **The plugin never sees a token.** `api()` is the only way out, and the core
   strips `authorization` from what it hands the plugin (R4).
6. Assets under `/plugin-ui/<id>/*` are served from the entry's own directory,
   by extension allowlist, unauthenticated: they are the plugin's own published
   JavaScript, and what they display sits behind the admin API. A path that
   leaves that directory is a 404, and so is every request for a plugin that is
   disabled or declares no page.

### R2 — The anonymous tree

7. A manifest may declare `publicTree: true`. Declaring it makes the door
   buildable and nothing else: until an admin flips
   `plugins.<id>.public_enabled`, every call under `/p/<id>/*` answers 404 —
   the same 404 an undeclared plugin gets, so the setting cannot be probed.
8. The switch is a core setting, outside `integration.<id>.*`, because that
   namespace belongs to the plugin and a door a plugin can open for itself is
   not a door anyone guards. Flipping it is audit-logged
   (`plugin.public.enable` / `.disable`) and warn-logged.
8.bis The plugin may **read** its own flag through the scoped settings proxy —
   and only its own — so its page can say the door is shut instead of leaving
   the owner to work out why one they declared answers 404. Writing it is
   refused like any other foreign key.
9. `/p/<id>/*` is rate-limited to 60 requests per minute per IP (the global
   limit is 300) and answers `X-Robots-Tag: noindex, nofollow` whatever the
   plugin says.
10. A public response may not set a cookie (R5). A plugin that must recognise a
    returning caller hands out a token and reads it back from `authorization`,
    which is the one header the public surface passes through.

### R3 — The data directory

11. `deps.dataDir` is `data/plugins/<id>/`, created before the factory runs.
12. Install, update and uninstall never touch it. An uninstall leaves it: a
    plugin removed by mistake and reinstalled the same afternoon must not have
    dropped what it held.
13. It rides inside the backup, under the same extension whitelist as the rest
    of `data/`, and the restore puts it back where it was.

### R4 — What a plugin is handed

14. Request headers are an allowlist, not a pass-through: `accept`,
    `accept-language`, `content-type`, `user-agent`, plus `authorization` on the
    **public** surface only. On the page API the bearer belongs to the core.
15. The page API names the caller (`user: { id, username, role }`) so a plugin
    can journal who acted. The public surface names nobody.
16. A plugin gets 15 s to answer a page call and 30 s to answer a public one
    (a public call may legitimately wait on an equipment); past that the core
    answers 504. A plugin that throws is degraded to `undefined` by spec 111 and
    the core answers 500 without echoing anything back.

### R5 — What a plugin may answer

17. `{ status, body, contentType, headers }`. `body` is sent as JSON unless it
    is a string or a Buffer. Response headers are an allowlist
    (`PLUGIN_RESPONSE_HEADERS`); anything else is dropped with a warn log naming
    the header, `set-cookie` deliberately included.

## Acceptance criteria

- [x] A plugin declaring `ui` appears in the Administration menu with its icon
      and label, and its page renders inside the app in both themes.
- [x] `GET /api/v1/plugins/pages` and `/api/v1/plugins/<id>/page/*` answer 403
      to a `standard` user, before the plugin is reached.
- [x] The asset tree refuses `..`, refuses an extension outside the allowlist,
      and refuses a disabled plugin.
- [x] `/p/<id>/*` answers 404 when undeclared, 404 when declared and not
      enabled, and serves once both are true.
- [x] The caller's bearer token never reaches the plugin; the public surface's
      `authorization` does.
- [x] A plugin that never returns yields 504; one that throws yields 500.
- [x] `set-cookie` from a plugin is dropped.
- [x] `getDataDir` refuses a traversing id and is never the package directory.
- [x] `data/plugins/<id>/…` is archived and restored, `.sh` excluded.

## Tests

| File                                    | Covers                                             |
| --------------------------------------- | -------------------------------------------------- |
| `src/api/routes/plugin-surface.test.ts` | R1.2, R1.6, R2.7–R2.10, R4, R5 (23 cases)          |
| `src/plugins/plugin-pages.test.ts`      | R1.1–R1.3 (7 cases)                                |
| `src/packages/package-manager.test.ts`  | R3.11 (3 cases in `getDataDir`)                    |
| `src/backup/backup-manager.test.ts`     | R3.13 (2 cases)                                    |
| `ui/src/pages/PluginPage.test.tsx`      | R1.4, R1.5 and the three failure screens (6 cases) |

## Migration and compatibility

None. Every field is optional, every route is new, `PluginDeps` only grows.
A plugin built before this spec loads and runs unchanged; a plugin built against
this spec on an older Sowel simply never has its page requested, which is what
`sowelVersion` in its manifest is for.

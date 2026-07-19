# Spec 131 — RBAC: config is admin-only, standard = view + actuate

## Context

GitHub issue #319 (Romain / alpitux). Sowel has two roles, `admin` and `standard`
(`UserRole` in `src/shared/types.ts`). Today only three areas are role-gated
(`requireAdmin`): user management, audit log, and plugin install. **Everything
else is open to a `standard` user** — including create / rename / delete of
equipments, zones, recipes, modes, devices, dashboard, charts, and every
settings/integration mutation. A `standard` account meant for consultative use
(view the dashboard, see zone states, open a gate/door) can therefore, on purpose
or by accident, break the whole configuration.

Chosen direction (Option A, confirmed with the maintainer): **restrict `standard`
to usage; make all configuration admin-only.** No new role is added.

## Goal

A `standard` user can:
- **View** everything (all read endpoints).
- **Actuate** equipments (execute orders) and run **zone commands** (all-lights-off, etc.).
- Manage **their own account**: display name, preferences (theme/language), password,
  their own API tokens, and their own push-notification subscription.

A `standard` user cannot perform **any configuration mutation**. All create /
update / delete / activate on shared infrastructure is **admin-only**: equipments,
zones, recipes (incl. enable/disable/actions), modes (incl. activate/deactivate),
dashboard widgets, charts, devices, settings, integrations, MQTT brokers/publishers,
notification publishers, calendar, energy tariff, logs level, backup, system
update/restart, plugins, users, audit.

## Design in one line

**Fail-closed default-deny**: after authentication, any mutating request
(`POST/PUT/PATCH/DELETE`) from a non-admin is rejected with `403` unless its
`(method, path)` matches an explicit **standard write allowlist**. Reads (`GET`)
are never gated. This is centralised (one hook + one pure predicate) so a future
new mutating endpoint is admin-only by default — no per-route opt-in to forget.

## Standard write allowlist (the ONLY mutations a standard may do)

| Method | Path (template) | Why |
| --- | --- | --- |
| POST | `/api/v1/equipments/:id/orders/:alias` | Actuate an equipment (open gate, toggle light) |
| POST | `/api/v1/zones/:id/orders/:orderKey` | Zone command (all-lights-off, all-shutters-close) |
| PUT | `/api/v1/me` | Own display name |
| PUT | `/api/v1/me/preferences` | Own theme / language |
| PUT | `/api/v1/me/password` | Own password |
| POST | `/api/v1/me/tokens` | Own API token (inherits standard role, no escalation) |
| DELETE | `/api/v1/me/tokens/:id` | Revoke own API token |
| POST | `/api/v1/push/subscriptions` | Register own device for push |
| DELETE | `/api/v1/push/subscriptions` | Unregister own device |
| POST | `/api/v1/auth/logout` | End own session |

Everything else that mutates → **admin only**.

## UI

For a `standard` user, configuration actions are **hidden** (not shown-but-blocked):
add / edit / delete buttons for equipments, recipes, zones, modes (incl. the
mode activation toggles), dashboard widgets, charts, devices, and the whole
Administration section (already hidden). Kept visible: the dashboard, zone views,
equipment/zone **controls** (actuation), and the personal account/preferences pages.

The backend `403` is the source of truth; the UI hiding is UX so a standard user
never sees a button that would fail.

## Acceptance criteria

- [x] AC1 — A `standard` user gets `403` on every mutation not in the allowlist
      (verified per domain: equipments create/delete, recipe create/enable, mode
      activate, zone create, dashboard widget add, settings, devices, etc.).
- [x] AC2 — A `standard` user succeeds on every allowlisted usage mutation
      (execute equipment order, zone command, own account/preferences/password,
      own tokens, own push subscription, logout).
- [x] AC3 — An `admin` user is unaffected: all mutations succeed as before.
- [x] AC4 — All `GET` endpoints remain available to `standard` (no read is gated).
- [x] AC5 — The allowlist matching is exact: `/equipments/:id/orders/:alias` is
      allowed but `/equipments/:id` (PUT/DELETE) and `/equipments/:id/order-bindings`
      are denied for standard.
- [x] AC6 — API tokens carry the creator's role; a standard-scoped token is subject
      to the exact same default-deny (no privilege escalation via token).
- [x] AC7 — In the UI, a standard user sees no configuration buttons (equipment /
      recipe / zone / mode / dashboard / chart edit), but can view and actuate.
- [x] AC8 — First-run setup (no users yet) and login/refresh remain reachable.

## Scope

### In scope
- Central role-enforcement hook + pure `isStandardWriteAllowed(method, path)` predicate.
- Remove the now-redundant per-route `requireAdmin` calls OR keep them (defense in
  depth) — decided in architecture.md.
- UI: gate configuration actions behind `role === "admin"`.
- Docs: note the role model in `docs/technical/api-reference.md`.

### Out of scope
- A third role (read-only "viewer" that cannot actuate) — noted as a possible
  future addition; not needed for #319.
- Per-zone / per-equipment ACLs.
- Changing how roles are assigned (admin already sets a user's role at creation).

### Future (noted by the maintainer) — per-user dashboards
Today the dashboard and saved charts are **shared/global** (no `user_id` on
`dashboard_widgets` / `chart_configs`), which is exactly why editing them is
**admin-only** in this spec. A later phase may introduce **per-user dashboards**
(each user, including `standard`, owns and arranges their own dashboard). When
that lands, the owner's dashboard/chart mutations move to the standard allowlist,
scoped to `ownerId === request.auth.userId`. The central hook makes this a
one-line allowlist change; no other RBAC rework needed. Tracked separately.

## Edge cases

| Case | Expected |
| --- | --- |
| Standard executes an equipment order | Allowed (200) |
| Standard runs a zone command | Allowed |
| Standard renames/deletes an equipment | 403 |
| Standard activates a mode | 403 (modes = admin) |
| Standard enables/disables a recipe | 403 (recipes = admin) |
| Standard edits the shared dashboard / creates a chart | 403 |
| Standard changes own password / preferences | Allowed |
| Standard creates/revokes own API token | Allowed |
| Standard-scoped API token tries a config mutation | 403 (role from token = standard) |
| Admin does any of the above | Allowed |
| Any user does a GET | Allowed |
| No users yet (setup) | `/auth/setup` reachable, others 403 setupRequired (unchanged) |

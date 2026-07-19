# Architecture — Spec 131

No data model change, no new event, no new endpoint. This adds a **role gate**
on existing mutating endpoints (backend) and hides config actions (frontend).

## 1. Backend — central fail-closed role gate

### Where
Extend the existing auth `onRequest` hook in
`src/auth/auth-middleware.ts` (`registerAuthMiddleware`). It already resolves the
token and sets `request.auth = { userId, role }`. Right after that, add the role
gate for mutations.

### Predicate (pure, exported, unit-tested)
```ts
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Route (method, path) templates a `standard` user is allowed to mutate.
 *  Everything else that mutates is admin-only (fail-closed). */
const STANDARD_WRITE_ALLOWLIST: ReadonlyArray<{ method: string; re: RegExp }> = [
  { method: "POST",   re: /^\/api\/v1\/equipments\/[^/]+\/orders\/[^/]+$/ }, // actuate
  { method: "POST",   re: /^\/api\/v1\/zones\/[^/]+\/orders\/[^/]+$/ },      // zone command
  { method: "PUT",    re: /^\/api\/v1\/me$/ },
  { method: "PUT",    re: /^\/api\/v1\/me\/preferences$/ },
  { method: "PUT",    re: /^\/api\/v1\/me\/password$/ },
  { method: "POST",   re: /^\/api\/v1\/me\/tokens$/ },
  { method: "DELETE", re: /^\/api\/v1\/me\/tokens\/[^/]+$/ },
  { method: "POST",   re: /^\/api\/v1\/push\/subscriptions$/ },
  { method: "DELETE", re: /^\/api\/v1\/push\/subscriptions$/ },
  { method: "POST",   re: /^\/api\/v1\/auth\/logout$/ },
];

export function isStandardWriteAllowed(method: string, path: string): boolean {
  return STANDARD_WRITE_ALLOWLIST.some((e) => e.method === method && e.re.test(path));
}
```

### Hook logic (added to the existing onRequest, after `request.auth` is set)
```ts
const method = request.method.toUpperCase();
if (MUTATING.has(method) && request.auth?.role !== "admin") {
  const path = request.url.split("?")[0];
  if (!isStandardWriteAllowed(method, path)) {
    return reply.code(403).send({ error: "Admin access required" });
  }
}
```
- Runs for every `/api/*` non-public route (public routes already `return` earlier).
- `GET` / `HEAD` / `OPTIONS` are never gated → all reads stay open to `standard`.
- Applies identically to JWT and API-token auth (role comes from `request.auth`),
  so a standard-scoped token cannot escalate (AC6).

### Existing `requireAdmin` calls
`requireAdmin` in `users.ts`, `audit.ts`, `packages.ts` becomes redundant (the hook
already denies non-admins there). **Keep them** as defense-in-depth and explicit
intent — they are harmless (the hook 403s first for standard; for admin both pass).

### Secret-bearing reads must also be admin-gated (added after review)

The mutation gate deliberately does not touch `GET`. But a few config `GET`
reads return **secrets** (MQTT broker plaintext passwords, notification channel
config with the Telegram `botToken` / webhook URLs). Leaving them open to a
`standard` user is an out-of-band escalation (read the broker password, then
drive the broker directly). These whole prefixes are admin-only config areas, so
they get a per-prefix `onRequest` `requireAdmin` hook (same pattern as
`users.ts`), gating their reads and writes:

- `src/api/routes/mqtt-brokers.ts`, `src/api/routes/mqtt-publishers.ts`,
  `src/api/routes/notification-publishers.ts`.

(`GET /settings` and `GET /integrations` already redact/gate their secrets.)

### Why a central hook, not per-route `requireAdmin`
The standard-permitted set is tiny (10 templates) and the config set is large and
grows over time. A per-route opt-in would eventually forget a new mutating endpoint,
silently exposing it to `standard`. Default-deny is fail-closed: a new mutating
route is admin-only until explicitly allowlisted. One place to read and to test.

## 2. Frontend — hide configuration actions for `standard`

Gate every configuration action behind `user?.role === "admin"`. Introduce a tiny
`useIsAdmin()` selector (or reuse the existing `user?.role === "admin"` already used
in `AppLayout` / `Sidebar`) and apply it to the config controls that today live in
non-admin views:

| Area | Component(s) | Gate |
| --- | --- | --- |
| Equipment add/edit/delete | `EquipmentsPage`, `EquipmentCard`, zone equipment lists, `EquipmentForm` entry points | hide add/edit/delete; keep the control widgets (actuation) |
| Recipe add/edit/delete/toggle | `ZoneRecipesSection` | hide the "+", edit, delete, and the recipe on/off switch |
| Zone add/edit/delete/reorder | zone tree / `ZonesPage` | hide add/edit/delete/reorder |
| Modes (edit + activate toggles) | modes views | hide edit AND the activation toggles (modes = admin) |
| Dashboard edit | dashboard page (`WidgetGrid`, `AddWidgetModal`, reorder, delete) | hide add/remove/reorder/edit widgets |
| Charts | chart creation entry points | hide create/edit/delete |
| Devices | `DevicesPage` | hide rename/delete |
| Administration (users, audit, integrations, mqtt, plugins, backup, settings) | `Sidebar` / `AppLayout` | already gated by `isAdmin` — no change |

Kept visible for `standard`: dashboard (read), zone views (read), equipment/zone
**control** widgets (actuation), the personal account & preferences pages, theme
toggle, push-notification opt-in.

The backend `403` is the source of truth; UI hiding is UX (no button that would fail).

## 3. Files changed

| Layer | File | Change |
| --- | --- | --- |
| backend | `src/auth/auth-middleware.ts` | `isStandardWriteAllowed` + allowlist + role gate in the onRequest hook |
| backend | `src/auth/auth-middleware.test.ts` | role-gate + allowlist tests |
| ui | `ui/src/…` config components (see table §2) | gate config actions behind `role === "admin"` |
| docs | `docs/technical/api-reference.md` | document the admin/standard role model + allowlist |
| spec | `specs/131-rbac-config-admin-only/*` | this spec |

## 4. Rollout / compatibility

- No migration. Existing `admin` users unaffected. Existing `standard` users lose
  the ability to mutate config (the intended change) but keep view + actuation.
- Recovery for a home that only had a single `standard`-ish account: the first user
  is always `admin` (setup), so there is always an admin to configure.

# Plan — Spec 131

## Implementation steps

### A. Backend — role gate (`feat/rbac-config-admin-only`)
1. `src/auth/auth-middleware.ts`: add `MUTATING`, `STANDARD_WRITE_ALLOWLIST`,
   and the exported pure `isStandardWriteAllowed(method, path)`.
2. In the `onRequest` hook, after `request.auth` is set, deny non-admin mutations
   not in the allowlist with `403`.
3. Keep the existing `requireAdmin` calls (defense in depth).
4. `npx tsc --noEmit` + `eslint` clean.

### B. Backend tests
5. Extend `src/auth/auth-middleware.test.ts` with the scenarios in the test plan.

### C. Frontend — hide config for standard
6. Add `useIsAdmin()` (or reuse `user?.role === "admin"`).
7. Gate config actions in the components listed in architecture.md §2 (equipment /
   recipe / zone / mode / dashboard / chart / device edit + mode activation toggles).
8. `cd ui && npx tsc -b --noEmit` + `eslint` clean.

Order: A → B first (the security boundary), then C (UX). B is the gate that must be
green; C is verified by tsc + manual (no React tests, per repo convention).

## Test Plan

### Modules to test
- `src/auth/auth-middleware.ts` — `isStandardWriteAllowed` (pure) + the role gate.
- Frontend config-hiding: no React tests in this project → tsc + manual check.

### Scenarios (auth-middleware)

| Scenario | Expected |
| --- | --- |
| `isStandardWriteAllowed("POST","/api/v1/equipments/abc/orders/state")` | true |
| `isStandardWriteAllowed("POST","/api/v1/zones/z1/orders/allLightsOff")` | true |
| `isStandardWriteAllowed("PUT","/api/v1/me/password")` | true |
| `isStandardWriteAllowed("POST","/api/v1/me/tokens")` / `DELETE /me/tokens/x` | true |
| `isStandardWriteAllowed("POST","/api/v1/push/subscriptions")` / DELETE | true |
| `isStandardWriteAllowed("POST","/api/v1/auth/logout")` | true |
| `isStandardWriteAllowed("PUT","/api/v1/equipments/abc")` | false |
| `isStandardWriteAllowed("DELETE","/api/v1/equipments/abc")` | false |
| `isStandardWriteAllowed("POST","/api/v1/equipments/abc/order-bindings")` | false (near-miss of the orders rule) |
| `isStandardWriteAllowed("POST","/api/v1/modes/m1/activate")` | false (modes = admin) |
| `isStandardWriteAllowed("POST","/api/v1/recipe-instances/r1/enable")` | false (recipes = admin) |
| `isStandardWriteAllowed("POST","/api/v1/dashboard/widgets")` | false |
| `isStandardWriteAllowed("PUT","/api/v1/settings")` | false |
| `isStandardWriteAllowed("GET", anything)` | (not called for GET; assert gate ignores GET) |
| Trailing query string on an allowed path | allowed (path is split on `?` before match) |

### Scenarios (role gate in the hook — integration-style over the middleware)

| Actor | Request | Expected |
| --- | --- | --- |
| standard | `GET /api/v1/equipments` | passes (read) |
| standard | `POST /api/v1/equipments/x/orders/state` | passes (allowlist) |
| standard | `POST /api/v1/equipments` | 403 |
| standard | `DELETE /api/v1/zones/z1` | 403 |
| standard | `POST /api/v1/modes/m/activate` | 403 |
| standard | `PUT /api/v1/me/password` | passes |
| admin | `POST /api/v1/equipments` | passes |
| admin | any mutation | passes |
| standard-scoped **API token** | `POST /api/v1/equipments` | 403 (role from token) |
| standard-scoped API token | `POST /api/v1/equipments/x/orders/state` | passes |

### Retro-compat
- Admin behavior unchanged (all existing tests green).
- Reads unchanged for all roles.

## Tasks
- [x] A1 allowlist + `isStandardWriteAllowed`
- [x] A2 role gate in onRequest hook
- [x] A3 backend tsc + eslint clean
- [x] B1 auth-middleware tests (all scenarios above)
- [x] C1 `useIsAdmin` + gate equipment/recipe/zone config actions
- [x] C2 gate mode edit + activation toggles
- [x] C3 gate dashboard/chart/device config actions
- [x] C4 ui tsc + eslint clean
- [x] D1 docs: role model in api-reference.md

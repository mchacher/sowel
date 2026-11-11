# API Reference

Sowel exposes a REST API under `/api/v1/` and a WebSocket endpoint at `/ws`. All endpoints require authentication unless noted otherwise. Responses use JSON.

**Base URL**: `http://<host>:3000`

**Authentication**: Pass a JWT access token as `Authorization: Bearer <token>` header, or an API token as `Authorization: Bearer swl_<token>`.

---

## Table of Contents

- [Authentication](#authentication)
- [Two-Factor Authentication (MFA)](#two-factor-authentication-mfa)
- [Current User (Me)](#current-user-me)
- [Users (Admin)](#users-admin)
- [Devices](#devices)
- [Equipments](#equipments)
- [Zones](#zones)
- [Modes](#modes)
- [Calendar](#calendar)
- [Recipes](#recipes)
- [Dashboard](#dashboard)
- [Charts](#charts)
- [Energy](#energy)
- [History](#history)
- [Integrations (Admin)](#integrations-admin)
- [Plugins (Admin)](#plugins-admin)
- [Settings (Admin)](#settings-admin)
- [Shared Access](#shared-access-spec-181)
- [MQTT Brokers](#mqtt-brokers)
- [MQTT Publishers](#mqtt-publishers)
- [Notification Publishers](#notification-publishers)
- [Button Actions](#button-actions)
- [Activity](#activity)
- [Logs (Admin)](#logs-admin)
- [Backup (Admin)](#backup-admin)
- [Health](#health)
- [WebSocket](#websocket)

---

## Authentication

Public endpoints -- no auth required for `status` and `setup`.

| Method | Path                   | Description                                                                                                                                                                                                                                                           |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/auth/status`  | Check if first-run setup is required. Returns `{ setupRequired: boolean }`.                                                                                                                                                                                           |
| `POST` | `/api/v1/auth/setup`   | Create the first admin user (first-run only). Body: `{ username, password, displayName, language? }`. Returns JWT tokens.                                                                                                                                             |
| `POST` | `/api/v1/auth/login`   | Authenticate. Body: `{ username, password, trustedDeviceToken? }`. Returns `{ accessToken, refreshToken }`, or `{ mfaRequired: true, mfaToken }` if the account has TOTP MFA enabled and `trustedDeviceToken` is absent/invalid (spec 151). Rate limited: 10 req/min. |
| `POST` | `/api/v1/auth/refresh` | Refresh access token. Body: `{ refreshToken }`. Returns new token pair.                                                                                                                                                                                               |
| `POST` | `/api/v1/auth/logout`  | Invalidate refresh token. Body: `{ refreshToken }`. Returns 204.                                                                                                                                                                                                      |

---

## Two-Factor Authentication (MFA)

Spec 151 — optional per-user TOTP (RFC 6238) second factor with single-use backup codes. Public endpoint (login second factor) plus authenticated self-service management under `/me/mfa`.

| Method   | Path                                     | Description                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/auth/mfa/verify`                | **Public.** Completes login after an `mfaRequired` challenge. Body: `{ mfaToken, code, isBackupCode?, trustDevice? }`. Returns `{ accessToken, refreshToken, ... }`, plus `trustedDeviceToken` + `trustedDeviceExpiresAt` when `trustDevice` was set. Rate limited: 10 req/min. |
| `GET`    | `/api/v1/me/mfa`                         | Current MFA status: `{ enabled, confirmedAt, backupCodesRemaining }`.                                                                                                                                                                                                           |
| `POST`   | `/api/v1/me/mfa/totp/setup`              | Start (or restart) enrollment. Returns `{ secret, otpauthUrl, qrCodeDataUrl }`.                                                                                                                                                                                                 |
| `POST`   | `/api/v1/me/mfa/totp/confirm`            | Confirm enrollment. Body: `{ code }`. Returns `{ backupCodes: string[] }` — 10 codes, shown only once.                                                                                                                                                                          |
| `DELETE` | `/api/v1/me/mfa/totp`                    | Disable MFA. Body: `{ password, code, isBackupCode? }` — requires a live password + code regardless of session trust. Returns 204.                                                                                                                                              |
| `POST`   | `/api/v1/me/mfa/backup-codes/regenerate` | Invalidate unused codes and issue 10 new ones. Body: `{ password, code, isBackupCode? }`. Returns `{ backupCodes: string[] }`.                                                                                                                                                  |
| `GET`    | `/api/v1/me/mfa/trusted-devices`         | List devices exempted from the MFA step at login.                                                                                                                                                                                                                               |
| `DELETE` | `/api/v1/me/mfa/trusted-devices/:id`     | Revoke a trusted device. Returns 204.                                                                                                                                                                                                                                           |

Trusted-device duration is a per-user preference: `mfaTrustedDeviceDays` in `PUT /api/v1/me/preferences`, 1-90 (default 30), clamped server-side.

!!! note
An `mfaToken` returned by `/auth/login` is single-purpose (JWT `purpose: "mfa_pending"`) and is rejected by every other endpoint — it cannot be used as a normal `Authorization: Bearer` token.

---

## Roles & authorization

Two roles exist: `admin` and `standard`. Most reads (`GET`) are available to any
authenticated user, but not all: the sections tagged **(Admin)** below are
admin-only for reads too, because what they return is configuration and secrets
(the full backup, the server log, the settings map, broker credentials,
notification channel tokens, the user list). Those reads are gated by the route
that serves them, not by the global mutation gate, which only inspects
`POST/PUT/PATCH/DELETE`.

**All configuration mutations are admin-only** (spec 131): a
`standard` user gets `403 { "error": "Admin access required" }` on any
`POST/PUT/PATCH/DELETE` except the usage/personal allowlist below. Sections tagged
**(Admin)** require the admin role; the gate is fail-closed, so any mutating
endpoint not in the allowlist is admin-only.

**Standard write allowlist** (the only mutations a `standard` may perform):

| Method         | Path                                                                                                      | Purpose                          |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------- |
| POST           | `/api/v1/equipments/:id/orders/:alias`                                                                    | Actuate an equipment             |
| POST / DELETE  | `/api/v1/equipments/:id/timed-action`                                                                     | Timed action (spec 174)          |
| POST           | `/api/v1/zones/:id/orders/:orderKey`                                                                      | Zone command                     |
| POST           | `/api/v1/modes/:id/activate`, `/deactivate`                                                               | Switch the active mode           |
| POST           | `/api/v1/modes/:id/apply-to-zone/:zoneId`                                                                 | Apply a mode to a zone           |
| POST           | `/api/v1/recipe-instances/:id/actions`                                                                    | Fire a recipe action (#1211)     |
| PUT            | `/api/v1/ev-sessions/:id/attribution`                                                                     | Say which car charged (spec 191) |
| PUT            | `/api/v1/me`, `/api/v1/me/preferences`, `/api/v1/me/password`                                             | Own account                      |
| POST / DELETE  | `/api/v1/me/tokens[/:id]`                                                                                 | Own API tokens                   |
| POST / DELETE  | `/api/v1/me/mfa/totp/setup`, `/totp/confirm`, `/totp`, `/backup-codes/regenerate`, `/trusted-devices/:id` | Own MFA (spec 151)               |
| POST / DELETE  | `/api/v1/push/subscriptions`                                                                              | Own push subscription            |
| PATCH / DELETE | `/api/v1/push/subscriptions/:id`                                                                          | Own push device (spec 199)       |
| POST           | `/api/v1/auth/logout`                                                                                     | End own session                  |

An API token inherits its creator's role, so a standard-scoped token is subject to
the same gate (no privilege escalation).

**Modes are split between the two sides** (issue #912). _When_ a mode is on is
runtime state, changed several times a day, so a `standard` user may switch it.
What a mode _is_ — its name, its zone impacts, its actions — is configuration and
stays admin-only: `POST /api/v1/modes`, `PUT`/`DELETE /api/v1/modes/:id` and the
impact routes all return `403` for a non-admin.

Note what activation carries: a mode's impacts may include `recipe_toggle` and
`recipe_params` actions, which enable, disable or re-parameterise a recipe
instance durably — writes a `standard` user is refused directly, and that
deactivating the mode does not undo. This is deliberate delegation, not an
oversight: an admin authored the impacts, and the standard user only chooses when
they run. The same delegation already applies to the calendar and to a physical
button bound to a mode, neither of which carries a role.

## Current User (Me)

Authenticated user's own profile and tokens.

| Method   | Path                     | Description                                                                             |
| -------- | ------------------------ | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/me`             | Get current user profile.                                                               |
| `PUT`    | `/api/v1/me`             | Update display name. Body: `{ displayName }`.                                           |
| `PUT`    | `/api/v1/me/preferences` | Update preferences (language, theme, etc.). Body: `{ preferences }`.                    |
| `PUT`    | `/api/v1/me/password`    | Change password. Body: `{ currentPassword, newPassword }`.                              |
| `GET`    | `/api/v1/me/tokens`      | List own API tokens.                                                                    |
| `POST`   | `/api/v1/me/tokens`      | Create API token. Body: `{ name, expiresAt? }`. Returns token string (shown only once). |
| `DELETE` | `/api/v1/me/tokens/:id`  | Revoke an API token. Returns 204.                                                       |

---

## Users (Admin)

All user management routes require admin role.

| Method   | Path                    | Description                                                                                                                                                       |
| -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/users`         | List all users.                                                                                                                                                   |
| `POST`   | `/api/v1/users`         | Create user. Body: `{ username, password, displayName, role }`.                                                                                                   |
| `PUT`    | `/api/v1/users/:id`     | Update user. Body: `{ displayName?, role?, enabled? }`.                                                                                                           |
| `DELETE` | `/api/v1/users/:id`     | Delete user. Cannot delete self or last admin. Returns 204.                                                                                                       |
| `DELETE` | `/api/v1/users/:id/mfa` | Force-disable another user's MFA (spec 151 FR6) — recovery path when they lost both their TOTP device and backup codes. No challenge from the admin. Returns 204. |

---

## Devices

| Method   | Path                             | Description                                                                       |
| -------- | -------------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/devices`                | List all devices with current data and orders.                                    |
| `GET`    | `/api/v1/devices/:id`            | Get device with data and orders.                                                  |
| `PUT`    | `/api/v1/devices/:id`            | Update device. Body: `{ name?, zoneId? }`.                                        |
| `DELETE` | `/api/v1/devices/:id`            | Remove device. Returns 204.                                                       |
| `GET`    | `/api/v1/devices/suggest`        | Suggest compatible devices for an equipment type. Query: `?type=<equipmentType>`. |
| `GET`    | `/api/v1/devices/battery-alerts` | Active low-battery alerts (spec 143). Returns a list of `BatteryAlert`.           |
| `GET`    | `/api/v1/devices/:id/raw`        | Get raw integration expose data for a device.                                     |

---

## Equipments

| Method   | Path                                   | Description                                                                                                                                                                                                                                       |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/equipments`                   | List all equipments with bindings, current data, and derived `status` (see [Equipment status](#equipment-status-spec-116)). Optional `?type=<EquipmentType>` narrows to a single type (e.g. `energy_meter`). Unknown values return an empty list. |
| `GET`    | `/api/v1/equipments/:id`               | Get equipment with bindings, current data, and derived `status`.                                                                                                                                                                                  |
| `POST`   | `/api/v1/equipments`                   | Create equipment. Body: `{ name, type, zoneId, icon?, description?, deviceIds? }`. If `deviceIds` provided, auto-bindings are created.                                                                                                            |
| `PUT`    | `/api/v1/equipments/:id`               | Update equipment. Body: `{ name?, type?, zoneId?, icon?, description?, enabled? }`.                                                                                                                                                               |
| `DELETE` | `/api/v1/equipments/:id`               | Delete equipment. Returns 204.                                                                                                                                                                                                                    |
| `POST`   | `/api/v1/equipments/:id/orders/:alias` | Execute an equipment order. Body: `{ value }`.                                                                                                                                                                                                    |

### Timed actions (spec 174)

"Act now, revert after N minutes", held by the engine rather than by a recipe. The action is dispatched immediately through the ordinary order path; what the engine keeps is the **revert it owes**, and the instant it is owed at. It survives a restart, and a deadline that passed while the engine was down is honoured on the way back up.

| Method   | Path                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/equipments/:id/timed-action` | Act now, revert at the deadline. Body: `{ alias, value, revertValue, durationMs }`, or empty to arm what the equipment is configured for. Returns the armed action, which carries `stepIndex` and `nextDurationMs` (spec 178). **Spec 178**: with a `durationStepsMs` ladder configured, a further press climbs to the next step and a press past the last one answers `{ "disarmed": true }` — the deadline is dropped and NOTHING is dispatched. |
| `DELETE` | `/api/v1/equipments/:id/timed-action` | End the window early. `?revert=true` sends the revert now; without it the deadline is simply dropped. 404 when nothing is armed.                                                                                                                                                                                                                                                                                                                   |

```json
POST /api/v1/equipments/eq-gate/timed-action
{ "alias": "command", "value": "OPEN", "revertValue": "CLOSE", "durationMs": 900000 }

200 OK
{
  "alias": "command",
  "value": "OPEN",
  "revertValue": "CLOSE",
  "expiresAt": "2026-09-01T14:32:00.000Z",
  "armedAt": "2026-09-01T14:17:00.000Z",
  "armedBy": "u-1"
}
```

Rules worth knowing before calling it:

- **One per equipment.** Arming the _same_ action again moves the deadline and dispatches nothing — "open again", from somebody looking at an open gate, means "give me more time". A different alias or value replaces the window and is dispatched.
- **A hand-revert ends it.** The mirror binding reporting the revert value disarms the window and sends nothing at the deadline.
- **A revert that could not be sent alarms and stops.** It is never replayed: the engine cannot know whether sending it again would put the equipment back or act on it a second time.
- `durationMs` is between 10 s and 24 h. An action and its revert **may carry the same value**: a sliding gate on a sequential impulse is opened and closed by one command.
- **Not every equipment can be armed.** It must carry the order and a state reading tied to it (the order's own alias, or a reading in `light_state`, `gate_state`, `cover_state`, `lock_state`, `appliance_state`). Without one, a revert done by hand could never end the window, so the call is refused with `400 TimedCommandNotEligible`.
- **An empty body arms the equipment's own configuration** (`timedCommand`), so a surface does not have to restate three values it does not own: `POST /equipments/:id/timed-action` with `{}`. `409` when nothing is configured.
- `GET /equipments` and `GET /equipments/:id` carry `timedAction` while a window is running, with `expiresAt` as an ISO-8601 instant, and `timedCommand` when one is configured.

`PUT /api/v1/equipments/:id` accepts `localProduction` (spec 195, migration `041`): negative power on that power-only submeter is local production. Its integrated energy then keeps the positive part as `energy` (the by-usage slice) and writes the negative part as a separate `production` series, added to the house's solar in the self-consumption split. Refused with `400 LocalProductionNotApplicable` on a `main_energy_meter` / production type and together with `separateSupply`, checked on the resulting state, and with `400 LocalProductionNotPowerOnly` on a meter that reports its own energy counter.

`PUT /api/v1/equipments/:id` accepts `trackOrderOutcome` (`true` / `false`, or `null` for the type's default: on for `gate` and `door`, off for `shutter` and `awning`; spec 188 O10, migration `038`). It accepts `type`. The server checks only that the type exists; the edit form offers a change only between `shutter`, `awning` and `door` (spec 190), whose bindings stay valid. Zone aggregated data carries `doorsOpen` / `doorsTotal` for `door` equipments (spec 190).

`PUT /api/v1/equipments/:id` accepts `timedCommand` and validates it against the equipment's own bindings, so a configuration naming an order it does not carry is refused where it is written rather than where it is fired:

```json
PUT /api/v1/equipments/eq-gate
{ "timedCommand": { "alias": "command", "value": null, "revertValue": null, "durationMs": 900000 } }
```

`null` clears it. An absent key leaves it untouched.

### Equipment status (spec 116)

`GET /equipments` and `GET /equipments/:id` include two derived fields:

- `status: "online" | "degraded" | "offline"` — computed in memory from the backing devices' `status` and the freshness of streaming bindings.
  - `offline`: every bound device is `offline`, OR the equipment has no device bindings.
  - `degraded`: at least one device is `offline`, OR at least one streaming binding (`power`, `temperature`, etc.) has not been refreshed within its category timeout.
  - `online`: everything healthy.
- `statusReason?: { offlineDevices: string[]; staleBindings: string[]; offlineSince: string | null }` — present only when status ≠ `online`. Used by the UI tooltip.

Each entry of `dataBindings[]` also gains `stale: boolean`. Only streaming categories ever flip to `true`; event-based categories (motion, contact_door, action, light_state, shutter_position, etc.) are always `false`.

Bindings in the `power` category also carry `freshnessBudgetMs: number` (spec 175): how old that reading may be and still be drawn as a live measurement. It is derived from what the source actually does, not from the equipment's type — the median interval between its recent arrivals, or failing that the polling interval its integration declares — as `clamp(2.5 x cadence, 120 s, 30 min)`. A meter streaming at 1 Hz therefore carries 120 000 and a cloud poller on a 300 s cycle carries 750 000. The field is absent when the engine could not resolve it (a source that has not reported since the last restart, on an integration that declares no interval); a client reading it must then fall back to 10 minutes, never treat the reading as unbounded.

### Data Bindings

| Method   | Path                                              | Description                                         |
| -------- | ------------------------------------------------- | --------------------------------------------------- |
| `POST`   | `/api/v1/equipments/:id/data-bindings`            | Add a DataBinding. Body: `{ deviceDataId, alias }`. |
| `DELETE` | `/api/v1/equipments/:id/data-bindings/:bindingId` | Remove a DataBinding. Returns 204.                  |

### Order Bindings

| Method   | Path                                               | Description                                            |
| -------- | -------------------------------------------------- | ------------------------------------------------------ |
| `POST`   | `/api/v1/equipments/:id/order-bindings`            | Add an OrderBinding. Body: `{ deviceOrderId, alias }`. |
| `DELETE` | `/api/v1/equipments/:id/order-bindings/:bindingId` | Remove an OrderBinding. Returns 204.                   |

### Camera media proxy (spec 133)

Introduced with the `camera` equipment type. A camera plugin resolves a
`camera_snapshot_url` / `camera_stream_url` device data value (which may be
a LAN-local address the plugin alone can reach); these routes fetch that
URL server-side and stream the bytes back to the authenticated client. The
browser never learns the camera's real address or the plugin's upstream
credentials — no plugin code runs on this path at all, it is a plain HTTP
proxy over whatever URL is currently bound.

| Method | Path                                                   | Description                                                                                                                                                                                    |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/equipments/:id/camera/snapshot`               | Current still frame. Binary passthrough of the upstream `Content-Type`.                                                                                                                        |
| `GET`  | `/api/v1/equipments/:id/camera/stream`                 | Live stream. HLS manifests are rewritten to route segments through the sub-resource proxy below; other content types are passed through as-is (e.g. MJPEG).                                    |
| `GET`  | `/api/v1/equipments/:id/camera/stream/segment?u=<url>` | Sub-resource proxy for HLS segments/child playlists referenced by a rewritten manifest. `u` must resolve to the same origin as the camera's current `camera_stream_url` value — 403 otherwise. |

**Binding-gated, enforced server-side, not just hidden in the UI:**

- `404` if the equipment doesn't exist, or if the requested category (`camera_snapshot_url` / `camera_stream_url`) isn't bound on it — even when the underlying device technically exposes it. Binding a category is how an admin opts a specific camera into a specific feature (see [Equipments guide](../user/equipments.md#cameras)).
- `400` if the equipment isn't of type `camera`.
- `409` if the category is bound but the equipment's derived `status` is `offline`, or the bound value is empty.
- `502` if the upstream fetch fails or returns a non-2xx status.

No separate auth scheme — these routes sit behind the same JWT/API-token middleware as every other `/api/v1/*` route.

---

### The submeter role (`?role=submeter`)

`GET /api/v1/equipments?role=submeter` returns the consumption submeters, ordered clamps first, then metering relays, then other metered loads, each group by name, so a fixed-capacity client truncating the list keeps the meters that matter. `?type=energy_meter` is honoured as the same role for the energy display's older firmware.

Each entry carries an extra field on this role only:

| Field                 | Meaning                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `powerReadingCurrent` | `true` when the `power` reading may be drawn as a live measurement, `false` when it may not (the reading is older than its freshness budget, or the equipment is offline), `null` when there is no numeric `power` reading to judge. |

A client must consult it before drawing a segment. A reading past its budget is a leftover, not a measurement, and it is quiet: a stale `0 W` looks exactly like an appliance that is off. The budget is the binding's own `freshnessBudgetMs`, derived from the cadence that source reports at (spec 175), so a meter is judged against its own behaviour rather than against a constant chosen for its equipment type (issues #744, #832 and #883).

Offline equipments stay in the list on purpose, so a client can render an "offline since" row, and they answer `false`: their last reading is not a live measurement however recent it is.

The verdict comes from `classifyPowerReading` in `src/shared/reading-freshness.ts`, and the web UI's Live breakdown calls the same function, so the two surfaces cannot answer differently about one appliance.

## Zones

| Method   | Path                                 | Description                                                                             |
| -------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/zones`                      | List all zones as a tree structure.                                                     |
| `GET`    | `/api/v1/zones/:id`                  | Get zone with children.                                                                 |
| `POST`   | `/api/v1/zones`                      | Create zone. Body: `{ name, parentId?, icon?, description?, displayOrder? }`.           |
| `PUT`    | `/api/v1/zones/:id`                  | Update zone. Body: `{ name?, parentId?, icon?, description?, displayOrder? }`.          |
| `DELETE` | `/api/v1/zones/:id`                  | Delete zone. Returns 204.                                                               |
| `PUT`    | `/api/v1/zones/reorder`              | Reorder sibling zones. Body: `{ parentId, orderedIds }`. Returns 204.                   |
| `GET`    | `/api/v1/zones/aggregation`          | Get aggregated data for all zones (temperature, motion, lightsOn, etc.).                |
| `POST`   | `/api/v1/zones/:id/orders/:orderKey` | Execute zone-level order (e.g. `allLightsOff`, `allShuttersClose`). Body: `{ value? }`. |

---

## Modes

| Method   | Path                                      | Description                                          |
| -------- | ----------------------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/v1/modes`                           | List all modes with details.                         |
| `GET`    | `/api/v1/modes/:id`                       | Get mode with impacts and state.                     |
| `POST`   | `/api/v1/modes`                           | Create mode. Body: `{ name, icon?, description? }`.  |
| `PUT`    | `/api/v1/modes/:id`                       | Update mode. Body: `{ name?, icon?, description? }`. |
| `DELETE` | `/api/v1/modes/:id`                       | Delete mode. Returns 204.                            |
| `POST`   | `/api/v1/modes/:id/activate`              | Activate mode.                                       |
| `POST`   | `/api/v1/modes/:id/deactivate`            | Deactivate mode.                                     |
| `POST`   | `/api/v1/modes/:id/apply-to-zone/:zoneId` | Apply mode impacts to a specific zone.               |

### Zone Mode Impacts

| Method   | Path                                 | Description                                                           |
| -------- | ------------------------------------ | --------------------------------------------------------------------- |
| `GET`    | `/api/v1/zones/:zoneId/mode-impacts` | Get mode impacts for a zone.                                          |
| `PUT`    | `/api/v1/modes/:id/impacts/:zoneId`  | Set zone impact actions. Body: `{ actions: ZoneModeImpactAction[] }`. |
| `DELETE` | `/api/v1/modes/:id/impacts/:zoneId`  | Remove zone impact. Returns 204.                                      |

### Mode Triggers

| Method | Path                         | Description                                 |
| ------ | ---------------------------- | ------------------------------------------- |
| `GET`  | `/api/v1/modes/:id/triggers` | Get button bindings that trigger this mode. |

---

## Calendar

| Method   | Path                                  | Description                                            |
| -------- | ------------------------------------- | ------------------------------------------------------ |
| `GET`    | `/api/v1/calendar/profiles`           | List all calendar profiles.                            |
| `GET`    | `/api/v1/calendar/active`             | Get the active profile with its slots.                 |
| `PUT`    | `/api/v1/calendar/active`             | Set the active profile. Body: `{ profileId }`.         |
| `GET`    | `/api/v1/calendar/profiles/:id/slots` | List slots for a profile.                              |
| `POST`   | `/api/v1/calendar/profiles/:id/slots` | Add a slot. Body: `{ days, time, modeActions }`.       |
| `PUT`    | `/api/v1/calendar/slots/:slotId`      | Update a slot. Body: `{ days?, time?, modeActions? }`. |
| `DELETE` | `/api/v1/calendar/slots/:slotId`      | Delete a slot. Returns 204.                            |

---

## Recipes

### Recipe Definitions

| Method | Path                        | Description                                    |
| ------ | --------------------------- | ---------------------------------------------- |
| `GET`  | `/api/v1/recipes`           | List available recipe definitions (templates). |
| `GET`  | `/api/v1/recipes/:recipeId` | Get recipe definition with slots and i18n.     |

A definition carries `icon` (a Lucide name) when its package manifest declares one (spec 198); the key is absent otherwise.

### Recipe Instances

| Method   | Path                                   | Description                                                                                                                                                 |
| -------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/recipe-instances`             | List all active recipe instances.                                                                                                                           |
| `POST`   | `/api/v1/recipe-instances`             | Create instance. Body: `{ recipeId, params }`.                                                                                                              |
| `PUT`    | `/api/v1/recipe-instances/:id`         | Update instance params. Body: `{ params }`.                                                                                                                 |
| `DELETE` | `/api/v1/recipe-instances/:id`         | Stop and delete instance. Returns 204.                                                                                                                      |
| `POST`   | `/api/v1/recipe-instances/:id/enable`  | Enable a disabled instance.                                                                                                                                 |
| `POST`   | `/api/v1/recipe-instances/:id/disable` | Disable (pause) a running instance.                                                                                                                         |
| `POST`   | `/api/v1/recipe-instances/:id/actions` | Send an action to a running recipe. Body: `{ action, payload? }`. Open to `standard` users (allowlisted, #1211); the other instance routes stay admin-only. |
| `GET`    | `/api/v1/recipe-instances/:id/log`     | Get execution log. Query: `?limit=50`.                                                                                                                      |

---

## Dashboard

| Method   | Path                              | Description                                                                             |
| -------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/dashboard/widgets`       | List all dashboard widgets ordered by display order.                                    |
| `POST`   | `/api/v1/dashboard/widgets`       | Create widget (admin). Body: `{ type, equipmentId?, zoneId?, family?, label?, icon? }`. |
| `PATCH`  | `/api/v1/dashboard/widgets/:id`   | Update widget label, icon, or config (admin). Body: `{ label?, icon?, config? }`.       |
| `DELETE` | `/api/v1/dashboard/widgets/:id`   | Delete widget (admin). Returns 204.                                                     |
| `PUT`    | `/api/v1/dashboard/widgets/order` | Reorder widgets (admin). Body: `{ order: string[] }`.                                   |

Widget bodies are schema-validated (issue #597). `type` is `"equipment"` or `"zone"`, and it decides what else is required: `equipmentId` for the first, `zoneId` plus `family` (one of `lights`, `shutters`, `heating`, `sensors`) for the second. A malformed body answers `400 { "error": "..." }`.

Two things worth knowing because they are not what a reader would guess:

- A referenced equipment or zone that does not exist answers **400**, not 404. That is the status this route has always returned, and the schema conversion did not renumber it.
- Unknown fields in the body are ignored rather than rejected.
- `label` and `icon` accept a string or `null`; `config` is any object, and `null` clears it. A `PATCH` with no body at all is a no-op that returns the widget unchanged.

Two inputs that used to be accepted now answer 400. Both were silent failures rather than working features: a non-string `label` was stored verbatim, and `PUT /order` accepted any array, so `{ "order": [1, 2] }` matched no row and answered `{ "ok": true }` having reordered nothing.

---

## Charts

| Method   | Path                 | Description                               |
| -------- | -------------------- | ----------------------------------------- |
| `GET`    | `/api/v1/charts`     | List saved chart configurations.          |
| `GET`    | `/api/v1/charts/:id` | Get a chart configuration.                |
| `POST`   | `/api/v1/charts`     | Create chart. Body: `{ name, config }`.   |
| `PUT`    | `/api/v1/charts/:id` | Update chart. Body: `{ name?, config? }`. |
| `DELETE` | `/api/v1/charts/:id` | Delete chart. Returns 204.                |

---

## Energy

| Method   | Path                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/energy/status`                                | Energy module status (available, sources, `tariffConfigured`). Spec 123: `tariffConfigured` is `true` iff at least one of `prices.hp` / `prices.hc` is > 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET`    | `/api/v1/energy/history`                               | Query energy history. Query: `?period=day&date=2026-01-15`. Periods: `day` (24 hourly buckets), `week` (7 daily buckets Mon-Sun), `month` (28-31 daily buckets), `year` (12 monthly buckets). Always returns N points; empty buckets are zero-filled (`hp = hc = prod = autoconso = injection = 0`). Bucket boundaries align with the server's local TZ (`TZ` env, defaults to `Europe/Paris`). HP / HC are summed per bucket from InfluxDB's pre-split `energy_hp` / `energy_hc` series. **Spec 123**: each point and the totals also carry `cost_hp` / `cost_hc` / `cost_total` (€, 4 decimals), computed at read time from the current `TariffPrices`. Per-point cost is raw consumption × price; totals cost is grid-side (autoconso-subtracted) × price. When no tariff is configured every cost field is 0. **Spec 195**: `prod` also sums the `production` series of every submeter (written only while flagged `localProduction`, kept after unflagging; already inside `autoconso` / `injection`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET`    | `/api/v1/energy/by-usage`                              | Per-submeter consumption time series for the same period buckets as `/energy/history` (same N-points-per-period and zero-fill semantics). Query: `?period=day&date=2026-01-15`. Returns one series per submeter `energy_meter` plus an `other` residual (`max(0, total - Σ submeters)`) and per-equipment totals. **Spec 123**: each `SubmeterSeries` carries a `cost` (€) and `totals` adds `costByEquipment` / `otherCost` / `totalCost` (€). **Spec 202**: costs are priced point by point, each bucket at the main meter's blended €/kWh of that bucket (`cost_total / ((hp + hc) / 1000)` of the matching `/energy/history` point), so a meter that only runs off-peak costs the off-peak price; `totalCost` is the sum of the main meter's point costs. Before spec 202 one period-blended rate was applied to every series. When there is no main meter or no consumption, every cost field is 0. **Spec 179**: an equipment flagged `separateSupply` (via `PUT /api/v1/equipments/:id`) leaves `submeters`, Σ, `other` and every cost field, and comes back in an optional `separateSupply: SubmeterSeries[]` — raw series, `cost` fixed at 0, key omitted when no equipment carries the flag. **Spec 196**: every series also carries `colorIndex` (integer), its place in the eight-colour series palette (`colorIndex % 8`): sorted by id across `submeters`, then continuing across `separateSupply`. `color` is unchanged: the same hex as before spec 196, from the same index (`#60A5FA`, `#34D399`, `#F87171`, `#A78BFA`, `#22D3EE`, `#FB7185`, `#FBBF24`, `#818CF8`); the Sowel UI paints from `colorIndex` instead, so the colour follows the theme.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET`    | `/api/v1/energy/bilan`                                 | **Spec 200** — the Energy Bilan (Costs page) in one read. Query: `?period=day\|month\|year&date=2026-11-10` (400 on another period, 404 without a main meter, 503 without InfluxDB). Returns `bill` (`total`, `hp`, `hc`: the grid-side € of `/energy/history` totals), `avoided` (€ that self-consumed solar would have cost, each point's self-consumed Wh at that point's blended price) and `selfConsumedWh`; `points[]` with `paidHp`, `paidHc`, `avoided` per bucket (year view: `previousYearBill`, null when that month is not covered); `comparison` (`days`: average bill of the 7 previous days with data; `month`: `projectedBill` from day 3 of the current month and `previousYearBill`; `year`: the fully elapsed months with data on all days but two in both years, `months` as `YYYY-MM`, `bill`, `previousYearBill`), or null; `usage[]` (`id`, null for other, `name`, `colorIndex`, `wh`, `paid`, `avoided`, sorted by `paid`; each meter split per point); `arbiter` (`enabled`, `since`, `measured`: `none`/`partial`/`full`, `solarWh`, `avoided`, `loads[]`); `tariffConfigured`, `prices` (**spec 202**: those in force on the last day of the period, today for a period still running), `hasProduction`. **Spec 202**: `arbiter.avoided` is priced at read time from the Wh the meter booked in peak and off-peak, with the prices in force on each row's day; what was booked in euros before migration 044 is added as booked. **Spec 205**: `fee` (`total` € unrounded, `days` counted from the period start to the earlier of its end and today, `daysWithoutFee`, `kva` of the last day counted), each day at its version's `fixedFeeYear` over the length of its year; null on the day view, for a period still to come, and when no counted day has a fee. `priceSpans[]` (`from`, `to` as `YYYY-MM-DD`, `hp`, `hc`, `fixedFeeYear`, `kva`): the versions in force over the period, oldest first, clamped to it. **Spec 207**: `energy` (`gridHpWh`, `gridHcWh`: the Wh bought from the grid, the `total_hp` / `total_hc` of `/energy/history`; `consumedWh`: grid plus `selfConsumedWh`), and each `comparison` carries the grid Wh of its € figures: `days` `averageGridWh` (same days as `averageBill`), `month` `projectedGridWh` (same pace, null with `projectedBill`) and `previousYearGridWh` (null with `previousYearBill`), `year` `gridWh` and `previousYearGridWh` (same months). |
| `GET`    | `/api/v1/settings/energy/tariff`                       | Get the tariff configuration: `schedules` (HP/HC slots) and `prices`. **Spec 202**: `prices` are those of the tariff version in force today. **Spec 204**: `summer` (`{ from, to, schedules }`) when a seasonal schedule is stored; `schedules` is then the winter one. Admin only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PUT`    | `/api/v1/settings/energy/tariff`                       | Update the HP/HC schedule. Body: `{ schedules, summer?, prices? }`. **Spec 204**: the body is the whole schedule, so a body without `summer` stores a single schedule for the whole year. `summer.schedules` is required, `summer.from` and `summer.to` (first and last day of summer, `MM-DD`, inclusive) default to `04-01` and `10-31`; `from` after `to` answers `400`. **Spec 202**: `prices` is optional; when sent, it edits in place the version in force today (or creates the first one), as this route always repriced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`    | `/api/v1/settings/energy/tariff/versions`              | **Spec 202** — the dated price versions, oldest first: `id`, `startDate` (local `YYYY-MM-DD`, `null` for the first version, open backwards), `prices` (`hp`, `hc`, €/kWh incl. tax), `fixedFeeYear` (€/year, nullable), `kva` (nullable), `origin` (`migration`, `manual`), `createdAt`, `updatedAt`. Admin only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST`   | `/api/v1/settings/energy/tariff/versions`              | **Spec 202** — add a version. Body: `{ startDate, prices: { hp, hc }, fixedFeeYear?, kva? }`. The first version ever created is stored without a start date. `201` with the version; `400` for a date that is not a real `YYYY-MM-DD` day, a price outside 0 to 5 €/kWh, a negative fee or a power not above 0; `409` when a version already starts on that date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PUT`    | `/api/v1/settings/energy/tariff/versions/:id`          | **Spec 202** — edit a version (same body). A `startDate`, `fixedFeeYear` or `kva` left out keeps its stored value; `null` clears the fee or the power. The version without a start date keeps none. `404`, `400`, `409` as above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DELETE` | `/api/v1/settings/energy/tariff/versions/:id`          | **Spec 202** — delete a dated version. **Spec 203**: a version that came from the price file (`origin` `file:…`) has its date set aside, so the next read does not propose it again. `409` for the version without a start date, `404` when unknown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET`    | `/api/v1/settings/energy/contract`                     | **Spec 202** — the current contract: `supplier` (`edf-tarif-bleu`, `other`), `contractType` (`hphc`, `base`), `kva` (nullable), `autoUpdate` (**spec 203**: follow the price file; always `false` for `other`). Before one is saved: `other`, `hphc` when the schedule has an off-peak slot (`base` otherwise), the power of the latest version. Admin only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PUT`    | `/api/v1/settings/energy/contract`                     | **Spec 202** — save the contract (`supplier`, `contractType` and `kva` required, `kva` above 0 or `null`; `autoUpdate` optional, `true` by default for a supplier of the price file). Returns it. **Spec 203**: a read of the price file is started in the background. It prices nothing: it is what a price source will match on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET`    | `/api/v1/settings/energy/price-file`                   | **Spec 203** — where the daily read of the electricity price file stands: `following` (the contract's supplier is in the file, `autoUpdate` is on, a power is set), `lastCheckAt`, `lastSuccessAt`, `error` (why the last read failed, or `null`), `latestStartDate` (latest price the file holds for the contract), `noPriceForContract`, `pending[]` (prices waiting for confirmation, newest first: `contractType`, `kva`, `startDate`, `hp`, `hc`, `fixedFeeYear`), `dismissedCount`. Admin only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST`   | `/api/v1/settings/energy/price-file/check`             | **Spec 203** — read the price file now. A period published since the last read, that follows the existing versions and moves the peak price by less than 30 %, is added by itself (`origin: "file:<supplier>"`); every other new price is held in `pending`. Returns the status. A failed read changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `POST`   | `/api/v1/settings/energy/price-file/apply`             | **Spec 203** — add held prices. Body: `{ startDates: string[] }`. Returns `{ created: TariffVersion[], status }`. `400` when a date is not pending; nothing is created then.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST`   | `/api/v1/settings/energy/price-file/dismiss`           | **Spec 203** — set held prices aside for this contract. Body: `{ startDates: string[] }`. Returns the status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST`   | `/api/v1/settings/energy/price-file/restore-dismissed` | **Spec 203** — propose again the prices set aside for the contract in force. Returns the status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET`    | `/api/v1/energy/arbiter`                               | Capacity arbiter read model. `loads[]` is the one state model since spec 165: one entry per flexible load with `state` (`granted` / `granted-idle` / `pending` / `unmanaged` / `suspended` / `idle`), `watts`, `needW` and `shortfallW` (a modulating claim, spec 185, adds `modulation` `{minW, maxW, stepW}` and, while granted, `budgetW`). Alongside it: `enabled`, `state`, `availableSurplusW`, `productionDetected`, `dormant`, `engageMarginW`, `journal`, `surplusSeries`. `grants`, `pending`, `suspensions` and `idle` are **deprecated**, superseded by `loads`. The journal is a bounded ring (200 entries), persisted since spec 147, and carries no prices. Any authenticated user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST`   | `/api/v1/energy/arbiter/resume/:equipmentId`           | Spec 140 — lift a manual-override suspension immediately ("resume control now", FR-6). Admin only. 404 when the equipment has no active suspension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `GET`    | `/api/v1/energy/arbiter/metrics`                       | Spec 158 — daily arbiter metrics over `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, defaults to the last 30 days, span clamped to the 400-day retention rather than rejected). Returns `{ from, to, home[], loads[], estimates[] }`. Per load and per local day: `grants`, `revokes`, `shortCycles` (grants revoked inside `minOnS + releaseHoldS`), `grantedS`, `pendingS`, `unmanagedS`, `suspendedS`. Per day at home level: `exportWh`, `importWh`, `waitingExportWh` (export while a load was claiming it — the arbiter's own miss), `idleClaimableExportWh` (export while a _deferrable_ load was idle — a scheduling opportunity, not a failure), `samples` (coverage — a day well below 288 is a day the instance was down). `estimates` names the fields that are derived rather than measured. Empty payload with a 200 when the arbiter never ran. Any authenticated user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

`PUT /api/v1/settings/energy/tariff` is schema-validated (issue #597). `schedules[].days` are integers 0 to 6, `schedules[].slots[]` need a non-empty `start` and `end` plus a `tariff` of `hp` or `hc`, and `prices`, when present (spec 202 made it optional), carries numeric `hp` and `hc` from 0 to 5. `summer` (spec 204) takes the same `schedules` shape, and `from`/`to` must match `MM-DD` and name a day that exists (`04-31` is refused, `02-29` accepted). With `summer`, `schedules` (the winter) must not be empty. A malformed body answers `400 { "error": "..." }`; unknown fields are ignored. Two inputs that used to be accepted are now refused, both of them silent nonsense rather than working features: a fractional weekday, which `getDay()` can never equal, and a non-string slot bound such as `5` or `true`.

The `PUT` needs no admin check of its own because it is absent from the standard write allowlist, so the global fail-closed role gate refuses a non-admin first. The `GET` beside it carries one, because that gate covers only mutating methods.

---

## EV charge sessions

Spec 191. One session per plug-in on an `ev_charger`, with its energy split into grid peak, grid off-peak and solar (the car served last by the sun), its cost frozen at the prices of each 5-minute window, and the vehicle it belongs to. Every authenticated role may read, and may set the attribution.

| Method | Path                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/ev-sessions`                 | Sessions of one month, newest first. Query: exactly one of `chargerId` (every session of that charger) or `vehicleId` (the sessions attributed to that vehicle), and `month=YYYY-MM` (local, default this month). Returns `{ sessions: EvChargeSession[] }`: energy, `gridHpWh` / `gridHcWh` / `solarWh`, `costHpEur` / `costHcEur` / `costEur` (`null` without a tariff; **spec 202**: computed at read time from the session's grid Wh, at the prices in force on the day it started), `attribution` (`pending`, `vehicle`, `unattributed`, `other`), `attributionSource` (`auto`, `manual`), `attributionReason`, and `candidates` (every vehicle known when the session opened, with whether it was seen charging and its battery from the level just before the start to the highest one). |
| `GET`  | `/api/v1/ev-sessions/summary`         | A vehicle's month: `vehicleId` (required), `month`. Totals and split, `homePriceEurPerKwh`, `kWhPer100km` (measured), `eurPer100km`, or `eurPer100kmUnavailable` (`plug-in-hybrid`, `no-home-session`, `not-learned`, `too-few-km`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET`  | `/api/v1/ev-sessions/current`         | Spec 192 — a vehicle's sessions in progress: `vehicleId` (required). The open sessions, and the closed ones still in their grace period, that would go to this vehicle — attributed to it by hand while open, or given to it by the automatic attribution run now on their evidence. Returns `{ sessions: EvChargeSession[] }`, newest first. Empty when no car or several cars match.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PUT`  | `/api/v1/ev-sessions/:id/attribution` | Body `{ "target": "vehicle", "vehicleId": "…" }`, `{ "target": "other" }` (a guest) or `{ "target": "unattributed" }`. Final: automatic attribution never changes it again. Open to `standard` users (allowlisted). 400 for a vehicle that is not an `electric_vehicle`, 404 for an unknown session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

A vehicle is marked plug-in hybrid (no cost per 100 km) with `PUT /api/v1/equipments/:id` and `{ "plugInHybrid": true }` (admin). Spec 193: a charger names its usual vehicle with `{ "usualVehicleId": "<electric_vehicle id>" }`, or `null` to clear it (admin; 400 on another type or an id that is not a vehicle). It breaks a tie between several matching cars, `attributionReason` `usual-vehicle`, after the measured signals of spec 194: `power-match` (the car's own `charge_power` agrees with the charger's power) and `energy-match` (its battery rise × learned energy per point fits the session's energy).

Live updates on the `energy` WebSocket topic: `energy.ev_session.updated` (`{ session }`, at most once per 5-minute window per open session, and at close and attribution) and `energy.ev_session.deleted` (`{ sessionId, chargerId }`, a session under 0.1 kWh dropped at close).

---

## History

| Method | Path                                               | Description                                                                                                |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/history/status`                           | History module status (connected, historized bindings count, stats).                                       |
| `GET`  | `/api/v1/history/retention`                        | Retention and downsampling status for all InfluxDB buckets/tasks.                                          |
| `GET`  | `/api/v1/history/bindings/:equipmentId`            | List historize settings for an equipment's data bindings.                                                  |
| `PUT`  | `/api/v1/history/bindings/:equipmentId/:bindingId` | Set historize flag. Body: `{ historize }` (null, 0, or 1).                                                 |
| `GET`  | `/api/v1/history/sparkline/zone/:zoneId/:category` | Zone-level 24h sparkline data (e.g. temperature trend).                                                    |
| `GET`  | `/api/v1/history/sparkline/:equipmentId/:alias`    | Equipment-level 24h sparkline data.                                                                        |
| `GET`  | `/api/v1/history/:equipmentId`                     | List historized aliases for an equipment.                                                                  |
| `GET`  | `/api/v1/history/:equipmentId/:alias`              | Query time-series data. Query: `?from=-24h&to=&aggregation=auto`. Aggregations: `raw`, `1h`, `1d`, `auto`. |

---

## Integrations (Admin)

Admin-only routes for managing device integration plugins.

| Method | Path                               | Description                                                     |
| ------ | ---------------------------------- | --------------------------------------------------------------- |
| `GET`  | `/api/v1/integrations`             | List all integrations with status, settings, and device counts. |
| `POST` | `/api/v1/integrations/:id/start`   | Start an integration.                                           |
| `POST` | `/api/v1/integrations/:id/stop`    | Stop an integration.                                            |
| `POST` | `/api/v1/integrations/:id/restart` | Restart an integration (stop + start).                          |
| `POST` | `/api/v1/integrations/:id/refresh` | Force a data refresh (polling integrations only).               |

---

## Plugins (Admin)

Admin-only routes for third-party plugin management.

| Method | Path                             | Description                                                                        |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/plugins`                | List installed plugins.                                                            |
| `GET`  | `/api/v1/plugins/store`          | List available plugins (registry entries + personal sources, each with a `tier`).  |
| `POST` | `/api/v1/plugins/store/refresh`  | Force-refresh the registry and the personal source release caches.                 |
| `GET`  | `/api/v1/plugins/sources`        | List personal plugin sources (spec 136).                                           |
| `POST` | `/api/v1/plugins/sources`        | Add a personal source. Body: `{ repo }` (public GitHub `owner/repo`).              |
| `POST` | `/api/v1/plugins/sources/remove` | Remove a personal source. Body: `{ repo }`. Installed plugins are kept.            |
| `POST` | `/api/v1/plugins/install`        | Install from GitHub. Body: `{ repo, confirmed?, expectedSha256? }`.                |
| `POST` | `/api/v1/plugins/:id/update`     | Update a plugin. Body: `{ confirmed?, expectedSha256? }` (personal packages only). |
| `POST` | `/api/v1/plugins/:id/uninstall`  | Uninstall a plugin.                                                                |
| `POST` | `/api/v1/plugins/:id/enable`     | Enable a plugin (loads and starts it).                                             |
| `POST` | `/api/v1/plugins/:id/disable`    | Disable a plugin (stops and unloads it).                                           |

The plugin bodies are schema-validated (issue #597). `repo` must carry the `owner/repo` shape when **adding a personal source** and when **installing**: it is interpolated into a `api.github.com/repos/<repo>` URL and joined onto the plugin directory, so its shape is a security boundary. Removal only needs a non-empty key, since it is a lookup against what is already stored. On the two `sources` routes `repo` is trimmed before it is checked, so a paste with a trailing newline still works, and a non-string `repo` there now answers 400 where it used to crash the handler with a 500 (install already answered 400).

`confirmed` and `expectedSha256`, on install and update, accept their own type or `null`, `null` meaning absent as it always did. A value of the wrong type is now refused: `"confirmed": "true"` used to install as though confirmed, because the flag was only read for truthiness, which silently defeated the confirmation step. A body that is not an object is refused on update, where it used to be destructured into nothing and update anyway.

Every write here is admin-only, enforced before validation so a non-admin sending a malformed body still learns it is not allowed. `GET /api/v1/plugins/:id/oauth/callback` is the exception and carries no session at all: the OAuth provider redirects to it.

!!! note "Confirmation handshakes (409)"
`install` and `update` answer `409` when an explicit confirmation is required:

    - `CommunityPluginConfirmationRequired` (spec 089): registry plugin from a non-official owner. Retry with `confirmed: true`.
    - `PersonalPluginConfirmationRequired` (spec 136): plugin from a personal source. The response carries `{ repo, owner, version, sha256 }` computed from the actual tarball. Retry with `confirmed: true` and `expectedSha256` set to the approved hash — the re-downloaded tarball must match it, and the hash is then pinned for future integrity checks.

---

## Settings (Admin)

Admin-only key-value settings store (used for integration config, home settings, etc.).

| Method | Path               | Description                                                        |
| ------ | ------------------ | ------------------------------------------------------------------ |
| `GET`  | `/api/v1/settings` | Get all settings.                                                  |
| `PUT`  | `/api/v1/settings` | Update settings. Body: key-value object `{ "key": "value", ... }`. |

---

## Shared Access (spec 181)

Let someone who is not a Sowel user open a gate for a while. Off by default: while the
`sharedAccess.enabled` setting is not `"true"`, **every route below answers exactly what an unknown
route answers**, public ones included, so the feature cannot be probed from outside: the owner's
routes and the page (`/access/*`) answer `404`; the public API (`/api/v1/shared-access/public/*`)
answers an anonymous caller `401`, as any unknown `/api` route does, and a caller sending a `Bearer`
header gets the auth middleware's own answer, the same as on any unknown `/api` route. User guide:
[Shared Access](../user/shared-access.md).

Settings (through `PUT /api/v1/settings`): `sharedAccess.enabled`, `sharedAccess.publicBaseUrl`
(the host the invitations point to), `sharedAccess.publicPath` (default `/access/`). The per-house
secret the link tokens are derived from, `sharedAccess.linkSecret`, is never returned by
`GET /api/v1/settings` and cannot be written through `PUT /api/v1/settings`.

### Owner routes (admin only, reads included)

| Method   | Path                                                         | Description                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/shared-access/state`                                | `SharedAccessState`: accesses (codes in clear, invitation links), gates with their armed switch, profiles, plugins a profile can be granted to.                                                       |
| `GET`    | `/api/v1/shared-access/journal?accessId=&limit=`             | Openings, refusals and changes, newest first. Kept a year, at most 50 000 lines.                                                                                                                      |
| `POST`   | `/api/v1/shared-access/accesses`                             | `{ label, gates: [{ equipmentId, value? }], withCode?, validFrom?, validUntil?, timeWindows? }`; a window is `{ from, to, days? }`, `days` ISO weekdays 1–7, none = every day. `201` with the access. |
| `PATCH`  | `/api/v1/shared-access/accesses/:id`                         | Same fields. On an access made by a plugin: `label`, `gates`, `timeWindows`, and `earlyOpenAt` / `extendedUntil`, which may only widen its dates.                                                     |
| `POST`   | `/api/v1/shared-access/accesses/:id/{suspend,resume,revoke}` | Hold, resume, revoke.                                                                                                                                                                                 |
| `POST`   | `/api/v1/shared-access/accesses/:id/code`                    | `{ cutPhones }` — a new code (when it has one) and a new link; the phones kept or cut off.                                                                                                            |
| `GET`    | `/api/v1/shared-access/accesses/:id/phones`                  | `{ phones: [{ id, platform, tag, firstSeenAt, lastSeenAt }] }` — `platform` is `iphone`, `ipad`, `android`, `mac`, `windows` or `other`.                                                              |
| `DELETE` | `/api/v1/shared-access/accesses/:id/phones/:phoneId`         | `204` — cuts that phone only. `404 unknown_phone`.                                                                                                                                                    |
| `DELETE` | `/api/v1/shared-access/accesses/:id`                         | `204`. `422 still_live` unless revoked or ended.                                                                                                                                                      |
| `GET`    | `/api/v1/shared-access/equipment/:id`                        | `{ armed, people }` for a gate's panel.                                                                                                                                                               |
| `PUT`    | `/api/v1/shared-access/equipment/:id`                        | `{ armed }` — the gate's armed switch.                                                                                                                                                                |
| `GET`    | `/api/v1/shared-access/profiles`                             | `{ profiles }`.                                                                                                                                                                                       |
| `POST`   | `/api/v1/shared-access/profiles`                             | `{ name, gates?, validFrom?, validUntil?, timeWindows?, withCode?, pluginId? }`.                                                                                                                      |
| `PATCH`  | `/api/v1/shared-access/profiles/:id`                         | Same fields.                                                                                                                                                                                          |
| `DELETE` | `/api/v1/shared-access/profiles/:id`                         | `204`. `422 default_profile` for the default one. The accesses made from it keep their gates.                                                                                                         |
| `GET`    | `/api/v1/shared-access/app`                                  | `{ name, customIcon, version }` — the visitor's page on a home screen.                                                                                                                                |
| `PUT`    | `/api/v1/shared-access/app`                                  | `{ name?, icons?: { "180", "192", "512": base64 PNG } \| null }` — `400 invalid_app` unless each is a PNG of its size, 256 KiB at most.                                                               |

Dates are ISO 8601, or `YYYY-MM-DDTHH:MM` read on the house's clock; `null` clears. Time windows are
`[{ "from": "08:00", "to": "20:00" }]`, not crossing midnight, not overlapping on a day they share. A
window may add `"days": [5]` (ISO weekdays, 1 = Monday … 7 = Sunday); without it, it is every day.

Errors are `{ "error": "<code>", "message": "..." }`: `no_gate`, `unknown_gate` (404),
`unsupported_equipment` (422, not a `gate`), `no_command`, `invalid_value`, `label_required`,
`end_before_start`, `window_crosses_midnight`, `windows_overlap`, `invalid_days`, `shorten_refused`, `still_live`,
`revoked` (409), `default_profile`, `not_found` (404).

### Public routes (the visitor's phone)

Outside authentication, **with no per-IP rate limit**: behind a reverse proxy it would be one limit
for the whole internet. Served twice, under `/api/v1/shared-access/public/*` and under the page as
`/access/api/*`, so an alias host rewriting everything to `/access/` needs no second rule. The
phone's token is sent as `Authorization: Bearer <token>`.

| Method | Path       | Description                                                                                                                                                                                                                                                            |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/enrol`   | `{ code }` or `{ link }` → `{ token, session }`. `401 unknown_code`, `410 ended`, `429 too_many`, `409 too_many_phones` (50 phones already set up on the access).                                                                                                      |
| `GET`  | `/session` | `{ label, status, gates, activeAt, nextOpeningAt, validUntil, travelS, presses }` — never the gate's state, except the `expected` / `outcome` of this phone's own tracked press (spec 188, amends spec 181 R4.16); `presses` are this phone's own. `401` when unknown. |
| `POST` | `/open`    | `{ gate }` → `{ ok: true, outcome?, expected?, windowS? }`, or `409 { ok: false, reason, activeAt?, nextOpeningAt? }`.                                                                                                                                                 |
| `GET`  | `/share`   | `{ url, qr }` — the invitation link and its QR code as a `data:image/svg+xml` URI. `409 ended`, `409 no_public_url`, `401` when unknown.                                                                                                                               |

**Outcome (spec 188).** When the gate's state is known at the press, `open` returns
`outcome: "pending"`, `expected: "open" | "close"` and `windowS` (how long the core waits for the
proof: 15 from closed, 60 from open), and that press in `session.presses` then carries `outcome` —
`pending`, `confirmed` or `unconfirmed` — and `expected`. The page reads the session every 2 s for
at most 70 s until it is `confirmed`, and keeps the disc locked over the longer of `travelS` and
`windowS`, and while the outcome is pending. A late report still confirms a press up to 5 min
after its window. The owner's journal entries carry the same `outcome` and `outcomeExpected`
(`null` when the press was not tracked, or was replaced by a newer tracked order on the gate).

A refusal `reason` is one of `revoked`, `suspended`, `not_yet`, `expired`, `outside_hours`,
`no_gate`, `not_this_gate`, `refused_by_house` (the gate is disarmed), `too_many_opens` (12 per hour
per access, 30 per hour per gate), `busy` (5 presses already wait on that gate), `gate_error` (the
gate's order failed, or did not answer within 15 s).

**Wrong codes.** Only failures are counted, globally, and a correct code is never slowed. The first
ten failures in ten minutes are answered at once, then 1 s, 2, 4, 8, up to 10 s; at most 32 answers
are held at once, past which a failure is answered `429 too_many` at once. Past 25 failures in the
window a `system.alarm.raised` is emitted under source `shared-access`.

### The page

`GET /access/` (and `app.js`, `style.css`, `manifest.webmanifest`, `icon.svg`) — HTML, CSS and
JavaScript of its own, with `Content-Security-Policy: default-src 'none'; script-src 'self'; ...`,
`X-Robots-Tag: noindex`, `Cache-Control: no-store`, and no cookie. The invitation link carries its
token in the fragment, `/access/#i=<token>`, which no server or log sees.

---

## MQTT Brokers

External MQTT brokers for outbound publishing.

| Method   | Path                       | Description                                                   |
| -------- | -------------------------- | ------------------------------------------------------------- |
| `GET`    | `/api/v1/mqtt-brokers`     | List all MQTT brokers.                                        |
| `POST`   | `/api/v1/mqtt-brokers`     | Create broker. Body: `{ name, url, username?, password? }`.   |
| `PUT`    | `/api/v1/mqtt-brokers/:id` | Update broker. Body: `{ name?, url?, username?, password? }`. |
| `DELETE` | `/api/v1/mqtt-brokers/:id` | Delete broker. Returns 204.                                   |

---

## MQTT Publishers

Outbound MQTT publishers that push Sowel data to external brokers. Each publisher targets a single MQTT topic and can have multiple data mappings (equipment, zone, or recipe sources). When `onChangeOnly` is enabled, the publisher only publishes when a value actually changes — useful to avoid flooding external displays with periodic heartbeats.

Each mapping carries its own `enabled` flag (default `true`). Disabled mappings are skipped in live publishing, the initial snapshot, and the manual "Test" button — so a seasonal source can be silenced without losing its source/key wiring. The publisher-level `enabled` flag still wins: if the publisher is off, all its mappings are off regardless of their per-mapping flag.

| Method   | Path                                              | Description                                                                                                                                                          |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mqtt-publishers`                         | List all publishers with mappings.                                                                                                                                   |
| `GET`    | `/api/v1/mqtt-publishers/:id`                     | Get publisher with mappings.                                                                                                                                         |
| `POST`   | `/api/v1/mqtt-publishers`                         | Create publisher. Body: `{ name, brokerId, topic, enabled?, onChangeOnly? }`.                                                                                        |
| `PUT`    | `/api/v1/mqtt-publishers/:id`                     | Update publisher. Body: `{ name?, brokerId?, topic?, enabled?, onChangeOnly? }`.                                                                                     |
| `DELETE` | `/api/v1/mqtt-publishers/:id`                     | Delete publisher. Returns 204.                                                                                                                                       |
| `POST`   | `/api/v1/mqtt-publishers/:id/test`                | Test publish a snapshot.                                                                                                                                             |
| `POST`   | `/api/v1/mqtt-publishers/:id/mappings`            | Add data mapping. Body: `{ publishKey, sourceType, sourceId, sourceKey, enabled? }`. `enabled` defaults to `true` when omitted.                                      |
| `PUT`    | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Update mapping. Accepts `{ publishKey?, sourceType?, sourceId?, sourceKey?, enabled? }` — the `enabled` flag toggles publishing on/off without deleting the mapping. |
| `DELETE` | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Delete mapping. Returns 204.                                                                                                                                         |

---

## Notification Publishers

Notifications triggered by data changes. The `channelType` is `telegram` or `web-push`. For `telegram`, `channelConfig` is `{ botToken, chatId }`. For `web-push`, `channelConfig` is `{}` (empty) — the channel broadcasts to every browser subscription registered via the Web Push routes below.

| Method   | Path                                                      | Description                                                                                                                                                                                                                                                        |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/notification-publishers`                         | List all notification publishers with mappings.                                                                                                                                                                                                                    |
| `GET`    | `/api/v1/notification-publishers/:id`                     | Get publisher with mappings.                                                                                                                                                                                                                                       |
| `POST`   | `/api/v1/notification-publishers`                         | Create publisher. Body: `{ name, channelType, channelConfig, enabled? }`.                                                                                                                                                                                          |
| `PUT`    | `/api/v1/notification-publishers/:id`                     | Update publisher.                                                                                                                                                                                                                                                  |
| `DELETE` | `/api/v1/notification-publishers/:id`                     | Delete publisher. Returns 204.                                                                                                                                                                                                                                     |
| `POST`   | `/api/v1/notification-publishers/:id/test-channel`        | Test the notification channel (sends a test message).                                                                                                                                                                                                              |
| `POST`   | `/api/v1/notification-publishers/:id/test`                | Test the full publisher (trigger mappings).                                                                                                                                                                                                                        |
| `POST`   | `/api/v1/notification-publishers/:id/mappings`            | Add trigger mapping. Body: `{ message, sourceType, sourceId, sourceKey, throttleMs?, repeatMs?, repeatMax? }`. `repeatMs` re-notifies every N ms while the value stays active (null = off); `repeatMax` caps the number of reminders (null = unlimited, spec 128). |
| `PUT`    | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Update mapping. Same fields as POST (all optional; `repeatMs`/`repeatMax` may be `null` to clear).                                                                                                                                                                 |
| `DELETE` | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Delete mapping. Returns 204.                                                                                                                                                                                                                                       |

### Web Push

Per-user browser subscriptions for the `web-push` channel. Requires a secure context (HTTPS) on the client. The server holds a single VAPID key pair, generated on first boot; the private key is never exposed.

| Method   | Path                             | Description                                                                                                                                            |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/push/vapid-public-key`  | The VAPID public key the browser subscribes with. Returns `{ publicKey }`.                                                                             |
| `GET`    | `/api/v1/push/subscriptions`     | List the authenticated user's device subscriptions, with `label?`, `lastSentAt?`, `lastSuccessAt?`, `lastError?` and `consecutiveFailures` (spec 199). |
| `POST`   | `/api/v1/push/subscriptions`     | Register/upsert this device. Body: `{ endpoint, keys: { p256dh, auth }, userAgent? }`. Upserts by endpoint.                                            |
| `DELETE` | `/api/v1/push/subscriptions`     | Remove this device. Body: `{ endpoint }`. Returns 204.                                                                                                 |
| `PATCH`  | `/api/v1/push/subscriptions/:id` | Name one of the caller's devices. Body: `{ label: string \| null }` (60 chars max; `null` or blank clears it). 404 when the id is not the caller's.    |
| `DELETE` | `/api/v1/push/subscriptions/:id` | Remove one of the caller's devices by id. Returns 204; 404 when the id is not the caller's.                                                            |

Each send records its outcome on the subscription (spec 199): `lastSuccessAt` is the last time the push service **accepted** a push (2xx), which does not prove the device displayed it; `lastError` and `consecutiveFailures` describe the failures since. A 404/410 deletes the subscription at once, and so does a fifth refusal in a row (a 4xx other than 429). A network error, a 5xx or a 429 is recorded in `lastError` without counting toward it.

---

## Button Actions

Map physical button presses (Zigbee buttons, etc.) to actions (mode activation, equipment orders, recipe toggles).

| Method   | Path                                                | Description                                                                                                                                    |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/equipments/:id/action-bindings`            | List action bindings for a button equipment.                                                                                                   |
| `POST`   | `/api/v1/equipments/:id/action-bindings`            | Create binding. Body: `{ actionValue, effectType, config }`. Effect types: `mode_activate`, `mode_toggle`, `equipment_order`, `recipe_toggle`. |
| `PUT`    | `/api/v1/equipments/:id/action-bindings/:bindingId` | Update binding.                                                                                                                                |
| `DELETE` | `/api/v1/equipments/:id/action-bindings/:bindingId` | Delete binding. Returns 204.                                                                                                                   |

---

## Activity

Recent engine events for the zone-view activity panel. 7-day retention, capped at 2000 entries, persisted in SQLite and reloaded on boot. See [Zones — Activity feed](../user/zones.md#activity-feed) for the user-facing description.

| Method | Path               | Description                                                                                                                  |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/activity` | List activity items. Query: `?zoneId=<uuid>&includeDescendants=true&limit=100`. `limit` is clamped to [1, 200], default 100. |

Filtering: items whose `zoneId` matches the query parameter are returned, plus items whose `zoneId` is `null` (global events: mode changes, sunrise/sunset, system alarms). When `includeDescendants=true` (default), items from child zones are also returned.

Response shape:

```json
{
  "items": [
    {
      "id": "uuid",
      "timestamp": 1715864400000,
      "category": "order",
      "zoneId": "uuid-of-living-room",
      "message": {
        "template": "order.executed",
        "params": { "equipmentName": "Lumière", "alias": "state", "value": "ON" }
      },
      "source": { "kind": "recipe", "instanceId": "...", "recipeName": "Motion Light" }
    }
  ]
}
```

Item categories: `order`, `motion`, `recipe`, `mode`, `sunlight`, `alarm`.

Source kinds: `recipe`, `mode`, `manual`, `button`, `external`. The `source` field is only present on `category=order` items.

---

## Logs (Admin)

Admin-only log access from the in-memory ring buffer.

| Method | Path                 | Description                                                                                                                                     |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/logs`       | Query logs. Query: `?limit=100&level=error&module=mqtt&search=text&since=ISO`. Returns entries, capacity, current level, and available modules. |
| `GET`  | `/api/v1/logs/level` | Get current runtime log level.                                                                                                                  |
| `PUT`  | `/api/v1/logs/level` | Change runtime log level. Body: `{ level }`. Valid: `debug`, `info`, `warn`, `error`, `fatal`, `silent`.                                        |

---

## Backup (Admin)

Admin-only full configuration backup and restore.

| Method | Path             | Description                                                                                       |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/backup` | Export full configuration. Returns ZIP (SQLite JSON + InfluxDB CSVs) or JSON if no InfluxDB data. |
| `POST` | `/api/v1/backup` | Restore configuration from JSON backup. Body: backup payload with `{ version: 1, tables }`.       |

---

## Health

No authentication required, but the payload depends on it.

| Method | Path             | Description                                                                       |
| ------ | ---------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/health` | System health check. Always answers `200`, never `401`. See the two shapes below. |

**Anonymous** — liveness only, which is what a readiness probe or an uptime monitor needs:

```json
{ "status": "ok", "uptime": { "ms": 10212688, "human": "2h 50m" } }
```

**Authenticated** — send a JWT or an API token in the `Authorization` header to also get the
integration statuses, the device counts and the engine version:

```json
{
  "status": "ok",
  "uptime": { "ms": 10212688, "human": "2h 50m" },
  "integrations": { "zigbee2mqtt": { "status": "connected" } },
  "devices": { "total": 110, "online": 100, "offline": 4, "unknown": 6 },
  "version": "1.69.0"
}
```

The engine version and the installed plugin list are reconnaissance material, so they are not
served anonymously (issue #926). A token that is absent, malformed or expired degrades to the
anonymous shape rather than failing, so a monitor is never broken by a stale credential.

---

## WebSocket

**Endpoint**: `ws://<host>:3000/ws?token=<jwt_or_api_token>`

Authentication is passed via the `token` query parameter. Both JWT access tokens and API tokens (`swl_` prefix) are accepted.

### Connection

On connection, the server sends a welcome message:

```json
{ "type": "connected", "message": "Connected to Sowel engine", "version": "0.1.0" }
```

Clients are automatically subscribed to the `system` topic.

### Subscribing to Topics

Send a JSON message to subscribe to additional topics:

```json
{ "type": "subscribe", "topics": ["devices", "equipments", "zones", "modes", "recipes"] }
```

**Available topics**: `devices`, `equipments`, `zones`, `modes`, `recipes`, `calendar`, `mqtt-publishers`, `system`, `logs`, `activity`, `energy`.

The `system` topic is always included regardless of subscription.

### Event Delivery

Events are batched every 200ms and sent as a JSON array. High-frequency data events are deduplicated per batch -- only the latest value per device/equipment/zone key is sent.

```json
[
  { "type": "device.data.updated", "deviceId": "...", "key": "temperature", "value": 22.5 },
  { "type": "equipment.data.changed", "equipmentId": "...", "alias": "state", "value": "ON" },
  {
    "type": "equipment.status.changed",
    "equipmentId": "...",
    "equipmentName": "Compteur Shelly",
    "oldStatus": "online",
    "newStatus": "offline"
  },
  { "type": "zone.data.changed", "zoneId": "...", "key": "temperature", "value": 21.8 }
]
```

The `equipment.status.changed` event (spec 116) is emitted by the EquipmentStatusTracker on every transition between `online` / `degraded` / `offline`. Deduplicated per equipment ID per batch.

### Role filtering (security audit S01)

Two things about a client's role are enforced at delivery, not merely at subscription time.

**Admin-only streams.** The `mqtt-publishers` and `logs` topics are silently dropped from a non-admin's subscription request, and `notification-publisher.*` events are never delivered to a non-admin even though they route to the shared `system` topic, because they carry the publisher's channel configuration (a Telegram bot token, for instance).

**Free-form strings.** `system.error`, `system.update.error` and `system.update.progress` carry operator-facing prose assembled at the call site rather than values a schema constrains. Their message field is replaced with `"[redacted]"` for non-admin clients. The event itself is still delivered, and its structured fields (`step`, for instance) survive, so a non-admin client watching an update in progress still sees the overlay: what it stops receiving is a string the UI never rendered. No secret flows there today; the redaction exists so that keeping it that way does not depend on every future author remembering (issue #651).

**What is deliberately not redacted.** `system.alarm.raised` and `.resolved` carry free-form text too, and it is the most exposed of the lot: `equipment-manager.ts` interpolates a raw driver error into it, and any third-party plugin may emit the type. But that string is _rendered_: it is the fallback text for alarms the UI has no i18n key for, so redacting it would blank the header issue banner for every non-admin client, and it would close nothing, because `activity-buffer.ts` mirrors the same prose into `activity.added` on a topic every role may subscribe to. Treat alarm text as visible to every authenticated client. The real fix is the migration to `messageKey` / `messageParams`, so the driver error stops being the payload.

### Activity Stream

When subscribed to the `activity` topic, the server pushes new items as they are produced. Each push is a single event (not batched), shape identical to the items returned by `GET /api/v1/activity`:

```json
{
  "type": "activity.added",
  "item": {
    "id": "uuid",
    "timestamp": 1715864400000,
    "category": "motion",
    "zoneId": "uuid-of-zone",
    "message": { "template": "motion.detected", "params": { "equipmentName": "PIR Living Room" } }
  }
}
```

Clients must filter the live stream by their current zone scope (the server broadcasts all items to subscribers without per-client zone filtering).

### Log Streaming

When subscribed to the `logs` topic, log entries are streamed individually (not batched):

```json
{
  "type": "log.entry",
  "level": "info",
  "module": "devices",
  "msg": "Device discovered",
  "time": 1700000000
}
```

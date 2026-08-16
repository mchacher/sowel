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

Two roles exist: `admin` and `standard`. Reads (`GET`) are available to any
authenticated user. **All configuration mutations are admin-only** (spec 131): a
`standard` user gets `403 { "error": "Admin access required" }` on any
`POST/PUT/PATCH/DELETE` except the usage/personal allowlist below. Sections tagged
**(Admin)** require the admin role; the gate is fail-closed, so any mutating
endpoint not in the allowlist is admin-only.

**Standard write allowlist** (the only mutations a `standard` may perform):

| Method        | Path                                                                                                      | Purpose               |
| ------------- | --------------------------------------------------------------------------------------------------------- | --------------------- |
| POST          | `/api/v1/equipments/:id/orders/:alias`                                                                    | Actuate an equipment  |
| POST          | `/api/v1/zones/:id/orders/:orderKey`                                                                      | Zone command          |
| PUT           | `/api/v1/me`, `/api/v1/me/preferences`, `/api/v1/me/password`                                             | Own account           |
| POST / DELETE | `/api/v1/me/tokens[/:id]`                                                                                 | Own API tokens        |
| POST / DELETE | `/api/v1/me/mfa/totp/setup`, `/totp/confirm`, `/totp`, `/backup-codes/regenerate`, `/trusted-devices/:id` | Own MFA (spec 151)    |
| POST / DELETE | `/api/v1/push/subscriptions`                                                                              | Own push subscription |
| POST          | `/api/v1/auth/logout`                                                                                     | End own session       |

An API token inherits its creator's role, so a standard-scoped token is subject to
the same gate (no privilege escalation).

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

### Equipment status (spec 116)

`GET /equipments` and `GET /equipments/:id` include two derived fields:

- `status: "online" | "degraded" | "offline"` — computed in memory from the backing devices' `status` and the freshness of streaming bindings.
  - `offline`: every bound device is `offline`, OR the equipment has no device bindings.
  - `degraded`: at least one device is `offline`, OR at least one streaming binding (`power`, `temperature`, etc.) has not been refreshed within its category timeout.
  - `online`: everything healthy.
- `statusReason?: { offlineDevices: string[]; staleBindings: string[]; offlineSince: string | null }` — present only when status ≠ `online`. Used by the UI tooltip.

Each entry of `dataBindings[]` also gains `stale: boolean`. Only streaming categories ever flip to `true`; event-based categories (motion, contact_door, action, light_state, shutter_position, etc.) are always `false`.

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

### Recipe Instances

| Method   | Path                                   | Description                                                       |
| -------- | -------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/api/v1/recipe-instances`             | List all active recipe instances.                                 |
| `POST`   | `/api/v1/recipe-instances`             | Create instance. Body: `{ recipeId, params }`.                    |
| `PUT`    | `/api/v1/recipe-instances/:id`         | Update instance params. Body: `{ params }`.                       |
| `DELETE` | `/api/v1/recipe-instances/:id`         | Stop and delete instance. Returns 204.                            |
| `POST`   | `/api/v1/recipe-instances/:id/enable`  | Enable a disabled instance.                                       |
| `POST`   | `/api/v1/recipe-instances/:id/disable` | Disable (pause) a running instance.                               |
| `POST`   | `/api/v1/recipe-instances/:id/actions` | Send an action to a running recipe. Body: `{ action, payload? }`. |
| `GET`    | `/api/v1/recipe-instances/:id/log`     | Get execution log. Query: `?limit=50`.                            |

---

## Dashboard

| Method   | Path                              | Description                                                                             |
| -------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/dashboard/widgets`       | List all dashboard widgets ordered by display order.                                    |
| `POST`   | `/api/v1/dashboard/widgets`       | Create widget (admin). Body: `{ type, equipmentId?, zoneId?, family?, label?, icon? }`. |
| `PATCH`  | `/api/v1/dashboard/widgets/:id`   | Update widget label, icon, or config (admin). Body: `{ label?, icon?, config? }`.       |
| `DELETE` | `/api/v1/dashboard/widgets/:id`   | Delete widget (admin). Returns 204.                                                     |
| `PUT`    | `/api/v1/dashboard/widgets/order` | Reorder widgets (admin). Body: `{ order: string[] }`.                                   |

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

| Method | Path                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/energy/status`                      | Energy module status (available, sources, `tariffConfigured`). Spec 123: `tariffConfigured` is `true` iff at least one of `prices.hp` / `prices.hc` is > 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`  | `/api/v1/energy/history`                     | Query energy history. Query: `?period=day&date=2026-01-15`. Periods: `day` (24 hourly buckets), `week` (7 daily buckets Mon-Sun), `month` (28-31 daily buckets), `year` (12 monthly buckets). Always returns N points; empty buckets are zero-filled (`hp = hc = prod = autoconso = injection = 0`). Bucket boundaries align with the server's local TZ (`TZ` env, defaults to `Europe/Paris`). HP / HC are summed per bucket from InfluxDB's pre-split `energy_hp` / `energy_hc` series. **Spec 123**: each point and the totals also carry `cost_hp` / `cost_hc` / `cost_total` (€, 4 decimals), computed at read time from the current `TariffPrices`. Per-point cost is raw consumption × price; totals cost is grid-side (autoconso-subtracted) × price. When no tariff is configured every cost field is 0. |
| `GET`  | `/api/v1/energy/by-usage`                    | Per-submeter consumption time series for the same period buckets as `/energy/history` (same N-points-per-period and zero-fill semantics). Query: `?period=day&date=2026-01-15`. Returns one series per submeter `energy_meter` plus an `other` residual (`max(0, total - Σ submeters)`) and per-equipment totals. **Spec 123**: each `SubmeterSeries` carries a `cost` (€) and `totals` adds `costByEquipment` / `otherCost` / `totalCost` (€). Costs use a single period-blended €/kWh = `cost_total / (total_consumption / 1000)` derived from the matching `/energy/history` totals. When there is no main meter or no consumption, every cost field is 0.                                                                                                                                                     |
| `GET`  | `/api/v1/settings/energy/tariff`             | Get tariff configuration (HP/HC schedules and prices).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PUT`  | `/api/v1/settings/energy/tariff`             | Update tariff configuration. Body: `{ schedules, prices }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET`  | `/api/v1/energy/arbiter`                     | Spec 140 — capacity arbiter read model: `{ enabled, state, availableSurplusW, productionDetected, grants, pending, suspensions, journal, surplusSeries }`. The decision journal is a bounded ring (200 entries) and carries no prices. Any authenticated user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST` | `/api/v1/energy/arbiter/resume/:equipmentId` | Spec 140 — lift a manual-override suspension immediately ("resume control now", FR-6). Admin only. 404 when the equipment has no active suspension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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

| Method   | Path                            | Description                                                                                                 |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/push/vapid-public-key` | The VAPID public key the browser subscribes with. Returns `{ publicKey }`.                                  |
| `GET`    | `/api/v1/push/subscriptions`    | List the authenticated user's device subscriptions.                                                         |
| `POST`   | `/api/v1/push/subscriptions`    | Register/upsert this device. Body: `{ endpoint, keys: { p256dh, auth }, userAgent? }`. Upserts by endpoint. |
| `DELETE` | `/api/v1/push/subscriptions`    | Remove this device. Body: `{ endpoint }`. Returns 204.                                                      |

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

Recent engine events for the zone-view activity panel. Reads from the in-memory ring buffer (24h retention, capped at 2000 entries, reset on restart). See [Zones — Activity feed](../user/zones.md#activity-feed) for the user-facing description.

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

No authentication required.

| Method | Path             | Description                                                                                           |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/health` | System health check. Returns status, uptime, integration statuses, device counts, and engine version. |

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

**Available topics**: `devices`, `equipments`, `zones`, `modes`, `recipes`, `calendar`, `mqtt-publishers`, `system`, `logs`, `activity`.

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

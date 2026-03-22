# API Reference

Sowel exposes a REST API under `/api/v1/` and a WebSocket endpoint at `/ws`. All endpoints require authentication unless noted otherwise. Responses use JSON.

**Base URL**: `http://<host>:3000`

**Authentication**: Pass a JWT access token as `Authorization: Bearer <token>` header, or an API token as `Authorization: Bearer swl_<token>`.

---

## Table of Contents

- [Authentication](#authentication)
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
- [Logs (Admin)](#logs-admin)
- [Backup (Admin)](#backup-admin)
- [Health](#health)
- [WebSocket](#websocket)

---

## Authentication

Public endpoints -- no auth required for `status` and `setup`.

| Method | Path                   | Description                                                                                                               |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/auth/status`  | Check if first-run setup is required. Returns `{ setupRequired: boolean }`.                                               |
| `POST` | `/api/v1/auth/setup`   | Create the first admin user (first-run only). Body: `{ username, password, displayName, language? }`. Returns JWT tokens. |
| `POST` | `/api/v1/auth/login`   | Authenticate. Body: `{ username, password }`. Returns `{ accessToken, refreshToken }`. Rate limited: 10 req/min.          |
| `POST` | `/api/v1/auth/refresh` | Refresh access token. Body: `{ refreshToken }`. Returns new token pair.                                                   |
| `POST` | `/api/v1/auth/logout`  | Invalidate refresh token. Body: `{ refreshToken }`. Returns 204.                                                          |

---

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

| Method   | Path                | Description                                                     |
| -------- | ------------------- | --------------------------------------------------------------- |
| `GET`    | `/api/v1/users`     | List all users.                                                 |
| `POST`   | `/api/v1/users`     | Create user. Body: `{ username, password, displayName, role }`. |
| `PUT`    | `/api/v1/users/:id` | Update user. Body: `{ displayName?, role?, enabled? }`.         |
| `DELETE` | `/api/v1/users/:id` | Delete user. Cannot delete self or last admin. Returns 204.     |

---

## Devices

| Method   | Path                      | Description                                                                       |
| -------- | ------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/devices`         | List all devices with current data and orders.                                    |
| `GET`    | `/api/v1/devices/:id`     | Get device with data and orders.                                                  |
| `PUT`    | `/api/v1/devices/:id`     | Update device. Body: `{ name?, zoneId? }`.                                        |
| `DELETE` | `/api/v1/devices/:id`     | Remove device. Returns 204.                                                       |
| `GET`    | `/api/v1/devices/suggest` | Suggest compatible devices for an equipment type. Query: `?type=<equipmentType>`. |
| `GET`    | `/api/v1/devices/:id/raw` | Get raw integration expose data for a device.                                     |

---

## Equipments

| Method   | Path                                   | Description                                                                                                                            |
| -------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/equipments`                   | List all equipments with bindings and current data.                                                                                    |
| `GET`    | `/api/v1/equipments/:id`               | Get equipment with bindings and current data.                                                                                          |
| `POST`   | `/api/v1/equipments`                   | Create equipment. Body: `{ name, type, zoneId, icon?, description?, deviceIds? }`. If `deviceIds` provided, auto-bindings are created. |
| `PUT`    | `/api/v1/equipments/:id`               | Update equipment. Body: `{ name?, type?, zoneId?, icon?, description?, enabled? }`.                                                    |
| `DELETE` | `/api/v1/equipments/:id`               | Delete equipment. Returns 204.                                                                                                         |
| `POST`   | `/api/v1/equipments/:id/orders/:alias` | Execute an equipment order. Body: `{ value }`.                                                                                         |

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

| Method | Path                             | Description                                                                                                                                       |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/energy/status`          | Energy module status (available, sources, tariff configured).                                                                                     |
| `GET`  | `/api/v1/energy/history`         | Query energy history. Query: `?period=day&date=2026-01-15`. Periods: `day`, `week`, `month`, `year`. Returns HP/HC breakdown and production data. |
| `GET`  | `/api/v1/settings/energy/tariff` | Get tariff configuration (HP/HC schedules and prices).                                                                                            |
| `PUT`  | `/api/v1/settings/energy/tariff` | Update tariff configuration. Body: `{ schedules, prices }`.                                                                                       |

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

| Method | Path                            | Description                                                  |
| ------ | ------------------------------- | ------------------------------------------------------------ |
| `GET`  | `/api/v1/plugins`               | List installed plugins.                                      |
| `GET`  | `/api/v1/plugins/store`         | List available plugins from the registry.                    |
| `POST` | `/api/v1/plugins/install`       | Install from GitHub. Body: `{ repo }` (e.g. `"owner/repo"`). |
| `POST` | `/api/v1/plugins/:id/uninstall` | Uninstall a plugin.                                          |
| `POST` | `/api/v1/plugins/:id/enable`    | Enable a plugin (loads and starts it).                       |
| `POST` | `/api/v1/plugins/:id/disable`   | Disable a plugin (stops and unloads it).                     |

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

Outbound MQTT publishers that push Sowel data to external brokers.

| Method   | Path                                              | Description                                                                |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mqtt-publishers`                         | List all publishers with mappings.                                         |
| `GET`    | `/api/v1/mqtt-publishers/:id`                     | Get publisher with mappings.                                               |
| `POST`   | `/api/v1/mqtt-publishers`                         | Create publisher. Body: `{ name, brokerId, topic, enabled? }`.             |
| `PUT`    | `/api/v1/mqtt-publishers/:id`                     | Update publisher.                                                          |
| `DELETE` | `/api/v1/mqtt-publishers/:id`                     | Delete publisher. Returns 204.                                             |
| `POST`   | `/api/v1/mqtt-publishers/:id/test`                | Test publish a snapshot.                                                   |
| `POST`   | `/api/v1/mqtt-publishers/:id/mappings`            | Add data mapping. Body: `{ publishKey, sourceType, sourceId, sourceKey }`. |
| `PUT`    | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Update mapping.                                                            |
| `DELETE` | `/api/v1/mqtt-publishers/:id/mappings/:mappingId` | Delete mapping. Returns 204.                                               |

---

## Notification Publishers

Push notifications (currently Telegram) triggered by data changes.

| Method   | Path                                                      | Description                                                                             |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/notification-publishers`                         | List all notification publishers with mappings.                                         |
| `GET`    | `/api/v1/notification-publishers/:id`                     | Get publisher with mappings.                                                            |
| `POST`   | `/api/v1/notification-publishers`                         | Create publisher. Body: `{ name, channelType, channelConfig, enabled? }`.               |
| `PUT`    | `/api/v1/notification-publishers/:id`                     | Update publisher.                                                                       |
| `DELETE` | `/api/v1/notification-publishers/:id`                     | Delete publisher. Returns 204.                                                          |
| `POST`   | `/api/v1/notification-publishers/:id/test-channel`        | Test the notification channel (sends a test message).                                   |
| `POST`   | `/api/v1/notification-publishers/:id/test`                | Test the full publisher (trigger mappings).                                             |
| `POST`   | `/api/v1/notification-publishers/:id/mappings`            | Add trigger mapping. Body: `{ message, sourceType, sourceId, sourceKey, throttleMs? }`. |
| `PUT`    | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Update mapping.                                                                         |
| `DELETE` | `/api/v1/notification-publishers/:id/mappings/:mappingId` | Delete mapping. Returns 204.                                                            |

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

**Available topics**: `devices`, `equipments`, `zones`, `modes`, `recipes`, `calendar`, `mqtt-publishers`, `system`, `logs`.

The `system` topic is always included regardless of subscription.

### Event Delivery

Events are batched every 200ms and sent as a JSON array. High-frequency data events are deduplicated per batch -- only the latest value per device/equipment/zone key is sent.

```json
[
  { "type": "device.data.updated", "deviceId": "...", "key": "temperature", "value": 22.5 },
  { "type": "equipment.data.changed", "equipmentId": "...", "alias": "state", "value": "ON" },
  { "type": "zone.data.changed", "zoneId": "...", "key": "temperature", "value": 21.8 }
]
```

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

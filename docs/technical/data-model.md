# Sowel -- Data Model

> Version: 2.0 -- 2026-05-10
>
> This index covers the cross-cutting parts of Sowel's data model: the three-layer architecture, the entity relationship diagram, the plugin distribution layer, the reactive data flow, the event bus events, and the API surface.
>
> Per-entity details are split across five focused pages aligned with the core concepts:
>
> - [Devices](data-model/devices.md) -- physical layer, normalized data model
> - [Equipments](data-model/equipments.md) -- functional units, bindings, computed data
> - [Zones](data-model/zones.md) -- spatial topology, aggregation rules, auto-orders
> - [Modes](data-model/modes.md) -- orchestration, button bindings, calendar scheduling
> - [Recipes](data-model/recipes.md) -- automation templates, instances, runtime helpers

---

## 1. Three-Layer Architecture

Sowel separates concerns into three distinct layers, with orchestration entities (Modes, Recipes, Calendars) operating across them.

```
+-------------------------------------------------------------+
|  ORCHESTRATION                                              |
|  Modes  --  Recipes  --  Calendars  --  Buttons             |
|  Cross-cutting state machines that drive Equipments / Zones |
+-------------------------------------------------------------+
|  LAYER 1 -- TOPOLOGY (Zones)                                |
|  Spatial structure of the home                              |
|  Hierarchical: Home -> Floor -> Room                        |
|  Aggregates data automatically from child Equipments        |
+-------------------------------------------------------------+
|  LAYER 2 -- FUNCTIONAL (Equipments)                         |
|  What the user sees and controls                            |
|  Placed IN a Zone                                           |
|  Binds to one or more physical Devices                      |
+-------------------------------------------------------------+
|  LAYER 3 -- PHYSICAL (Devices)                              |
|  Hardware discovered from integration plugins               |
|  Auto-discovered, raw data and orders                       |
|  Never directly manipulated by the end user                 |
+-------------------------------------------------------------+
```

**Guiding principle**: A Device is what's on the network. An Equipment is what's in the room.

---

---

## 2. Entity Relationship Diagram

```
Plugin (PackageType: integration | recipe)
 +-- (integration) discovers --> Device
 +-- (recipe)      registers --> RecipeDefinition

Zone (hierarchy: parent -> children)
 |
 +-- Equipment (functional unit, user-facing)
      +-- DataBinding  --> DeviceData  (readable, alias-named)
      +-- OrderBinding --> DeviceOrder (writable, alias-named)
      +-- ComputedDataEntry (provider-supplied, no DB row)

Device (physical, auto-discovered, optional zoneId)
 +-- DeviceData  (readable properties)
 +-- DeviceOrder (writable commands)

Mode --< ZoneModeImpact >-- Zone
                            |
                            actions: order | recipe_toggle | recipe_params

RecipeInstance --(params)--> RecipeDefinition (from a recipe plugin)
 +-- RecipeState (key/value store, persisted)
 +-- RecipeLog  (event log)

CalendarProfile --< CalendarSlot (cron-scheduled mode changes)

ButtonActionBinding (Equipment.action -> mode/order/recipe/zone-order)
```

---

## 3. Plugin

Since spec 053, **everything that ships out of band is a plugin** -- both integrations and recipes. The PackageManager downloads them from GitHub and the appropriate loader (PluginLoader for integrations, RecipeLoader for recipes) instantiates them at runtime.

### 3.1 Interfaces

```typescript
type PackageType = "integration" | "recipe";

interface PluginManifest {
  id: string; // unique plugin id, used in DB and registry
  name: string;
  version: string; // semver
  description: string;
  icon: string; // Lucide icon name
  repo: string; // GitHub owner/repo -- required for backup/restore reinstall
  type?: PackageType; // defaults to "integration"
  author?: string;
  sowelVersion?: string; // minimum compatible Sowel version
  settings?: IntegrationSettingDef[];
}

interface InstalledPackage {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  type: PackageType;
}

interface PluginInfo extends Omit<InstalledPackage, "type"> {
  status: IntegrationStatus; // connected | disconnected | error | not_configured
  deviceCount: number;
  offlineDeviceCount: number;
  latestVersion?: string; // populated when registry has a newer version
}
```

### 3.2 SQLite Schema

```sql
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,                    -- manifest.id
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  manifest TEXT NOT NULL,                 -- JSON: full PluginManifest
  type TEXT NOT NULL DEFAULT 'integration',
  source TEXT NOT NULL DEFAULT 'registry',-- spec 136: 'registry' | 'personal'
  pinned_sha256 TEXT                      -- spec 136: TOFU hash (personal only)
);

-- Spec 136: admin-added GitHub repos serving as personal plugin sources
CREATE TABLE plugin_sources (
  repo TEXT PRIMARY KEY,                  -- "owner/repo"
  added_at TEXT NOT NULL
);
```

Integration settings are stored in the generic `settings` table under keys like `integration.<id>.<settingKey>`.

---

---

## 4. Reactive Data Flow

The complete event-driven pipeline:

```
Integration message (MQTT, cloud API poll, etc.)
  |
  v
Integration Plugin (receives + parses)
  |
  v
Device Manager (updates DeviceData, persists, emits)
  |
  +--> Event: "device.data.updated"
  |
  v
Equipment Manager
  +-- Updates bound aliases via DataBindings
  +-- Pulls ComputedDataEntry from registered providers (energy, pool, ...)
  |
  +--> Event: "equipment.data.changed"
  |
  +--> Button Action Manager (if alias=="action")
  |     +-- Dispatches: mode activate/toggle, equipment order, recipe toggle, zone order
  |
  v
Zone Aggregator
  +-- Recomputes Zone aggregated data, propagates up the tree
  |
  +--> Event: "zone.data.changed"
  |
  v
Recipe Engine
  +-- Each running RecipeInstance reacts via its createInstance() handle
  +-- May emit equipment orders (back into the equipment manager)
  |
  +--> Events: "recipe.instance.state.changed" / ".error"
  |
  v
Side effects (parallel, all subscribe to the bus)
  +-- WebSocket Server                 -> pushes events to UI clients
  +-- History Writer                   -> writes points to InfluxDB
  +-- MQTT Publishers                  -> emit on configured outbound topics
  +-- Notification Publishers          -> Telegram/webhook on threshold

Mode/Calendar/Button paths:
  CalendarManager (cron)  -> ModeManager.activate/deactivate
  ButtonActionBinding     -> ModeManager / EquipmentManager / RecipeManager / Zone order
  ModeManager.activate    -> equipment orders + recipe toggles + recipe param updates
```

---

## 5. Event Bus Events

All events are typed via `EngineEvent`, a TypeScript discriminated union. Handlers must never throw (wrap in try/catch + structured log).

### System

| Event                             | Payload                           |
| --------------------------------- | --------------------------------- |
| `system.started`                  | --                                |
| `system.integration.connected`    | `integrationId`                   |
| `system.integration.disconnected` | `integrationId`                   |
| `system.error`                    | `error`                           |
| `system.alarm.raised`             | `alarmId, level, source, message` |
| `system.alarm.resolved`           | `alarmId, source, message`        |
| `system.update.available`         | `current, latest, releaseUrl`     |
| `system.update.progress`          | `step, message`                   |
| `system.update.error`             | `error`                           |
| `system.restart_required`         | `reason`                          |

### Device

| Event                   | Payload                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `device.discovered`     | `device: Device`                                                                  |
| `device.removed`        | `deviceId, deviceName`                                                            |
| `device.status_changed` | `deviceId, deviceName, status`                                                    |
| `device.data.updated`   | `deviceId, deviceName, dataId, key, value, previous, timestamp, sourceTimestamp?` |
| `device.heartbeat`      | `deviceId, timestamp`                                                             |

### Zone

| Event               | Payload                                      |
| ------------------- | -------------------------------------------- |
| `zone.created`      | `zone: Zone`                                 |
| `zone.updated`      | `zone: Zone`                                 |
| `zone.removed`      | `zoneId, zoneName`                           |
| `zone.data.changed` | `zoneId, aggregatedData: ZoneAggregatedData` |

### Equipment

| Event                      | Payload                                                 |
| -------------------------- | ------------------------------------------------------- |
| `equipment.created`        | `equipment: Equipment`                                  |
| `equipment.updated`        | `equipment: Equipment`                                  |
| `equipment.removed`        | `equipmentId, equipmentName, zoneId`                    |
| `equipment.data.changed`   | `equipmentId, alias, value, previous, sourceTimestamp?` |
| `equipment.order.executed` | `equipmentId, orderAlias, value`                        |
| `equipment.order.failed`   | `equipmentId, orderAlias, value, error`                 |

### Recipe

| Event                           | Payload                       |
| ------------------------------- | ----------------------------- |
| `recipe.instance.created`       | `instanceId, recipeId`        |
| `recipe.instance.removed`       | `instanceId, recipeId`        |
| `recipe.instance.started`       | `instanceId, recipeId`        |
| `recipe.instance.stopped`       | `instanceId, recipeId`        |
| `recipe.instance.state.changed` | `instanceId, recipeId`        |
| `recipe.instance.error`         | `instanceId, recipeId, error` |

### Mode / Calendar / Sunlight / Settings

| Event                      | Payload                  |
| -------------------------- | ------------------------ |
| `mode.created`             | `mode: Mode`             |
| `mode.updated`             | `mode: Mode`             |
| `mode.removed`             | `modeId, modeName`       |
| `mode.activated`           | `modeId, modeName`       |
| `mode.deactivated`         | `modeId, modeName`       |
| `calendar.profile.changed` | `profileId, profileName` |
| `sunlight.changed`         | --                       |
| `settings.changed`         | `keys: string[]`         |

### MQTT / Notification publishers

| Event                                         | Payload                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `mqtt-broker.created` / `.updated`            | `broker: MqttBroker`                                 |
| `mqtt-broker.removed`                         | `brokerId`                                           |
| `mqtt-publisher.created` / `.updated`         | `publisher: MqttPublisher`                           |
| `mqtt-publisher.removed`                      | `publisherId, publisherName`                         |
| `mqtt-publisher.mapping.created`              | `publisherId, mapping: MqttPublisherMapping`         |
| `mqtt-publisher.mapping.removed`              | `publisherId, mappingId`                             |
| `notification-publisher.created` / `.updated` | `publisher: NotificationPublisher`                   |
| `notification-publisher.removed`              | `publisherId, publisherName`                         |
| `notification-publisher.mapping.created`      | `publisherId, mapping: NotificationPublisherMapping` |
| `notification-publisher.mapping.removed`      | `publisherId, mappingId`                             |

---

## 6. API Endpoints Summary

This is a non-exhaustive index. See [API Reference](api-reference.md) for the full surface.

### Zones

| Method | Route                                | Description                     |
| ------ | ------------------------------------ | ------------------------------- |
| GET    | `/api/v1/zones`                      | List all zones (tree structure) |
| GET    | `/api/v1/zones/:id`                  | Get zone with aggregated data   |
| POST   | `/api/v1/zones`                      | Create zone                     |
| PUT    | `/api/v1/zones/:id`                  | Update zone                     |
| DELETE | `/api/v1/zones/:id`                  | Delete zone                     |
| POST   | `/api/v1/zones/:id/orders/:orderKey` | Execute zone-level bulk order   |

### Equipments

| Method | Route                                    | Description                                                  |
| ------ | ---------------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/v1/equipments`                     | List all equipments                                          |
| GET    | `/api/v1/equipments/:id`                 | Get equipment with bindings + data                           |
| POST   | `/api/v1/equipments`                     | Create equipment                                             |
| PUT    | `/api/v1/equipments/:id`                 | Update equipment                                             |
| DELETE | `/api/v1/equipments/:id`                 | Delete equipment                                             |
| POST   | `/api/v1/equipments/:id/orders/:alias`   | Execute an equipment order                                   |
| GET    | `/api/v1/equipments/:id/camera/snapshot` | Camera media proxy — current frame (binding-gated, spec 133) |
| GET    | `/api/v1/equipments/:id/camera/stream`   | Camera media proxy — live stream (binding-gated, spec 133)   |

### Devices, Plugins, History

| Method | Route                     | Description                             |
| ------ | ------------------------- | --------------------------------------- |
| GET    | `/api/v1/devices`         | List discovered devices                 |
| GET    | `/api/v1/devices/:id`     | Device with data + orders               |
| GET    | `/api/v1/integrations`    | Runtime integration status              |
| GET    | `/api/v1/plugins`         | Installed plugins (manifest + status)   |
| POST   | `/api/v1/plugins/install` | Install a plugin from registry / GitHub |
| DELETE | `/api/v1/plugins/:id`     | Uninstall plugin                        |
| GET    | `/api/v1/history`         | Time-series history query               |

### Modes / Recipes / Calendar / Buttons

| Method | Route                                    | Description                       |
| ------ | ---------------------------------------- | --------------------------------- |
| GET    | `/api/v1/modes`                          | List modes                        |
| POST   | `/api/v1/modes`                          | Create mode                       |
| POST   | `/api/v1/modes/:id/activate`             | Activate a mode (apply impacts)   |
| POST   | `/api/v1/modes/:id/deactivate`           | Deactivate a mode                 |
| PUT    | `/api/v1/modes/:id/zones/:zoneId/impact` | Set the zone-impact for a mode    |
| GET    | `/api/v1/recipes`                        | List available recipe definitions |
| POST   | `/api/v1/recipes/:recipeId/instances`    | Create a recipe instance          |
| GET    | `/api/v1/recipes/instances/:id`          | Get instance + recent log         |
| GET    | `/api/v1/calendar/profiles`              | List calendar profiles            |
| PUT    | `/api/v1/calendar/active`                | Switch active profile             |
| POST   | `/api/v1/calendar/profiles/:id/slots`    | Add a scheduling slot             |
| GET    | `/api/v1/button-actions`                 | List button bindings              |
| POST   | `/api/v1/button-actions`                 | Create a button binding           |

### MQTT / Notifications / Dashboard / Charts

| Method | Route                                 | Description                         |
| ------ | ------------------------------------- | ----------------------------------- |
| \*     | `/api/v1/mqtt-brokers/...`            | CRUD MQTT brokers                   |
| \*     | `/api/v1/mqtt-publishers/...`         | CRUD MQTT publishers + mappings     |
| \*     | `/api/v1/notification-publishers/...` | CRUD notification publishers        |
| \*     | `/api/v1/dashboard/...`               | Dashboard widgets                   |
| \*     | `/api/v1/charts/...`                  | Saved chart configs                 |
| \*     | `/api/v1/energy/...`                  | Energy dashboard, history, by-usage |

For the complete and authoritative reference, see [API Reference](api-reference.md).

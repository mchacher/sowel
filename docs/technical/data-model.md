# Sowel -- Data Model

> Version: 1.0 -- 2026-02-19
>
> This document is the reference for Sowel's core data model. It describes the three-layer architecture (Topology -> Functional -> Physical), all entities, their relationships, and the aggregation rules.

---

## 1. Three-Layer Architecture

Sowel separates concerns into three distinct layers:

```
+-------------------------------------------------------------+
|  LAYER 1 -- TOPOLOGY (Zones)                                |
|  Spatial structure of the home                               |
|  Hierarchical: Home -> Floor -> Room                         |
|  Aggregates data automatically from child Equipments         |
+-------------------------------------------------------------+
|  LAYER 2 -- FUNCTIONAL (Equipments + Groups)                 |
|  What the user sees and controls                             |
|  Placed IN a Zone, optionally IN a Group                     |
|  Binds to one or more physical Devices                       |
+-------------------------------------------------------------+
|  LAYER 3 -- PHYSICAL (Devices)                               |
|  Hardware discovered from integrations                       |
|  Auto-discovered, raw data and commands                      |
|  Never directly manipulated by the end user                  |
+-------------------------------------------------------------+
```

**Guiding principle**: A Device is what's on the network. An Equipment is what's in the room.

---

## 2. Entity Relationship Diagram

```
Zone (hierarchy: parent -> children)
 |
 +-- EquipmentGroup (optional functional grouping)
 |    +-- Equipment*
 |
 +-- Equipment (functional unit, user-facing)
      +-- DataBinding --> DeviceData (on a Device)
      +-- OrderBinding --> DeviceOrder (on a Device)
      +-- [V0.5] ComputedData (expression-based virtual data)

Device (physical, auto-discovered)
 +-- DeviceData (readable properties: temperature, state, brightness...)
 +-- DeviceOrder (writable commands: set brightness, turn on...)
```

---

## 3. Zone

A **Zone** represents a spatial area in the home. Zones form a **tree hierarchy**.

### 3.1 Interface

```typescript
interface Zone {
  id: string; // UUID v4
  name: string; // "Salon", "Etage 1", "Maison"
  parentId: string | null; // null = root zone
  icon?: string; // Lucide icon name: "home", "sofa", "bed"
  description?: string; // "Piece principale, 35m2"
  displayOrder: number; // Sort order among siblings (0-based)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 3.2 Hierarchy

Zones are nestable to any depth. Typical structure:

```
Maison                    (root, parentId: null)
+-- RDC                   (floor, parentId: Maison)
|   +-- Salon             (room, parentId: RDC)
|   +-- Cuisine           (room, parentId: RDC)
|   +-- Entree            (room, parentId: RDC)
|   +-- WC                (room, parentId: RDC)
+-- Etage                 (floor, parentId: Maison)
|   +-- Chambre Parentale (room, parentId: Etage)
|   +-- Chambre Enfant    (room, parentId: Etage)
|   +-- Salle de Bain     (room, parentId: Etage)
|   +-- Couloir           (room, parentId: Etage)
+-- Exterieur             (area, parentId: Maison)
    +-- Jardin            (area, parentId: Exterieur)
    +-- Garage            (area, parentId: Exterieur)
```

### 3.3 Zone Aggregated Data

The engine **automatically computes** aggregated data for each Zone based on the Equipments it contains. No manual configuration required -- this is a core feature.

Aggregation is **recursive**: a parent Zone aggregates its own Equipments plus all children Zones.

| Attribute                | Type           | Aggregation Rule | Source (DataCategory) | Description                                         |
| ------------------------ | -------------- | ---------------- | --------------------- | --------------------------------------------------- |
| `temperature`            | number \| null | AVG              | `temperature`         | Average temperature in the zone                     |
| `humidity`               | number \| null | AVG              | `humidity`            | Average humidity                                    |
| `pressure`               | number \| null | AVG              | `pressure`            | Average atmospheric pressure                        |
| `luminosity`             | number \| null | AVG              | `luminosity`          | Average luminosity (lux)                            |
| `co2`                    | number \| null | AVG              | `co2`                 | Average CO2 level (ppm)                             |
| `voc`                    | number \| null | AVG              | `voc`                 | Average VOC level (ppb)                             |
| `motion`                 | boolean        | OR               | `motion`              | true if ANY motion sensor detects movement          |
| `presence`               | boolean        | OR + timeout     | `motion`              | true if motion detected within configurable timeout |
| `openDoors`              | number         | COUNT (open)     | `contact_door`        | Number of open door contacts                        |
| `openWindows`            | number         | COUNT (open)     | `contact_window`      | Number of open window contacts                      |
| `waterLeak`              | boolean        | OR               | `water_leak`          | true if ANY water leak sensor triggers              |
| `smoke`                  | boolean        | OR               | `smoke`               | true if ANY smoke detector triggers                 |
| `lightsOn`               | number         | COUNT (on)       | `light_state`         | Number of lights turned on                          |
| `lightsTotal`            | number         | COUNT (all)      | `light_state`         | Total number of light equipments                    |
| `averageBrightness`      | number \| null | AVG (on only)    | `light_brightness`    | Average brightness of lights that are on            |
| `shuttersOpen`           | number         | COUNT (open)     | `shutter_position`    | Number of open shutters                             |
| `shuttersTotal`          | number         | COUNT (all)      | `shutter_position`    | Total number of shutters                            |
| `averageShutterPosition` | number \| null | AVG              | `shutter_position`    | Average shutter position (%)                        |
| `totalPower`             | number         | SUM              | `power`               | Total instantaneous power (W)                       |
| `totalEnergy`            | number         | SUM              | `energy`              | Total energy consumption (kWh)                      |
| `heatingActive`          | boolean        | OR               | thermostat equipments | true if any thermostat is actively heating          |
| `targetTemperature`      | number \| null | AVG              | thermostat equipments | Average target temperature setpoint                 |

> **Note**: This list will evolve. New aggregated attributes can be added as new Equipment types and DataCategories are introduced.

### 3.4 Zone Auto-Orders

Zones expose bulk commands that act on all Equipments within the zone (and child zones recursively):

| Order              | Effect                                           |
| ------------------ | ------------------------------------------------ |
| `allOff`           | Turn off ALL controllable Equipments in the Zone |
| `allLightsOff`     | Turn off all light-type Equipments               |
| `allLightsOn`      | Turn on all light-type Equipments                |
| `allShuttersOpen`  | Open all shutters                                |
| `allShuttersClose` | Close all shutters                               |

### 3.5 SQLite Schema

```sql
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Equipment Group

An **EquipmentGroup** is a functional grouping of Equipments within a Zone. It allows controlling and monitoring a subset of equipments together.

### 4.1 Interface

```typescript
interface EquipmentGroup {
  id: string; // UUID v4
  name: string; // "Volets Sud", "Eclairage Ambiance"
  zoneId: string; // FK -> Zone (a group belongs to exactly one zone)
  icon?: string; // Lucide icon name
  description?: string;
  displayOrder: number; // Sort order within the zone
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 4.2 Purpose & Examples

```
Salon (Zone)
+-- Group "Volets Sud"
|   +-- Volet Baie Vitree          (Equipment: shutter)
|   +-- Volet Porte Fenetre        (Equipment: shutter)
+-- Group "Volets Nord"
|   +-- Volet Fenetre Nord         (Equipment: shutter)
+-- Group "Eclairage Ambiance"
|   +-- Spots Plafond              (Equipment: dimmer)
|   +-- Lampe Canape               (Equipment: dimmer)
+-- Detection Salon                (Equipment: motion_sensor, no group)
+-- Temperature Salon              (Equipment: sensor, no group)
```

**Key behaviors:**

- An Equipment belongs to **at most one** Group (optional, via `groupId`)
- A Group belongs to exactly one Zone
- Groups have their own aggregated data (same rules as Zones, scoped to group members)
- Groups can receive bulk orders (e.g., "close all shutters in Volets Sud")

### 4.3 Group Aggregated Data

Groups compute aggregated data using the **same rules** as Zones (section 3.3), but scoped to the group's member Equipments only. This allows:

- "Average shutter position of Volets Sud" vs "Average shutter position of Volets Nord"
- "Number of lights on in Eclairage Ambiance" vs zone-wide count

### 4.4 SQLite Schema

```sql
CREATE TABLE equipment_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Equipment

An **Equipment** is the user-facing functional unit. It's the primary entity users interact with in the UI, scenarios, and voice commands.

### 5.1 Interface

```typescript
type EquipmentType =
  | "light" // on/off light
  | "dimmer" // dimmable light
  | "color_light" // color-capable light
  | "shutter" // cover, blind, shutter
  | "thermostat" // heating/cooling control
  | "lock" // door lock
  | "alarm" // alarm system
  | "sensor" // generic sensor (temp, humidity...)
  | "motion_sensor" // motion detector
  | "contact_sensor" // door/window contact
  | "media_player" // media device
  | "camera" // surveillance camera
  | "switch" // on/off switch or plug
  | "water_valve" // smart irrigation valve (toggle + timed watering)
  | "generic"; // anything else

interface Equipment {
  id: string; // UUID v4
  name: string; // "Spots Salon", "Volet Baie Vitree"
  zoneId: string; // FK -> Zone (where the equipment functions)
  groupId: string | null; // FK -> EquipmentGroup (optional)
  type: EquipmentType; // Semantic type, drives UI rendering & aggregation
  icon?: string; // Lucide icon name (overrides type default)
  description?: string;
  enabled: boolean; // Disabled equipments are ignored by the engine
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### 5.2 Equipment vs Device

|                      | Device                            | Equipment                         |
| -------------------- | --------------------------------- | --------------------------------- |
| **Nature**           | Physical hardware                 | Functional abstraction            |
| **Discovery**        | Auto-discovered from integrations | Manually created by user          |
| **Identity**         | Integration-specific ID           | User-chosen name                  |
| **Location**         | Where physically installed        | Where functionally used           |
| **Cardinality**      | 1 Device -> N Equipments possible | 1 Equipment -> N Devices possible |
| **User interaction** | Never (technical layer)           | Always (primary interface)        |

**Examples:**

- 1 Device -> 1 Equipment: Aqara temperature sensor -> "Temperature Salon"
- 1 Device -> N Equipments: Double relay module -> "Lumiere Cuisine" + "Lumiere Cellier"
- N Devices -> 1 Equipment: 3 PIR sensors -> "Detection Salon" (via computed data, V0.5)

---

## 6. Data Binding

A **DataBinding** maps a Device Data property to an Equipment-level alias.

### 6.1 Interface

```typescript
interface DataBinding {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  deviceDataId: string; // FK -> DeviceData
  alias: string; // Equipment-level name: "state", "brightness", "temperature"
}
```

### 6.2 How It Works

```
Device "Variateur #1"
+-- DeviceData: key="state", value="ON"        <--+
+-- DeviceData: key="brightness", value=180    <---+-- DataBinding
+-- DeviceData: key="linkquality", value=85        |
                                                   |
Equipment "Spots Salon"                            |
+-- Data alias "state" ----------------------------+ (bound to DeviceData "state")
+-- Data alias "brightness" -----------------------  (bound to DeviceData "brightness")
+-- [not bound to linkquality -- it's a technical metric, not user-facing]
```

### 6.3 Constraints

- `UNIQUE(equipment_id, alias)` -- each alias is unique per Equipment
- When DeviceData changes, the Equipment's bound alias reflects the new value immediately
- The alias is used in expressions, UI display, Zone aggregation, and Scenario conditions

### 6.4 SQLite Schema

```sql
CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);
```

---

## 7. Order Binding

An **OrderBinding** maps a Device Order to an Equipment-level command alias.

### 7.1 Interface

```typescript
interface OrderBinding {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  deviceOrderId: string; // FK -> DeviceOrder
  alias: string; // Equipment-level command: "turn_on", "set_brightness"
}
```

### 7.2 How It Works

When an Equipment Order is executed:

```
User clicks "Turn On" on Equipment "Spots Salon"
  -> API: POST /equipments/:id/orders/turn_on { value: true }
    -> Equipment Manager finds OrderBinding alias="turn_on"
      -> Resolves to DeviceOrder
        -> Integration Plugin dispatches command to device
```

### 7.3 Multi-Device Dispatch

An Equipment can have multiple OrderBindings with the **same alias** pointing to different Devices. This enables controlling multiple devices with a single command:

```
Equipment "Eclairage Cuisine"
+-- OrderBinding: alias="turn_on" -> DeviceOrder on Relais #1
+-- OrderBinding: alias="turn_on" -> DeviceOrder on Relais #2
```

Executing `turn_on` dispatches to BOTH relays in parallel.

**Schema constraint note:** For multi-device dispatch, the UNIQUE constraint is on `(equipment_id, alias, device_order_id)` -- not just `(equipment_id, alias)`.

### 7.4 SQLite Schema

```sql
CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias, device_order_id)
);
```

---

## 8. Device (Layer 3 -- Physical)

Devices are auto-discovered from configured integrations (Zigbee2MQTT, Panasonic CC, MCZ Maestro, Netatmo HC, etc.). They are documented here for completeness.

### 8.1 Interface

```typescript
interface Device {
  id: string; // UUID v4
  mqttBaseTopic: string; // Integration-specific topic or identifier
  mqttName: string; // Integration-specific name or ID
  name: string; // User-editable display name
  manufacturer?: string; // "Aqara", "IKEA", "Panasonic", "MCZ"
  model?: string; // "MCCGQ11LM", "CS-Z25VKEW", etc.
  ieeeAddress?: string; // Hardware address (Zigbee IEEE, serial, etc.)
  source: DeviceSource; // "zigbee2mqtt" | "panasonic_cc" | "mcz_maestro" | "netatmo_hc" | ...
  status: DeviceStatus; // "online" | "offline" | "unknown"
  lastSeen: string | null; // ISO 8601
  rawExpose?: unknown; // Raw integration-specific metadata
  createdAt: string;
  updatedAt: string;
}
```

### 8.2 DeviceData

```typescript
interface DeviceData {
  id: string;
  deviceId: string; // FK -> Device
  key: string; // Property name: "temperature", "state", "brightness"
  type: DataType; // "boolean" | "number" | "enum" | "text" | "json"
  category: DataCategory; // Semantic category for aggregation rules
  value: unknown; // Current value
  unit?: string; // "C", "%", "lx", "W"
  lastUpdated: string | null;
}
```

### 8.3 DeviceOrder

```typescript
interface DeviceOrder {
  id: string;
  deviceId: string; // FK -> Device
  key: string; // "state", "brightness", "position"
  type: DataType;
  mqttSetTopic: string; // MQTT topic to publish to
  payloadKey: string; // Key in the JSON payload
  min?: number; // For numeric: minimum value
  max?: number; // For numeric: maximum value
  enumValues?: string[]; // For enum: allowed values
  unit?: string;
}
```

---

## 9. Computed Data (V0.5)

> **Deferred to V0.5** -- documented here as part of the complete data model.

A **ComputedData** is a virtual data point on an Equipment whose value is derived from an expression over other data sources.

### 9.1 Interface

```typescript
interface ComputedData {
  id: string; // UUID v4
  equipmentId: string; // FK -> Equipment
  key: string; // "state", "average_temperature", "motion"
  type: DataType;
  category: DataCategory; // Used by Zone aggregation
  expression: string; // Computation expression
  value: unknown; // Current computed value
}
```

### 9.2 Expression Language

```
// Boolean
OR(binding.motion_1, binding.motion_2)
AND(binding.door, binding.window)
NOT(binding.occupancy)

// Numeric
AVG(binding.temp_1, binding.temp_2)
MIN(binding.temp_1, binding.temp_2)
MAX(binding.temp_1, binding.temp_2)
SUM(binding.power_1, binding.power_2)

// Conditional
IF(binding.brightness > 0, "on", "off")
THRESHOLD(binding.temperature, 19, "cold", "ok")

// References
binding.<alias>                        -> DataBinding on the same Equipment
equipment.<equipmentId>.<alias>        -> Data on another Equipment
zone.<zoneId>.<key>                    -> Zone aggregated Data
```

---

## 10. Reactive Data Flow

The complete event-driven pipeline:

```
Integration event (MQTT message, cloud API poll, etc.)
  |
  v
Integration Plugin (receives + parses)
  |
  v
Device Manager (updates DeviceData)
  |
  +--> Event: "device.data.updated"
  |
  v
Equipment Manager
  +-- Updates bound Equipment Data (via DataBindings)
  +-- [V0.5] Re-evaluates ComputedData expressions
  |
  +--> Event: "equipment.data.changed"
  |
  v
Zone Aggregator
  +-- Re-computes Zone aggregated data
  +-- Re-computes Group aggregated data
  +-- Propagates up the zone hierarchy (recursive)
  |
  +--> Event: "zone.data.changed"
  |
  v
Scenario Engine (V0.7)
  +-- Evaluates triggers
  +-- Checks conditions
  +-- Executes actions
  |
  +--> Actions may dispatch Equipment/Zone Orders -> Integration Plugin -> device
  |
  v
WebSocket Server
  +-- Broadcasts all events to connected UI clients
```

---

## 11. Event Bus Events

All events are typed via TypeScript discriminated unions.

### System Events

| Event                      | Payload         | When                  |
| -------------------------- | --------------- | --------------------- |
| `system.started`           | --              | Engine boot complete  |
| `system.mqtt.connected`    | --              | MQTT broker connected |
| `system.mqtt.disconnected` | --              | MQTT broker lost      |
| `system.error`             | `error: string` | Unrecoverable error   |

### Device Events (V0.1)

| Event                   | Payload                                              | When             |
| ----------------------- | ---------------------------------------------------- | ---------------- |
| `device.discovered`     | `device: Device`                                     | New device found |
| `device.removed`        | `deviceId, deviceName`                               | Device deleted   |
| `device.status_changed` | `deviceId, deviceName, status`                       | Online/offline   |
| `device.data.updated`   | `deviceId, deviceName, dataId, key, value, previous` | Property change  |

### Equipment Events (V0.3)

| Event                      | Payload                             | When               |
| -------------------------- | ----------------------------------- | ------------------ |
| `equipment.data.changed`   | `equipmentId, key, value, previous` | Bound data changed |
| `equipment.order.executed` | `equipmentId, orderAlias, value`    | Order dispatched   |

### Zone Events (V0.3+)

| Event               | Payload                        | When                    |
| ------------------- | ------------------------------ | ----------------------- |
| `zone.data.changed` | `zoneId, key, value, previous` | Aggregated data changed |

---

## 12. Complete SQLite Schema

```sql
-- ============================================================
-- ZONES (V0.2)
-- ============================================================
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- EQUIPMENT GROUPS (V0.2)
-- ============================================================
CREATE TABLE equipment_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  icon TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- DEVICES (V0.1 -- existing)
-- ============================================================
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT NOT NULL UNIQUE,
  mqtt_name TEXT NOT NULL,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  source TEXT NOT NULL,  -- integration source: 'zigbee2mqtt', 'panasonic_cc', 'mcz_maestro', 'netatmo_hc', ...
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  value TEXT,
  unit TEXT,
  last_updated DATETIME,
  UNIQUE(device_id, key)
);

CREATE TABLE device_orders (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  mqtt_set_topic TEXT NOT NULL,
  payload_key TEXT NOT NULL,
  min_value REAL,
  max_value REAL,
  enum_values JSON,
  unit TEXT,
  UNIQUE(device_id, key)
);

-- ============================================================
-- EQUIPMENTS (V0.3)
-- ============================================================
CREATE TABLE equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  group_id TEXT REFERENCES equipment_groups(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  icon TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias)
);

CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  UNIQUE(equipment_id, alias, device_order_id)
);

-- ============================================================
-- COMPUTED DATA (V0.5)
-- ============================================================
CREATE TABLE computed_data (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  expression TEXT NOT NULL,
  value TEXT,
  UNIQUE(equipment_id, key)
);

-- ============================================================
-- INTERNAL RULES (V0.5)
-- ============================================================
CREATE TABLE internal_rules (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  condition_expr TEXT NOT NULL,
  action_expr TEXT NOT NULL,
  enabled INTEGER DEFAULT 1
);

-- ============================================================
-- RECIPES (V0.8)
-- ============================================================
CREATE TABLE recipe_instances (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  params JSON NOT NULL DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recipe_state (
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (instance_id, key)
);

CREATE TABLE recipe_log (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL REFERENCES recipe_instances(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- USERS & AUTH
-- ============================================================
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard',
  preferences JSON DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SETTINGS (key-value store for integration config)
-- ============================================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 13. API Endpoints Summary

### Zones (V0.2)

| Method | Route               | Description                                    |
| ------ | ------------------- | ---------------------------------------------- |
| GET    | `/api/v1/zones`     | List all zones (tree structure)                |
| GET    | `/api/v1/zones/:id` | Get zone with aggregated data                  |
| POST   | `/api/v1/zones`     | Create zone                                    |
| PUT    | `/api/v1/zones/:id` | Update zone                                    |
| DELETE | `/api/v1/zones/:id` | Delete zone (must have no children/equipments) |

### Equipment Groups (V0.2)

| Method | Route                          | Description            |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/api/v1/zones/:zoneId/groups` | List groups in a zone  |
| POST   | `/api/v1/zones/:zoneId/groups` | Create group in a zone |
| PUT    | `/api/v1/groups/:id`           | Update group           |
| DELETE | `/api/v1/groups/:id`           | Delete group           |

### Equipments (V0.3)

| Method | Route                                  | Description                                  |
| ------ | -------------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/equipments`                   | List all equipments                          |
| GET    | `/api/v1/equipments/:id`               | Get equipment with bindings and current data |
| POST   | `/api/v1/equipments`                   | Create equipment                             |
| PUT    | `/api/v1/equipments/:id`               | Update equipment                             |
| DELETE | `/api/v1/equipments/:id`               | Delete equipment                             |
| POST   | `/api/v1/equipments/:id/orders/:alias` | Execute an equipment order                   |

### Zone Orders (V0.3+)

| Method | Route                                 | Description                                       |
| ------ | ------------------------------------- | ------------------------------------------------- |
| POST   | `/api/v1/zones/:id/orders/:orderKey`  | Execute zone auto-order (allOff, allLightsOff...) |
| POST   | `/api/v1/groups/:id/orders/:orderKey` | Execute group order                               |

For the complete API reference, see [API Reference](api-reference.md).

---

## 14. Implementation Roadmap

| Version   | Entities Implemented                                               |
| --------- | ------------------------------------------------------------------ |
| **V0.1**  | Device, DeviceData, DeviceOrder                                    |
| **V0.2**  | Zone, EquipmentGroup (CRUD + UI)                                   |
| **V0.3**  | Equipment, DataBinding, OrderBinding (CRUD + Order execution + UI) |
| **V0.5**  | ComputedData, InternalRule                                         |
| **V0.3+** | Zone aggregation engine, Zone auto-orders                          |

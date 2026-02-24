# Winch — Functional Specification

> Version: 0.8 — February 2026
> Author: Marc
> Purpose: This document is the single source of truth for Claude Code to build the project.
> **Winch** — the invisible structure of your smart home.

---

## 1. Vision

**Winch** is a modern, lightweight home automation engine that:

- Uses **MQTT as its only data source** (zigbee2mqtt, tasmota, ESPHome, or any MQTT-publishing device)
- Separates **physical devices** (what's on the network) from **functional equipments** (how the user lives their home)
- Provides **automatic zone-level aggregation** (e.g. "is there motion in the living room?" across multiple PIR sensors)
- Offers a **scenario engine** with reusable templates (recipes)
- Exposes a **modern, reactive web UI**

The closest existing inspiration is Jeedom's Equipment / Info / Command model, but with a modern stack, a cleaner architecture, and a real-time UI.

---

## 2. Terminology

These terms are used consistently throughout the codebase, API, UI, and documentation.

| Term          | Description                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zone**      | A physical space in the home (room, floor, outdoor area). Zones can be nested. Zones auto-aggregate Data from their Equipments.                                                                                                                              |
| **Device**    | A physical hardware unit discovered on the MQTT network. A Device exposes raw Data and Orders based on its MQTT messages. Devices are auto-discovered.                                                                                                       |
| **Equipment** | A user-defined functional unit of the home ("Spots Salon", "Chauffage Chambre"). An Equipment binds to Data and Orders from one or more Devices. It can also expose computed Data and dispatched Orders. This is the primary entity the user interacts with. |
| **Data**      | A value. On a Device, it's a raw reading from MQTT (temperature, state, brightness). On an Equipment, it's either bound from a Device or computed from multiple sources.                                                                                     |
| **Order**     | A command. On a Device, it's a publish to an MQTT `/set` topic. On an Equipment, it can dispatch to one or more Device Orders.                                                                                                                               |
| **Scenario**  | An automation rule: trigger(s) → condition(s) → action(s).                                                                                                                                                                                                   |
| **Recipe**    | A reusable Scenario template with typed parameter slots. Users instantiate a Recipe by filling in the slots with their own Zones/Equipments/values.                                                                                                          |

### Relationship diagram

```
Zone (spatial structure, nestable)
 ├── Equipment (functional unit, user-facing)
 │    ├── Data (bound from Device or computed)
 │    ├── Order (bound from Device or dispatched)
 │    └── Internal Rules (optional embedded mini-logic)
 │
 └── Zone Aggregated Data (auto-computed from Equipments in the Zone)
      ├── motion (OR of all motion sensors)
      ├── temperature (AVG of all temp sensors)
      ├── lightsOn (COUNT), etc.
      └── Zone Orders: allOff, allLightsOff, allLightsOn

Device (physical, auto-discovered from MQTT)
 ├── Data (raw values from MQTT payloads)
 └── Order (publish to MQTT /set topics)

Scenario (automation)
 ├── Trigger (what starts it)
 ├── Condition (what must be true)
 └── Action (what to do)

Recipe (template for Scenario)
 ├── Slot definitions (typed parameters)
 └── Scenario template (references slots instead of real IDs)
```

---

## 3. Architecture Overview

### 3.1 High-level

```
┌─────────────────────────────────────────────────────────┐
│                     MQTT Broker                         │
│              (Mosquitto or similar)                     │
└──────────┬──────────────────────────────┬───────────────┘
           │ subscribe                    │ publish (orders)
           ▼                              ▲
┌─────────────────────────────────────────────────────────┐
│                    ENGINE (Node.js)                      │
│                                                         │
│  ┌───────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ MQTT      │  │ Device     │  │ Equipment         │  │
│  │ Connector │→ │ Manager    │→ │ Manager           │  │
│  │           │  │            │  │ (bindings,        │  │
│  │           │  │ (auto-     │  │  computed data,   │  │
│  │           │  │  discovery)│  │  dispatched       │  │
│  │           │  │            │  │  orders)          │  │
│  └───────────┘  └────────────┘  └───────────────────┘  │
│                                                         │
│  ┌───────────┐  ┌────────────┐  ┌───────────────────┐  │
│  │ Zone      │  │ Scenario   │  │ Recipe            │  │
│  │ Manager   │  │ Engine     │  │ Manager           │  │
│  │ (auto-    │  │ (triggers, │  │ (templates,       │  │
│  │  aggreg.) │  │  eval,     │  │  instantiation)   │  │
│  │           │  │  actions)  │  │                   │  │
│  └───────────┘  └────────────┘  └───────────────────┘  │
│                                                         │
│  ┌───────────┐  ┌────────────┐                          │
│  │ Event Bus │  │ REST API + │                          │
│  │ (internal)│  │ WebSocket  │                          │
│  └───────────┘  └────────────┘                          │
│                        │                                │
└────────────────────────┼────────────────────────────────┘
                         │ HTTP + WS
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   WEB UI (React)                         │
│            Dashboard, config, scenarios                  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Event flow

This is the core reactive pipeline. Every state change follows this path:

```
MQTT message arrives (e.g. zigbee2mqtt/salon_pir publishes {"occupancy": true})
  → MQTT Connector receives it
    → Device Manager updates the corresponding Device Data
      → Event Bus emits: "device.data.updated" { deviceId, key: "occupancy", value: true, previous: false }
        → Equipment Manager re-evaluates bindings and computed Data
          → Event Bus emits: "equipment.data.changed" { equipmentId, key: "motion", value: true }
            → Zone Manager re-evaluates aggregations
              → Event Bus emits: "zone.data.changed" { zoneId, key: "motion", value: true }
                → Scenario Engine evaluates triggers
                  → Matching Scenario executes actions
                    → Actions may emit Orders
                      → Orders are published to MQTT via MQTT Connector
        → WebSocket server pushes state update to connected UI clients
```

---

## 4. Tech Stack

### 4.1 Backend

| Component              | Technology                           | Why                                                                                                                            |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Runtime                | **Node.js 20+ LTS**                  | Async event-driven, excellent MQTT ecosystem, same language as frontend, best LLM code generation support                      |
| Language               | **TypeScript (strict mode)**         | Type safety, better maintainability, best Claude Code output quality                                                           |
| HTTP framework         | **Fastify**                          | Faster than Express, native TypeScript support, JSON Schema validation built-in, clean plugin architecture                     |
| MQTT client            | **mqtt.js**                          | De facto standard Node.js MQTT library, mature, supports MQTT 5                                                                |
| Database (config)      | **SQLite via better-sqlite3**        | Synchronous API (no callback complexity), single file, zero setup, excellent for config/state storage                          |
| Database (time-series) | **InfluxDB 2.x**                     | Purpose-built for time-series. Native retention policies, efficient compression, temporal queries. Used for Data history only. |
| WebSocket              | **ws** (via Fastify plugin)          | Lightweight, no Socket.io overhead. Sufficient for pushing state updates to UI.                                                |
| Process manager        | **PM2**                              | Auto-restart on crash, log management, monitoring. Simple systemd alternative.                                                 |
| Event bus              | **EventEmitter (typed)** or **mitt** | Internal pub/sub for the reactive pipeline. Must be typed with TypeScript discriminated unions.                                |

### 4.2 Frontend

| Component        | Technology                   | Why                                                                      |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------ |
| Framework        | **React 18+**                | Largest ecosystem, best Claude Code support, rich component libraries    |
| Language         | **TypeScript**               | Shared types with backend                                                |
| Build tool       | **Vite**                     | Near-instant hot reload in dev, fast production builds, replaces Webpack |
| Styling          | **Tailwind CSS**             | Utility-first, fast prototyping, consistent design without custom CSS    |
| State management | **Zustand**                  | Lightweight, simple API, perfect for real-time state fed by WebSocket    |
| Charts           | **Recharts** or **Chart.js** | Time-series visualization for Data history                               |
| Icons            | **Lucide React**             | Clean, consistent icon set                                               |

### 4.3 Infrastructure

| Component        | Technology                                      |
| ---------------- | ----------------------------------------------- |
| MQTT Broker      | **Mosquitto** (assumed external, user provides) |
| Containerization | **Docker + docker-compose** (engine + InfluxDB) |
| Target platform  | Raspberry Pi 4/5 or any Linux mini-PC           |

---

## 5. Data Model

### 5.1 Zone

Zones represent the spatial structure of the home. They can be nested (Home → Floor → Room).

```typescript
interface Zone {
  id: string; // UUID
  name: string; // "Salon", "Chambre parentale", "Étage 1"
  parentId: string | null; // null = root zone
  icon?: string; // optional icon identifier
  order: number; // display order among siblings
  createdAt: Date;
  updatedAt: Date;
}
```

#### Zone auto-aggregation

The engine automatically computes aggregated Data for each Zone based on the Equipments it contains. This is a **killer feature** — no manual configuration needed.

| Aggregated key           | Type           | Logic                                                | Example                              |
| ------------------------ | -------------- | ---------------------------------------------------- | ------------------------------------ |
| `temperature`            | number \| null | `AVG` of all temperature-category Data               | average of 2 Aqara sensors           |
| `humidity`               | number \| null | `AVG` of all humidity-category Data                  | —                                    |
| `luminosity`             | number \| null | `AVG` of all luminosity-category Data                | —                                    |
| `motion`                 | boolean        | `OR` of all motion-category Data in the Zone         | true if any PIR detects motion       |
| `motionSensors`          | number         | `COUNT` of motion sensors in the Zone                | used to show Calme/Mouvement label   |
| `motionSince`            | string \| null | ISO timestamp of last motion state change            | used for relative duration display   |
| `lightsOn`               | number         | `COUNT` of light-type Equipments with state = on     | 3 lights on out of 5                 |
| `lightsTotal`            | number         | `COUNT` of all light-type Equipments                 | —                                    |
| `shuttersOpen`           | number         | `COUNT` of shutter-type Equipments with position > 0 | 2 shutters open out of 3             |
| `shuttersTotal`          | number         | `COUNT` of all shutter-type Equipments               | —                                    |
| `averageShutterPosition` | number \| null | `AVG` of all shutter positions (0-100)               | average position across all shutters |
| `openDoors`              | number         | `COUNT` of door contact sensors = open               | —                                    |
| `openWindows`            | number         | `COUNT` of window contact sensors = open             | —                                    |
| `waterLeak`              | boolean        | `OR` of all water_leak sensors                       | true if any sensor detects water     |
| `smoke`                  | boolean        | `OR` of all smoke sensors                            | true if any sensor detects smoke     |

The aggregation is **recursive**: a parent Zone aggregates its own Equipments plus all child Zones' aggregations.

#### Zone auto-orders

| Order          | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `allOff`       | Sends "off" to ALL Equipments in the Zone (and child Zones) |
| `allLightsOff` | Sends "off" to all light-type Equipments in the Zone        |
| `allLightsOn`  | Sends "on" to all light-type Equipments in the Zone         |

These are available in the API, UI, and as Scenario actions.

### 5.2 Device

A Device is a physical hardware unit on the MQTT network. Devices are **auto-discovered** from MQTT sources like zigbee2mqtt.

```typescript
interface Device {
  id: string; // UUID
  mqttBaseTopic: string; // e.g. "zigbee2mqtt" (the bridge base topic)
  mqttName: string; // e.g. "salon_pir" (the friendly name)
  // Full state topic = mqttBaseTopic + "/" + mqttName
  name: string; // Display name, auto-set from Z2M, user-editable
  manufacturer?: string; // "Xiaomi", "IKEA", etc.
  model?: string; // "RTCGQ11LM"
  ieeeAddress?: string; // "0x00158d0001a2b3c4"
  zoneId: string | null; // Physical location (where the device is installed)
  source: DeviceSource; // How this device was discovered
  status: DeviceStatus; // Current availability
  lastSeen: Date | null;
  rawExpose?: object; // Raw expose definition from zigbee2mqtt (stored for reference)
  createdAt: Date;
  updatedAt: Date;
}

type DeviceSource =
  | "zigbee2mqtt"
  | "tasmota"
  | "esphome"
  | "shelly"
  | "custom_mqtt"
  | "panasonic_cc"
  | "mcz_maestro";
type DeviceStatus = "online" | "offline" | "unknown";
```

#### Device Data

Each Device exposes zero or more Data. These are automatically parsed from the MQTT payload.

```typescript
interface DeviceData {
  id: string; // UUID
  deviceId: string; // FK → Device
  key: string; // Property name from MQTT payload: "temperature", "occupancy", "state", "brightness"
  type: DataType; // Value type
  category: DataCategory; // Semantic category (used for Zone aggregation and Equipment type inference)
  value: any; // Current value (kept in memory, persisted to SQLite on change)
  unit?: string; // "°C", "%", "lx", "W", "kWh"
  lastUpdated: Date;
}

type DataType =
  | "boolean" // true/false (occupancy, contact, state on/off)
  | "number" // temperature, humidity, brightness, battery
  | "enum" // string enum: effect modes, presets
  | "text" // free text
  | "json"; // complex nested payloads

// DataCategory is critical: it drives Zone auto-aggregation and Equipment type suggestions.
// The engine infers the category from the zigbee2mqtt expose definition or from known key patterns.
type DataCategory =
  | "motion" // occupancy, presence PIR
  | "temperature" // temperature readings
  | "humidity" // humidity readings
  | "pressure" // atmospheric pressure
  | "luminosity" // illuminance, lux
  | "contact_door" // door contact sensor
  | "contact_window" // window contact sensor
  | "light_state" // on/off state of a light
  | "light_brightness" // brightness level
  | "light_color_temp" // color temperature
  | "light_color" // color XY or HS
  | "shutter_position" // cover/shutter position
  | "lock_state" // locked/unlocked
  | "battery" // battery percentage
  | "power" // instantaneous power (W)
  | "energy" // cumulative energy (kWh)
  | "voltage" // voltage (V)
  | "current" // current (A)
  | "water_leak" // water leak detection
  | "smoke" // smoke detection
  | "co2" // CO2 level
  | "voc" // VOC level
  | "generic"; // anything else
```

#### Device Order

Each Device exposes zero or more Orders. These are inferred from the zigbee2mqtt expose definition (properties with `access` including write) or from known MQTT conventions.

```typescript
interface DeviceOrder {
  id: string; // UUID
  deviceId: string; // FK → Device
  key: string; // Property name: "state", "brightness", "color_temp"
  type: DataType; // Expected payload type
  mqttSetTopic: string; // Full topic to publish to: "zigbee2mqtt/salon_lampe/set"
  payloadKey: string; // Key in the JSON payload: "state", "brightness"
  // To execute: publish { [payloadKey]: value } to mqttSetTopic
  min?: number; // For numeric: min value (e.g. 0)
  max?: number; // For numeric: max value (e.g. 254)
  enumValues?: string[]; // For enum: possible values (e.g. ["on", "off", "toggle"])
  unit?: string; // Display unit
}
```

#### Auto-discovery flow (zigbee2mqtt)

This is the primary discovery mechanism. Other sources (tasmota, esphome) follow similar patterns.

1. **On startup**, subscribe to `zigbee2mqtt/bridge/devices` (retained message).
2. **Parse the device list**. For each device in the array:
   a. Create or update a `Device` record.
   b. Parse the `definition.exposes` array to generate `DeviceData[]` and `DeviceOrder[]`.
   c. The `exposes` structure from zigbee2mqtt describes features. Each feature has:
   - `type`: "binary", "numeric", "enum", "text", "composite", "list"
   - `property`: the key in the MQTT payload (maps to `DeviceData.key` and `DeviceOrder.key`)
   - `access`: bitmask (1=read/state, 2=write/set, 4=get). If bit 1 → create DeviceData. If bit 2 → create DeviceOrder.
   - `name`: human-readable name
   - `unit`, `value_min`, `value_max`, `values` (for enum), etc.
     d. Infer `DataCategory` from the feature `property` name and `type`:
   - `"occupancy"` → `motion`
   - `"temperature"` → `temperature`
   - `"humidity"` → `humidity`
   - `"illuminance"` or `"illuminance_lux"` → `luminosity`
   - `"contact"` → inspect device model/description to decide `contact_door` vs `contact_window` (default: `contact_door`)
   - `"state"` on a light device → `light_state`
   - `"brightness"` → `light_brightness`
   - `"color_temp"` → `light_color_temp`
   - `"position"` on a cover → `shutter_position`
   - `"battery"` → `battery`
   - `"power"` → `power`
   - `"energy"` → `energy`
   - etc. See DataCategory enum above. Default to `generic`.
3. **Subscribe to state topics**: `zigbee2mqtt/+` (or more specifically, subscribe per device).
4. **On each state message**, parse the JSON payload and update matching `DeviceData.value` for each key present.
5. **Listen for new devices**: subscribe to `zigbee2mqtt/bridge/event`. Events with `type: "device_joined"` or `type: "device_announce"` trigger re-reading `zigbee2mqtt/bridge/devices`.
6. **Device availability**: subscribe to `zigbee2mqtt/+/availability`. Update `Device.status` accordingly.

### 5.3 Equipment

An Equipment is the **user-facing functional unit**. It's what the user sees and interacts with. The user creates Equipments and binds them to Device Data and Orders.

The key insight: **a Device is what's on the network, an Equipment is what's in the room.**

Example: a Zigbee dimmer module (Device) installed behind the wall in the electrical cabinet feeds the Equipment "Spots Salon" which is in the living room Zone. The user never thinks about the dimmer module — they think about their living room spots.

```typescript
interface Equipment {
  id: string; // UUID
  name: string; // "Spots Salon", "Chauffage Chambre"
  zoneId: string; // FK → Zone. Functional location (may differ from Device zone)
  type: EquipmentType; // Semantic type, drives UI and Zone aggregation
  icon?: string;
  enabled: boolean; // Disabled equipments are ignored by the engine
  createdAt: Date;
  updatedAt: Date;
}

type EquipmentType =
  | "light_onoff" // on/off light
  | "light_dimmable" // dimmable light
  | "light_color" // color-capable light
  | "shutter" // cover, blind, shutter
  | "thermostat" // heating/cooling control
  | "lock" // door lock
  | "alarm" // alarm system or zone alarm
  | "sensor" // generic sensor (temp, humidity, etc.)
  | "motion_sensor" // specifically a motion detector
  | "contact_sensor" // door/window contact
  | "media_player" // media device
  | "camera" // surveillance camera
  | "switch" // on/off switch/plug
  | "generic"; // anything else
```

#### Data Binding

A Data Binding maps a Device Data to the Equipment level. The Equipment "sees" the Device Data through an alias.

```typescript
interface DataBinding {
  id: string; // UUID
  equipmentId: string; // FK → Equipment
  deviceDataId: string; // FK → DeviceData
  alias: string; // How this Data is named on the Equipment: "state", "brightness", "temperature"
}
```

#### Order Binding

An Order Binding maps a Device Order to the Equipment level.

```typescript
interface OrderBinding {
  id: string; // UUID
  equipmentId: string; // FK → Equipment
  deviceOrderId: string; // FK → DeviceOrder
  alias: string; // "turn_on", "set_brightness", "set_position"
}
```

#### Computed Data

Computed Data are virtual Data that derive their value from expressions over other Data sources. This is what makes Equipments powerful: they can aggregate, transform, and combine.

```typescript
interface ComputedData {
  id: string; // UUID
  equipmentId: string; // FK → Equipment
  key: string; // "state", "average_temperature"
  type: DataType;
  category: DataCategory; // For Zone aggregation
  expression: string; // Computation expression (see expression language below)
  value: any; // Current computed value
}
```

**Expression language** (keep it simple, evaluate with a safe expression parser):

```
// Boolean operations
OR(binding.motion_1, binding.motion_2)           // true if any is true
AND(binding.door_contact, binding.window_contact) // true if all true
NOT(binding.occupancy)                            // negate

// Numeric operations
AVG(binding.temp_1, binding.temp_2)              // average
MIN(binding.temp_1, binding.temp_2)              // minimum
MAX(binding.temp_1, binding.temp_2)              // maximum
SUM(binding.power_1, binding.power_2)            // sum

// Comparison
IF(binding.brightness > 0, "on", "off")          // conditional
THRESHOLD(binding.temperature, 19, "cold", "ok") // threshold check

// Reference format:
// "binding.<alias>" → references a DataBinding on the same Equipment
// "equipment.<equipmentId>.<alias>" → references Data on another Equipment
// "zone.<zoneId>.<key>" → references Zone aggregated Data
```

#### Internal Rules

Optional mini-logic embedded directly in an Equipment. Simpler than a full Scenario — for behavior that is intrinsic to the Equipment itself.

```typescript
interface InternalRule {
  id: string; // UUID
  equipmentId: string; // FK → Equipment
  name: string; // "Mode tamisé après 22h"
  condition: string; // Expression: "TIME >= '22:00' AND binding.state == 'on'"
  action: string; // "SET brightness 30" or "EXECUTE set_brightness 30"
  enabled: boolean;
}
```

#### Equipment examples

| Equipment         | Type           | Zone    | Devices used                 | Data                                                  | Orders                                 |
| ----------------- | -------------- | ------- | ---------------------------- | ----------------------------------------------------- | -------------------------------------- |
| Spots Salon       | light_dimmable | Salon   | Dimmer Zigbee #1             | state (bound), brightness (bound)                     | turn_on, turn_off, set_brightness      |
| Éclairage Cuisine | light_onoff    | Cuisine | Relais #1, Relais #2         | state (computed: OR of both relays)                   | turn_on (dispatches to both), turn_off |
| Température Salon | sensor         | Salon   | Aqara Temp #1, Aqara Temp #2 | temperature (computed: AVG), humidity (computed: AVG) | —                                      |
| Détection Salon   | motion_sensor  | Salon   | PIR #1, PIR #2, PIR #3       | motion (computed: OR of all 3)                        | —                                      |
| Volets Chambre    | shutter        | Chambre | Relais Volet                 | position (bound)                                      | open, close, set_position              |

### 5.4 Scenario

A Scenario is a user-defined automation rule.

```typescript
interface Scenario {
  id: string; // UUID
  name: string; // "Extinction salon après 15min"
  description?: string;
  enabled: boolean;
  recipeId?: string; // If instantiated from a Recipe
  createdAt: Date;
  updatedAt: Date;
}
```

#### Triggers

What starts a Scenario. Multiple triggers use OR logic (any one can fire the Scenario).

```typescript
interface Trigger {
  id: string;
  scenarioId: string;
  type: TriggerType;
  config: Record<string, any>; // Type-specific configuration
}

type TriggerType =
  | "data_change" // A Data value changes
  | "data_threshold" // A Data crosses a threshold
  | "zone_event" // A Zone aggregated Data changes
  | "time_cron" // Cron expression
  | "time_sunset" // Sunset +/- offset
  | "time_sunrise" // Sunrise +/- offset
  | "scenario_end" // Another Scenario finishes
  | "manual"; // User-triggered (button in UI or API call)
```

**Trigger config examples:**

```json
// data_change: fires when a specific Data value changes
{ "type": "data_change", "config": { "dataSource": "equipment.spots_salon.state", "to": "off" } }

// data_change with "from" filter
{ "type": "data_change", "config": { "dataSource": "equipment.spots_salon.state", "from": "on", "to": "off" } }

// data_threshold: fires when a numeric Data crosses a threshold
{ "type": "data_threshold", "config": { "dataSource": "equipment.temp_salon.temperature", "operator": ">", "value": 25 } }

// zone_event: fires on Zone aggregation change, with optional duration
{ "type": "zone_event", "config": { "zoneId": "zone_salon", "key": "motion", "value": false, "for": "15m" } }
// "for" means the value must stay at that level for the given duration before triggering

// time_cron
{ "type": "time_cron", "config": { "cron": "0 22 * * *" } }

// time_sunset with offset
{ "type": "time_sunset", "config": { "offset": "-30m" } }
```

#### Conditions

What must be true for the Scenario to execute (evaluated when a Trigger fires). Multiple conditions are joined by AND by default, with optional OR groups.

```typescript
interface Condition {
  id: string;
  scenarioId: string;
  type: ConditionType;
  config: Record<string, any>;
  group: number; // Conditions in the same group are OR'd. Groups are AND'd together.
}

type ConditionType =
  | "data_value" // Check a Data current value
  | "zone_value" // Check a Zone aggregated value
  | "time_range" // Current time is within a range
  | "day_of_week" // Current day matches
  | "scenario_active" // Another Scenario is currently executing
  | "sun_position"; // Before/after sunrise/sunset
```

**Condition config examples:**

```json
{ "type": "data_value", "config": { "dataSource": "equipment.thermostat.mode", "operator": "==", "value": "heat" } }
{ "type": "zone_value", "config": { "zoneId": "zone_salon", "key": "lightsOn", "operator": ">", "value": 0 } }
{ "type": "time_range", "config": { "from": "22:00", "to": "06:00" } }
{ "type": "day_of_week", "config": { "days": ["mon", "tue", "wed", "thu", "fri"] } }
```

#### Actions

What the Scenario does. Actions are executed in order, with optional delays between them.

```typescript
interface Action {
  id: string;
  scenarioId: string;
  type: ActionType;
  config: Record<string, any>;
  delay?: string; // Wait before executing: "5s", "1m", "30m"
  order: number; // Execution order (1, 2, 3...)
}

type ActionType =
  | "execute_order" // Execute an Equipment Order with a value
  | "zone_order" // Execute a Zone auto-Order (allOff, allLightsOff, allLightsOn)
  | "set_computed_data" // Override a computed Data value on an Equipment
  | "notify" // Send a notification (webhook, telegram, etc.)
  | "wait" // Pause execution for a duration
  | "if_then_else" // Conditional block within actions
  | "run_scenario" // Trigger another Scenario
  | "log"; // Log a message for debugging
```

**Action config examples:**

```json
{ "type": "execute_order", "config": { "equipmentId": "xxx", "orderAlias": "set_brightness", "value": 30 } }
{ "type": "zone_order", "config": { "zoneId": "zone_salon", "order": "allLightsOff" } }
{ "type": "notify", "config": { "channel": "telegram", "message": "Mouvement détecté dans le salon!" } }
{ "type": "wait", "config": { "duration": "5s" } }
{ "type": "if_then_else", "config": {
    "condition": { "type": "data_value", "config": { "dataSource": "zone.salon.temperature", "operator": "<", "value": 19 } },
    "then": [ { "type": "execute_order", "config": { "equipmentId": "xxx", "orderAlias": "turn_on" } } ],
    "else": [ { "type": "execute_order", "config": { "equipmentId": "xxx", "orderAlias": "turn_off" } } ]
  }
}
{ "type": "run_scenario", "config": { "scenarioId": "yyy" } }
```

### 5.5 Recipe

A Recipe is a Scenario template with typed parameter slots.

```typescript
interface Recipe {
  id: string; // UUID
  name: string; // "Auto-extinction pièce"
  description: string; // Human-readable description
  author?: string;
  tags: string[]; // ["lighting", "presence", "energy-saving"]
  version: string; // Semver

  slots: RecipeSlot[];
  // The scenario template: same structure as Scenario triggers/conditions/actions
  // but references "{{slot_id}}" placeholders instead of real IDs
  template: {
    triggers: Trigger[];
    conditions: Condition[];
    actions: Action[];
  };
}

interface RecipeSlot {
  id: string; // Slot identifier used in template: "target_zone", "timeout"
  name: string; // Display name: "Target zone"
  description: string; // Help text: "The zone to monitor for presence"
  type: RecipeSlotType;
  required: boolean;
  defaultValue?: any;
  constraints?: {
    // Optional constraints
    equipmentType?: EquipmentType; // For equipment_typed slots
    dataCategory?: DataCategory; // For data slots
    min?: number; // For number slots
    max?: number;
    enumValues?: string[]; // For enum slots
  };
}

type RecipeSlotType =
  | "zone" // User picks a Zone
  | "equipment" // User picks any Equipment
  | "equipment_typed" // User picks an Equipment of a specific type (see constraints.equipmentType)
  | "data" // User picks a specific Data point
  | "order" // User picks a specific Order
  | "number" // User enters a number
  | "duration" // User enters a duration: "5m", "1h"
  | "time" // User enters a time: "22:00"
  | "text" // User enters free text
  | "boolean" // User toggles on/off
  | "enum"; // User picks from predefined values (see constraints.enumValues)
```

**Recipe example: "Auto-extinction pièce"**

```json
{
  "name": "Auto-extinction pièce",
  "description": "Éteint automatiquement les lumières d'une zone quand plus aucun mouvement n'est détecté pendant un certain temps",
  "tags": ["lighting", "presence", "energy-saving"],
  "slots": [
    {
      "id": "zone",
      "name": "Zone cible",
      "type": "zone",
      "required": true,
      "description": "La pièce à surveiller"
    },
    {
      "id": "timeout",
      "name": "Délai sans mouvement",
      "type": "duration",
      "required": true,
      "defaultValue": "15m",
      "description": "Durée sans mouvement avant extinction"
    },
    {
      "id": "time_start",
      "name": "Actif à partir de",
      "type": "time",
      "required": false,
      "defaultValue": "18:00"
    },
    {
      "id": "time_end",
      "name": "Actif jusqu'à",
      "type": "time",
      "required": false,
      "defaultValue": "08:00"
    }
  ],
  "template": {
    "triggers": [
      {
        "type": "zone_event",
        "config": { "zoneId": "{{zone}}", "key": "motion", "value": false, "for": "{{timeout}}" }
      }
    ],
    "conditions": [
      { "type": "time_range", "config": { "from": "{{time_start}}", "to": "{{time_end}}" } }
    ],
    "actions": [
      { "type": "zone_order", "config": { "zoneId": "{{zone}}", "order": "allLightsOff" } }
    ]
  }
}
```

**Instantiation**: when the user applies a Recipe, the engine:

1. Presents the slots as a form in the UI
2. For "zone" slots: shows a Zone picker (dropdown of all Zones)
3. For "equipment_typed" slots: shows only Equipments matching the type constraint
4. For "data" slots: shows Data points matching the category constraint
5. Replaces all `{{slot_id}}` placeholders with the user's choices
6. Creates a new Scenario linked to the Recipe (`recipeId` is set)

---

## 6. Internal Event Bus

All state changes flow through a typed internal event bus. This is the backbone of the reactive architecture.

```typescript
type EngineEvent =
  // Device events
  | { type: "device.discovered"; device: Device }
  | { type: "device.removed"; deviceId: string }
  | { type: "device.status_changed"; deviceId: string; status: DeviceStatus }
  | {
      type: "device.data.updated";
      deviceId: string;
      dataId: string;
      key: string;
      value: any;
      previous: any;
      timestamp: Date;
    }

  // Equipment events
  | { type: "equipment.data.changed"; equipmentId: string; key: string; value: any; previous: any }
  | { type: "equipment.order.executed"; equipmentId: string; orderAlias: string; value: any }

  // Zone events
  | { type: "zone.data.changed"; zoneId: string; key: string; value: any; previous: any }

  // Scenario events
  | { type: "scenario.triggered"; scenarioId: string; triggerId: string }
  | { type: "scenario.action.executing"; scenarioId: string; actionId: string }
  | { type: "scenario.completed"; scenarioId: string; success: boolean; duration: number }
  | { type: "scenario.error"; scenarioId: string; error: string }

  // System events
  | { type: "system.started" }
  | { type: "system.mqtt.connected" }
  | { type: "system.mqtt.disconnected" }
  | { type: "system.error"; error: string };
```

---

## 7. REST API

All API routes are prefixed with `/api/v1`.

### 7.1 Authentication

| Method | Route           | Auth                  | Description                                |
| ------ | --------------- | --------------------- | ------------------------------------------ |
| POST   | `/auth/setup`   | None (first-run only) | Create first admin user                    |
| POST   | `/auth/login`   | None                  | Login, returns JWT access + refresh tokens |
| POST   | `/auth/refresh` | Refresh token         | Rotate tokens                              |
| POST   | `/auth/logout`  | Refresh token         | Revoke refresh token                       |

### 7.2 Current User

| Method | Route            | Auth | Description                            |
| ------ | ---------------- | ---- | -------------------------------------- |
| GET    | `/me`            | Any  | Get current user profile + preferences |
| PUT    | `/me`            | Any  | Update display name, preferences       |
| PUT    | `/me/password`   | Any  | Change password                        |
| GET    | `/me/tokens`     | Any  | List my API tokens                     |
| POST   | `/me/tokens`     | Any  | Create a new API token                 |
| DELETE | `/me/tokens/:id` | Any  | Revoke an API token                    |

### 7.3 Full State (mobile-critical)

| Method | Route          | Auth  | Description                                              |
| ------ | -------------- | ----- | -------------------------------------------------------- |
| GET    | `/state`       | Any   | Full state snapshot (zones, equipments, scenarios, user) |
| POST   | `/quick-order` | user+ | Execute an order in one call                             |

### 7.4 Users (admin only)

| Method | Route        | Auth  | Description    |
| ------ | ------------ | ----- | -------------- |
| GET    | `/users`     | Admin | List all users |
| POST   | `/users`     | Admin | Create user    |
| PUT    | `/users/:id` | Admin | Update user    |
| DELETE | `/users/:id` | Admin | Delete user    |

### 7.5 Zones

| Method | Route                         | Description                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| GET    | `/zones`                      | List all zones (tree structure)                               |
| GET    | `/zones/:id`                  | Get zone with aggregated data                                 |
| POST   | `/zones`                      | Create zone                                                   |
| PUT    | `/zones/:id`                  | Update zone                                                   |
| DELETE | `/zones/:id`                  | Delete zone (must be empty)                                   |
| POST   | `/zones/:id/orders/:orderKey` | Execute a zone auto-order (allOff, allLightsOff, allLightsOn) |

### 7.6 Devices

| Method | Route          | Description                                                   |
| ------ | -------------- | ------------------------------------------------------------- |
| GET    | `/devices`     | List all discovered devices                                   |
| GET    | `/devices/:id` | Get device with all data and orders                           |
| PUT    | `/devices/:id` | Update device (name, zoneId)                                  |
| DELETE | `/devices/:id` | Remove device from engine (re-discovered if still on network) |

### 7.7 Equipments

| Method | Route                           | Description                                        |
| ------ | ------------------------------- | -------------------------------------------------- |
| GET    | `/equipments`                   | List all equipments                                |
| GET    | `/equipments/:id`               | Get equipment with bindings, computed data, orders |
| POST   | `/equipments`                   | Create equipment                                   |
| PUT    | `/equipments/:id`               | Update equipment                                   |
| DELETE | `/equipments/:id`               | Delete equipment                                   |
| POST   | `/equipments/:id/orders/:alias` | Execute an equipment order                         |
| GET    | `/equipments/:id/history/:key`  | Get historical data (proxied to InfluxDB)          |

### 7.8 Scenarios

| Method | Route                | Description                                     |
| ------ | -------------------- | ----------------------------------------------- |
| GET    | `/scenarios`         | List all scenarios                              |
| GET    | `/scenarios/:id`     | Get scenario with triggers, conditions, actions |
| POST   | `/scenarios`         | Create scenario                                 |
| PUT    | `/scenarios/:id`     | Update scenario                                 |
| DELETE | `/scenarios/:id`     | Delete scenario                                 |
| POST   | `/scenarios/:id/run` | Manually trigger a scenario                     |
| GET    | `/scenarios/:id/log` | Get recent execution log                        |

### 7.9 Recipes

| Method | Route                      | Description                                             |
| ------ | -------------------------- | ------------------------------------------------------- |
| GET    | `/recipes`                 | List all recipes                                        |
| GET    | `/recipes/:id`             | Get recipe with slots                                   |
| POST   | `/recipes`                 | Create recipe                                           |
| POST   | `/recipes/:id/instantiate` | Create a Scenario from this recipe (body = slot values) |

### 7.10 Notifications (admin)

| Method | Route                              | Description                   |
| ------ | ---------------------------------- | ----------------------------- |
| GET    | `/notifications/channels`          | List notification channels    |
| POST   | `/notifications/channels`          | Create a notification channel |
| PUT    | `/notifications/channels/:id`      | Update channel                |
| DELETE | `/notifications/channels/:id`      | Delete channel                |
| POST   | `/notifications/channels/:id/test` | Send a test notification      |

### 7.11 WebSocket

Connect to `ws://host:port/ws` for real-time events.

The server pushes all `EngineEvent` objects as JSON over the WebSocket. The client can optionally subscribe to specific event types:

```json
// Client sends subscription filter (optional, default = all events)
{ "subscribe": ["device.data.updated", "equipment.data.changed", "zone.data.changed"] }

// Server pushes events
{ "type": "device.data.updated", "deviceId": "abc", "key": "temperature", "value": 21.5, "previous": 21.3, "timestamp": "..." }
```

---

## 8. SQLite Schema

```sql
-- ============================================================
-- ZONES
-- ============================================================
CREATE TABLE zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  config JSON DEFAULT '{}',         -- Zone-specific config (e.g. presence timeout)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- DEVICES
-- ============================================================
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  mqtt_base_topic TEXT NOT NULL,     -- "zigbee2mqtt"
  mqtt_name TEXT NOT NULL,           -- "salon_pir"
  name TEXT NOT NULL,                -- Display name
  manufacturer TEXT,
  model TEXT,
  ieee_address TEXT,
  zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'zigbee2mqtt',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen DATETIME,
  raw_expose JSON,                   -- Original expose from zigbee2mqtt
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mqtt_base_topic, mqtt_name)
);

CREATE TABLE device_data (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,                -- DataType enum
  category TEXT NOT NULL DEFAULT 'generic', -- DataCategory enum
  value TEXT,                        -- JSON-encoded current value
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
  enum_values JSON,                  -- JSON array of possible values
  unit TEXT,
  UNIQUE(device_id, key)
);

-- ============================================================
-- EQUIPMENTS
-- ============================================================
CREATE TABLE equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'generic', -- EquipmentType enum
  icon TEXT,
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
  UNIQUE(equipment_id, alias)
);

CREATE TABLE computed_data (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'generic',
  expression TEXT NOT NULL,
  value TEXT,                        -- JSON-encoded current value
  UNIQUE(equipment_id, key)
);

CREATE TABLE internal_rules (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  condition_expr TEXT NOT NULL,
  action_expr TEXT NOT NULL,
  enabled INTEGER DEFAULT 1
);

-- ============================================================
-- SCENARIOS
-- ============================================================
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE scenario_triggers (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config JSON NOT NULL
);

CREATE TABLE scenario_conditions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config JSON NOT NULL,
  condition_group INTEGER DEFAULT 0  -- Same group = OR, different groups = AND
);

CREATE TABLE scenario_actions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config JSON NOT NULL,
  delay TEXT,                        -- "5s", "1m", etc.
  action_order INTEGER NOT NULL      -- Execution order
);

-- ============================================================
-- RECIPES
-- ============================================================
CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  tags JSON DEFAULT '[]',
  version TEXT DEFAULT '1.0.0',
  slots JSON NOT NULL,               -- RecipeSlot[] as JSON
  template JSON NOT NULL,            -- { triggers, conditions, actions } as JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SCENARIO EXECUTION LOG
-- ============================================================
CREATE TABLE scenario_log (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  triggered_at DATETIME NOT NULL,
  trigger_id TEXT,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  actions_executed JSON              -- Summary of actions executed
);

-- Keep only last 1000 entries per scenario (cleanup via engine periodic task)
```

---

## 9. InfluxDB Schema (time-series history)

```
Measurement: "data_history"

Tags (indexed, for filtering):
  - device_id        (string)
  - equipment_id     (string, nullable)
  - zone_id          (string)
  - key              (string, e.g. "temperature", "state")
  - category         (string, DataCategory)

Fields (values):
  - value_number     (float, for numeric data)
  - value_string     (string, for enum/text/boolean data)

Retention policies:
  - "raw"     →  7 days    (every data point as received)
  - "hourly"  → 90 days    (downsampled: avg, min, max per hour)
  - "daily"   →  5 years   (downsampled: avg, min, max per day)

Downsampling is handled by InfluxDB continuous queries / tasks.
```

---

## 10. Project Structure

```
winch/
├── docker-compose.yml              # Engine + InfluxDB
├── package.json
├── tsconfig.json
├── .env.example                    # MQTT_URL, INFLUX_URL, etc.
│
├── src/
│   ├── index.ts                    # Entry point: bootstrap all managers, start Fastify
│   ├── config.ts                   # Environment config loading
│   │
│   ├── core/
│   │   ├── event-bus.ts            # Typed EventEmitter
│   │   ├── database.ts             # SQLite connection + migrations
│   │   ├── influx.ts               # InfluxDB client
│   │   └── logger.ts               # Structured logging
│   │
│   ├── mqtt/
│   │   ├── mqtt-connector.ts       # MQTT client wrapper, connect/subscribe/publish
│   │   └── parsers/
│   │       ├── zigbee2mqtt.ts       # Parse zigbee2mqtt bridge/devices and state messages
│   │       ├── tasmota.ts           # Parse Tasmota MQTT conventions
│   │       └── generic.ts           # Fallback parser for custom MQTT devices
│   │
│   ├── devices/
│   │   ├── device-manager.ts       # CRUD + auto-discovery orchestration
│   │   ├── device-data.ts          # DeviceData state management
│   │   └── category-inference.ts   # Infer DataCategory from expose/key patterns
│   │
│   ├── equipments/
│   │   ├── equipment-manager.ts    # CRUD + binding management
│   │   ├── computed-engine.ts      # Expression parser + evaluator for ComputedData
│   │   ├── order-dispatcher.ts     # Execute Equipment Orders → Device Orders
│   │   └── internal-rules.ts       # Evaluate and execute Equipment internal rules
│   │
│   ├── zones/
│   │   ├── zone-manager.ts         # CRUD + tree structure
│   │   └── zone-aggregator.ts      # Auto-aggregation engine
│   │
│   ├── scenarios/
│   │   ├── scenario-engine.ts      # Trigger evaluation + action execution pipeline
│   │   ├── trigger-evaluator.ts    # Evaluate each trigger type
│   │   ├── condition-evaluator.ts  # Evaluate conditions
│   │   ├── action-executor.ts      # Execute each action type
│   │   └── recipe-manager.ts       # Recipe CRUD + instantiation
│   │
│   ├── integrations/
│   │   ├── integration-registry.ts # IntegrationPlugin interface + registry
│   │   ├── zigbee2mqtt/            # Zigbee2MQTT plugin (wraps MqttConnector + parser)
│   │   ├── panasonic-cc/           # Panasonic Comfort Cloud plugin (AC units)
│   │   └── mcz-maestro/            # MCZ Maestro plugin (pellet stoves)
│   │
│   ├── ai/
│   │   ├── ai-manager.ts           # Orchestrator: intent detection, context building, response handling
│   │   ├── context-builder.ts      # Build compact home context JSON for LLM prompts
│   │   ├── prompt-templates.ts     # System prompt templates per intent
│   │   ├── response-validator.ts   # Validate LLM structured output against schemas
│   │   ├── suggestion-engine.ts    # Proactive scenario suggestions (V1.2)
│   │   └── providers/
│   │       ├── provider.ts          # LLMProvider interface
│   │       ├── claude.ts            # Claude API implementation
│   │       ├── openai.ts            # OpenAI API implementation
│   │       └── ollama.ts            # Ollama local implementation
│   │
│   ├── auth/
│   │   ├── auth-manager.ts         # JWT + API token issuance and validation
│   │   ├── password.ts             # bcrypt hash/verify
│   │   ├── middleware.ts           # Fastify auth hooks (authenticate, authorize by role)
│   │   └── setup.ts               # First-run setup mode
│   │
│   ├── users/
│   │   ├── user-manager.ts         # User CRUD
│   │   └── preferences.ts          # User preferences management
│   │
│   ├── notifications/
│   │   ├── notification-manager.ts  # Dispatch notifications to channels
│   │   ├── channels/
│   │   │   ├── telegram.ts
│   │   │   ├── webhook.ts
│   │   │   ├── fcm.ts              # Firebase Cloud Messaging
│   │   │   ├── ntfy.ts             # ntfy.sh push
│   │   │   └── email.ts
│   │   └── channel-registry.ts     # Channel type registry
│   │
│   ├── api/
│   │   ├── server.ts               # Fastify setup + plugin registration
│   │   ├── websocket.ts            # WebSocket handler (auth + event buffer + reconnection)
│   │   └── routes/
│   │       ├── auth.ts             # login, refresh, logout, setup
│   │       ├── ai.ts              # AI prompt, confirm, reject, suggestions, config
│   │       ├── me.ts               # current user profile, preferences, tokens
│   │       ├── users.ts            # admin: user management
│   │       ├── state.ts            # GET /state — full state snapshot
│   │       ├── quick-order.ts      # POST /quick-order
│   │       ├── zones.ts
│   │       ├── devices.ts
│   │       ├── equipments.ts
│   │       ├── scenarios.ts
│   │       ├── recipes.ts
│   │       └── notifications.ts    # notification channels CRUD
│   │
│   └── shared/
│       ├── types.ts                # All TypeScript interfaces and types (shared with frontend)
│       └── constants.ts            # DataCategory mappings, EquipmentType, etc.
│
├── ui/                             # React frontend (separate Vite project)
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── store/                  # Zustand stores
│       │   ├── useDevices.ts
│       │   ├── useEquipments.ts
│       │   ├── useZones.ts
│       │   └── useWebSocket.ts     # WebSocket connection + event dispatch to stores
│       ├── components/
│       │   ├── layout/
│       │   ├── dashboard/
│       │   ├── devices/
│       │   ├── equipments/
│       │   ├── zones/
│       │   ├── scenarios/
│       │   └── recipes/
│       └── pages/
│           ├── Dashboard.tsx
│           ├── Devices.tsx
│           ├── Equipments.tsx
│           ├── Zones.tsx
│           ├── Scenarios.tsx
│           └── Settings.tsx
│
├── recipes/                        # Built-in Recipe JSON files
│   ├── auto-lights-off.json
│   ├── night-mode.json
│   └── temperature-alert.json
│
└── migrations/                     # SQLite migrations
    ├── 001_initial.sql
    └── ...
```

---

## 11. Development Roadmap

> **Roadmap changes vs. original plan:**
>
> 1. **Incremental UI** — each backend version ships its corresponding UI pages (not bundled in a single V0.4)
> 2. **Topology first** — Zones implemented before Equipments, so users define spatial structure first
> 3. **Equipment Groups removed** — replaced by automatic UI-level grouping by equipment type (Lights, Shutters, Sensors, etc.) in the Home view. No backend entity needed.
> 4. **Version numbering** — adjusted to reflect actual implementation order

### V0.1 — MQTT + Devices + UI ✅

- MQTT connector (connect, subscribe, publish)
- zigbee2mqtt parser: read `bridge/devices`, parse exposes, auto-create Devices with Data and Orders
- Subscribe to device state topics, update DeviceData values in real-time
- SQLite setup with migrations
- Internal event bus, basic logging
- REST API for Devices + Health
- WebSocket: auto-reconnect, live updates
- **UI**: React 18 + Vite + Tailwind + Zustand + React Router. Device list (sortable, filterable), device detail, collapsible sidebar, connection status, mobile bottom nav
- **Deliverable**: engine connects to MQTT, discovers devices, tracks state, web UI to browse devices

### V0.2 — Zones + UI ✅

- Zone CRUD with hierarchical nesting (Home → Floor → Room)
- Circular reference detection, delete guards
- Zone tree API endpoint
- **UI**: Zone tree view, zone detail page
- **Deliverable**: spatial topology defined

### V0.3 — Equipments + Bindings + Orders + UI ✅

- Equipment CRUD (14 types, 8 UI-supported)
- DataBinding / OrderBinding (link Equipment to Device Data/Orders)
- Multi-device dispatch: same alias → multiple DeviceOrders → parallel MQTT publish
- Reactive pipeline: `device.data.updated` → bindings → `equipment.data.changed`
- Order execution: `POST /equipments/:id/orders/:alias` → MQTT publish
- **UI**: Equipment list (grouped by zone), equipment detail, create wizard (2 steps: info → device selection), light toggle + brightness slider, equipment card with quick controls
- **Deliverable**: Equipments created, bound to Devices, controllable via UI

### V0.4 — UI Restructuring ✅

- Sidebar reorganized: **Home** (daily use) + **Settings** (Devices, Equipments, Zones)
- Home page with zone treeview navigation (Home > Floor > Room)
- Clicking a zone shows its equipments grouped by type (Lights, Shutters, Sensors, Switches)
- Equipment grouping is UI-only (automatic by `EquipmentType`, no backend entity)
- CompactEquipmentCard with inline controls for lights and shutters
- **Deliverable**: zone-centric daily dashboard

### V0.5 — Sensor Equipment Support ✅

- Sensor types fully supported: `sensor`, `motion_sensor`, `contact_sensor`
- Auto-adaptive sensor UI: icon, color, and value display based on DataCategory
- Multi-value sensor display (temperature + humidity on same card)
- Battery level indicator with color-coded icon
- Boolean sensor formatting (motion: Mouvement/Calme, contact: Ouverte/Fermée)
- SensorDataPanel for equipment detail page
- **Deliverable**: sensor equipments rendered with rich, adaptive UI

### V0.6 — Zone Aggregation Engine ✅

- Bottom-up aggregation: leaf zones first, then parent chain
- 15 aggregated fields: temperature, humidity, luminosity (AVG), motion (OR), motionSensors (COUNT), motionSince (timestamp), lightsOn/lightsTotal (COUNT), shuttersOpen/shuttersTotal (COUNT), averageShutterPosition (AVG), openDoors, openWindows (COUNT), waterLeak, smoke (OR)
- Three-level cache (direct, merged, public) with incremental updates
- Recursive: parent Zone merges its own data + all child Zone accumulators
- Event-driven: recomputes on equipment.data.changed, zone CRUD, system.started
- **UI**: ZoneAggregationHeader with pills (temperature, humidity, luminosity, motion with duration, lights count, shutter count + position, door/window alerts, water/smoke alerts)
- Zustand store: `useZoneAggregation`
- **Deliverable**: automatic zone status dashboard with real-time aggregation

### V0.7 — Shutter Equipment Support ✅

- Shutter controls: Open / Stop / Close buttons + position display
- Position labels: "Fermé" (0%), "Ouvert" (100%), numeric % in between
- ShutterControl component for equipment detail page
- Shutter controls in EquipmentCard (equipment list) and CompactEquipmentCard (home view)
- Zone aggregation: shuttersOpen/shuttersTotal/averageShutterPosition
- 8 supported equipment types in creation form
- **Deliverable**: full shutter control and aggregation

### V0.8 — Computed Data + Internal Rules

- Expression parser and evaluator (safe, no `eval`)
- Computed Data on Equipments (OR, AVG, IF, etc.)
- Internal Rules engine
- Computed data editor in equipment detail
- **Deliverable**: virtual Equipments that aggregate multiple Devices

### V0.9 — Scenario Engine

- Trigger evaluation engine (subscribe to event bus, evaluate trigger conditions)
- Duration-based triggers ("no motion for 15 minutes")
- Condition evaluation
- Action execution pipeline (sequential, with delays)
- If/then/else action blocks
- Scenario CRUD via API
- UI: Scenario list, Scenario editor (trigger/condition/action builder)
- Execution log
- **Deliverable**: working automation engine

### V0.10 — Recipes

- Recipe data model and CRUD
- Recipe instantiation (slot filling → Scenario creation)
- Built-in recipes (auto-lights-off, night-mode, temperature-alert, etc.)
- UI: Recipe catalog, slot-filling wizard with smart matching (suggest compatible Zones/Equipments for each slot)
- **Deliverable**: reusable automation templates

### V0.10a — Integration Plugin Architecture

- Generic `IntegrationPlugin` interface: `id`, `name`, `start()`, `stop()`, `executeOrder()`, `getSettingsSchema()`
- `IntegrationRegistry` manages plugin lifecycle and order routing
- Zigbee2MQTT refactored as a plugin
- Dynamic settings per plugin (UI-configurable)
- Order dispatch routes to correct plugin based on device source
- **Deliverable**: extensible multi-source device support

### V0.10b — Panasonic Comfort Cloud Integration

- `PanasonicCCIntegration` plugin (cloud API bridge + polling)
- Auto-discovery of AC units as Winch Devices (source: `panasonic_cc`)
- Data: indoor/outdoor temperature, operating mode, fan speed, power state
- Orders: set temperature, mode, fan speed, power on/off
- `thermostat` equipment type with full UI (ThermostatCard)
- **Deliverable**: Panasonic AC control from Winch

### V0.10c — MCZ Maestro Integration

- `MczMaestroIntegration` plugin (Socket.IO cloud bridge + polling)
- Auto-discovery of pellet stoves as Winch Devices (source: `mcz_maestro`)
- Data: ambient/smoke/water temperature, stove state, power level, fan speeds, alarms
- Orders: set temperature, power on/off, power level, eco/chrono/silent mode, reset alarm
- Stove state badge on ThermostatCard + always-visible reset alarm button
- **Deliverable**: MCZ pellet stove control from Winch

### V0.11 — History

- InfluxDB integration
- Write Data changes to InfluxDB
- Retention policies and downsampling
- API for historical queries
- UI: time-series charts on Equipment and Zone pages
- **Deliverable**: historical data visualization

### V0.12 — Polish

- Device availability tracking
- Notification system (Telegram, webhooks)
- Sunrise/sunset trigger support (requires GPS coordinates in config)
- Equipment type auto-suggestion from Device capabilities
- Multi-source support (tasmota, esphome parsers)
- Docker packaging
- PM2 configuration
- **Deliverable**: production-ready for personal use

### V1.0 — AI Assistant: Natural Language Scenarios

- LLM provider abstraction layer (Claude API, OpenAI, Ollama)
- AI configuration page in Settings (provider, API key, model selection)
- Context builder: serialize current home state (zones, equipments, data, orders) as compact JSON
- Intent 1: create_scenario — user describes a scenario in natural language, LLM returns structured Scenario JSON
- Validation engine: verify all IDs, types, order aliases, value ranges in LLM output
- Retry logic: on validation failure, re-prompt LLM with error details (max 1 retry)
- UI: chat panel (floating button), scenario preview card with Confirm / Edit / Reject buttons
- "Edit" opens the proposed scenario in the visual scenario editor (pre-filled)
- AI interaction log (stored in SQLite for debugging)
- **Deliverable**: users can create scenarios by describing them in plain language

### V1.1 — AI Assistant: Conversational & Actions

- Intent 2: ask_question — user asks about their home state, LLM responds in natural language
- Intent 3: execute_action — user requests an action ("turn off everything in the living room"), LLM returns action array, user confirms before execution
- Chat history within a session (context carries over for multi-turn conversations)
- Multi-language support (the LLM responds in the same language as the user)
- **Deliverable**: full conversational assistant integrated in the UI

### V1.2 — AI Assistant: Proactive Suggestions

- Intent 4: suggest — engine periodically analyzes home setup and proposes useful scenarios
- Detection of equipments not used in any scenario
- Detection of repeated manual actions that could be automated (based on scenario_log and order execution history)
- UI: suggestions panel in dashboard, dismissible cards with "Create this scenario" shortcut
- **Deliverable**: the assistant proactively helps optimize the home

### V1.3 — AI Assistant: Anomaly Detection

- Periodic analysis of InfluxDB history via LLM (daily digest)
- Detect anomalies: unusual temperature, missing sensor data, device offline patterns
- Notify user via their preferred notification channels
- UI: anomaly timeline in dashboard
- **Deliverable**: intelligent monitoring that spots what humans miss

---

## 12. Configuration

The engine is configured via environment variables (`.env` file):

```env
# MQTT
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_CLIENT_ID=winch

# Zigbee2MQTT
Z2M_BASE_TOPIC=zigbee2mqtt

# Database
SQLITE_PATH=./data/winch.db

# InfluxDB
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=my-token
INFLUX_ORG=winch
INFLUX_BUCKET=winch

# Server
API_PORT=3000
API_HOST=0.0.0.0

# Location (for sunrise/sunset calculations)
LATITUDE=48.8566
LONGITUDE=2.3522
TIMEZONE=Europe/Paris

# Logging
LOG_LEVEL=info
```

---

## 13. Users, Authentication & Mobile-ready Architecture

### 13.1 User Model

The engine supports multiple users with roles. This is foundational — even if there's initially one user, the architecture must support multi-user from day one.

```typescript
interface User {
  id: string; // UUID
  username: string; // Unique login
  displayName: string; // "Marc", "Sophie"
  email?: string; // Optional, used for notifications
  passwordHash: string; // bcrypt hash
  role: UserRole;
  preferences: UserPreferences;
  enabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type UserRole =
  | "admin" // Full access: config, users, devices, scenarios, everything
  | "user" // Can control equipments, view data, run scenarios. Cannot manage devices or users.
  | "viewer"; // Read-only: can view dashboard, data, history. Cannot execute orders or run scenarios.

interface UserPreferences {
  language: "fr" | "en"; // UI language
  temperatureUnit: "celsius" | "fahrenheit";
  timezone: string; // "Europe/Paris"
  defaultZoneId?: string; // Default dashboard zone
  notificationChannels: string[]; // Which notification channels this user subscribes to
  dashboardLayout?: object; // User-specific dashboard widget layout (JSON)
}
```

#### SQLite Schema addition

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  preferences JSON DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  last_login_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API tokens: long-lived tokens for mobile apps, third-party integrations, scripts
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- "iPhone Marc", "Tablet Salon", "Home script"
  token_hash TEXT NOT NULL,        -- SHA-256 hash of the token (never store raw)
  scopes JSON DEFAULT '["*"]',    -- Allowed scopes: ["*"] = all, or ["read", "control", "admin"]
  last_used_at DATETIME,
  expires_at DATETIME,            -- null = never expires
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Active refresh tokens (for JWT flow)
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  device_info TEXT,               -- "iPhone 15 / iOS 18" (from User-Agent or client metadata)
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 13.2 Authentication

The engine supports **two authentication methods** in parallel. Any client (web, mobile app, script, Home Assistant integration) can use either.

#### Method 1: JWT (for interactive sessions — web UI, mobile apps)

```
POST /api/v1/auth/login
  Body: { "username": "marc", "password": "..." }
  Response: { "accessToken": "eyJ...", "refreshToken": "abc...", "expiresIn": 900, "user": { ... } }

POST /api/v1/auth/refresh
  Body: { "refreshToken": "abc..." }
  Response: { "accessToken": "eyJ...", "refreshToken": "def...", "expiresIn": 900 }

POST /api/v1/auth/logout
  Body: { "refreshToken": "abc..." }
  → Revokes the refresh token
```

- Access token: short-lived (15 min), contains `{ userId, role, scopes }`, signed with HS256
- Refresh token: long-lived (30 days), stored hashed in `refresh_tokens` table, rotated on each refresh
- Tokens are passed via `Authorization: Bearer <accessToken>` header

#### Method 2: API Token (for long-lived integrations — mobile apps that want persistent auth, scripts, third-party)

```
# Create via API (requires admin role)
POST /api/v1/auth/tokens
  Body: { "name": "iPhone Marc", "scopes": ["*"], "expiresAt": null }
  Response: { "token": "wch_xxxxxxxxxxxx", "id": "..." }
  # The raw token is returned ONCE at creation. Store it securely.

# Usage: pass as Bearer token or as query param (for WebSocket)
Authorization: Bearer wch_xxxxxxxxxxxx
# or
ws://host:3000/ws?token=wch_xxxxxxxxxxxx
```

- Token prefix: `wch_` (winch) for easy identification
- Scopes: `["*"]` (all), `["read"]` (view only), `["read", "control"]` (view + execute orders), `["read", "control", "admin"]` (everything)
- Tokens can be revoked individually

#### WebSocket authentication

WebSocket connections must authenticate on connect:

```
// Option A: token as query parameter
ws://host:3000/ws?token=wch_xxxxxxxxxxxx

// Option B: token in first message after connect
→ Client sends: { "type": "auth", "token": "eyJ..." }
← Server replies: { "type": "auth_ok", "user": { "id": "...", "role": "user" } }
  or
← Server replies: { "type": "auth_error", "message": "Invalid token" }
  → Server closes connection after 5s if no valid auth received
```

#### Permission enforcement

All API routes and WebSocket events respect the user's role:

| Action                           | admin | user | viewer |
| -------------------------------- | ----- | ---- | ------ |
| View dashboard, data, history    | ✓     | ✓    | ✓      |
| Execute orders (equipment, zone) | ✓     | ✓    | ✗      |
| Run scenarios manually           | ✓     | ✓    | ✗      |
| Create/edit equipments           | ✓     | ✗    | ✗      |
| Create/edit scenarios, recipes   | ✓     | ✓    | ✗      |
| Manage devices                   | ✓     | ✗    | ✗      |
| Manage zones                     | ✓     | ✗    | ✗      |
| Manage users, tokens             | ✓     | ✗    | ✗      |
| System settings                  | ✓     | ✗    | ✗      |

### 13.3 API Design for Multi-client

The API must be equally usable by the web UI, a native mobile app (React Native, Flutter, Swift, Kotlin), a script, or a third-party integration. Key design principles:

#### Full-state endpoint (critical for mobile)

```
GET /api/v1/state
```

Returns the complete current state in a single response. This is what a mobile app calls on launch to hydrate its local state before switching to WebSocket for live updates.

```json
{
  "zones": [
    {
      "id": "...",
      "name": "Salon",
      "parentId": null,
      "aggregatedData": { "motion": false, "temperature": 21.3, "lightsOn": 2, "lightsTotal": 4 },
      "children": [ { "id": "...", "name": "Coin TV", ... } ]
    }
  ],
  "equipments": [
    {
      "id": "...",
      "name": "Spots Salon",
      "zoneId": "...",
      "type": "dimmer",
      "data": { "state": "on", "brightness": 180 },
      "orders": ["turn_on", "turn_off", "set_brightness"]
    }
  ],
  "scenarios": [
    { "id": "...", "name": "Extinction salon", "enabled": true, "lastTriggered": "..." }
  ],
  "user": { "id": "...", "displayName": "Marc", "role": "admin", "preferences": { ... } }
}
```

#### Quick action endpoint

```
POST /api/v1/quick-order
Body: { "equipmentId": "xxx", "orderAlias": "set_brightness", "value": 128 }
Response: { "success": true }
```

Single-call shortcut for the most common operation. Mobile apps use this for toggle buttons, sliders, etc.

#### WebSocket reconnection with state recovery

Mobile clients lose connection frequently (sleep, network switch). The WebSocket must support recovery:

```
// On reconnect, client sends its last known event timestamp
→ { "type": "auth", "token": "...", "lastEventAt": "2026-02-16T14:30:00Z" }

// Server responds with either:
// A) Incremental catch-up (if gap < 5 min and events buffered)
← { "type": "auth_ok", "recovery": "incremental", "events": [ ...missed events... ] }

// B) Full state refresh (if gap too large or buffer exhausted)
← { "type": "auth_ok", "recovery": "full_state", "state": { ...same as GET /state... } }
```

The engine keeps a **circular event buffer** in memory (last 5 minutes of events, configurable) for catch-up.

#### User preferences endpoint

```
GET /api/v1/me
PUT /api/v1/me
  Body: { "displayName": "Marc", "preferences": { "language": "fr", ... } }

PUT /api/v1/me/password
  Body: { "currentPassword": "...", "newPassword": "..." }

GET /api/v1/me/tokens         -- List my API tokens
POST /api/v1/me/tokens        -- Create a new API token
DELETE /api/v1/me/tokens/:id  -- Revoke a token
```

### 13.4 Notification System

Notifications are sent by Scenario actions or system alerts. Each user subscribes to the channels they want.

```typescript
interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string; // "Telegram Marc", "Webhook Home"
  config: Record<string, any>; // Channel-specific config
  enabled: boolean;
}

type NotificationChannelType =
  | "telegram" // config: { botToken, chatId }
  | "webhook" // config: { url, method, headers }
  | "push_fcm" // config: { fcmToken } — Firebase Cloud Messaging
  | "push_ntfy" // config: { serverUrl, topic } — ntfy.sh (self-hosted)
  | "email"; // config: { smtpHost, smtpPort, from, to }

// Users link to channels
interface UserNotificationChannel {
  userId: string;
  channelId: string;
  // A user can subscribe to specific channels
}
```

#### SQLite Schema addition

```sql
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSON NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_notification_channels (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);
```

In Scenario actions, `notify` now accepts a target:

```json
{
  "type": "notify",
  "config": {
    "target": "all", // "all" = all users, or specific userId, or "admin" = admin users only
    "title": "Alerte",
    "message": "Mouvement détecté dans le salon!",
    "priority": "high" // "low", "normal", "high" — channels can filter by priority
  }
}
```

### 13.5 HTTPS & Remote Access

The engine itself runs HTTP (no TLS). For remote access (mobile app outside local network), the recommended setup is a reverse proxy.

The engine must:

- Trust `X-Forwarded-For`, `X-Forwarded-Proto` headers (configurable: `TRUST_PROXY=true`)
- Work correctly behind a path prefix (e.g. `/winch/api/v1/...`) if needed
- Support CORS with configurable allowed origins (for web and mobile WebView)

```env
# Additional env vars
TRUST_PROXY=false
CORS_ORIGINS=http://localhost:5173,https://home.example.com
JWT_SECRET=change-me-to-a-random-string
JWT_ACCESS_TTL=900           # seconds (15 min)
JWT_REFRESH_TTL=2592000      # seconds (30 days)
EVENT_BUFFER_SIZE=1000       # circular event buffer for WS reconnection
EVENT_BUFFER_TTL=300         # seconds (5 min)
```

### 13.6 First-run Setup

On first launch with an empty database, the engine enters **setup mode**:

1. The API only exposes `POST /api/v1/setup` (all other routes return 403)
2. The setup endpoint creates the first admin user:
   ```json
   { "username": "admin", "password": "...", "displayName": "Marc", "language": "fr" }
   ```
3. After setup, the engine restarts in normal mode

This ensures the engine is never exposed without authentication.

---

## 14. AI Assistant

### 14.1 Overview

Winch integrates an optional AI assistant that allows users to interact with their home in natural language. The AI layer is **provider-agnostic** — it can use Claude API, OpenAI API, or a local model via Ollama.

The AI is never autonomous — it always proposes, the user confirms.

### 14.2 LLM Provider Abstraction

```typescript
interface LLMProvider {
  id: string;
  name: string;
  sendPrompt(systemPrompt: string, userMessage: string): Promise<string>;
}

interface LLMConfig {
  provider: "claude" | "openai" | "ollama" | "none"; // "none" = AI features disabled
  apiKey?: string; // For Claude / OpenAI
  model: string; // "claude-sonnet-4-5-20250929", "gpt-4o", "llama3", etc.
  ollamaUrl?: string; // "http://localhost:11434" for local Ollama
  temperature: number; // 0.1 for structured output, 0.7 for conversational
  maxTokens: number; // 2000 default
}
```

Provider implementations:

| Provider                  | Cost        | Latency                     | Quality               | Setup         |
| ------------------------- | ----------- | --------------------------- | --------------------- | ------------- |
| Claude API (Sonnet)       | ~$0.003/req | 1-3s                        | Excellent             | API key       |
| OpenAI (GPT-4o)           | ~$0.005/req | 1-3s                        | Excellent             | API key       |
| Ollama (Llama 3, Mistral) | Free        | 2-10s (depends on hardware) | Good for simple tasks | Local install |

The user configures their provider in Settings. If `provider: "none"`, all AI features are hidden from the UI.

#### SQLite Schema addition

```sql
CREATE TABLE ai_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'none',
  api_key_encrypted TEXT,         -- AES-256 encrypted API key
  model TEXT DEFAULT '',
  ollama_url TEXT DEFAULT 'http://localhost:11434',
  temperature REAL DEFAULT 0.2,
  max_tokens INTEGER DEFAULT 2000,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI interaction log (for debugging and improvement)
CREATE TABLE ai_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  intent TEXT NOT NULL,           -- "create_scenario", "ask_question", "execute_action"
  user_message TEXT NOT NULL,     -- What the user typed
  system_prompt_hash TEXT,        -- Hash of system prompt (for debugging, not full prompt)
  llm_response TEXT NOT NULL,     -- Raw LLM response
  parsed_result JSON,             -- Parsed structured output (if applicable)
  validation_errors JSON,         -- Any validation errors found
  accepted INTEGER,               -- 1 = user accepted, 0 = user rejected, null = pending
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 14.3 Context Builder

Every AI request includes the home context so the LLM can reference real IDs. The context builder generates a compact representation of the current state.

```typescript
interface AIContext {
  zones: {
    id: string;
    name: string;
    parentName: string | null;
    aggregatedData: Record<string, any>; // Current aggregation values
  }[];
  equipments: {
    id: string;
    name: string;
    zoneName: string;
    type: EquipmentType;
    currentData: Record<string, any>; // Current data values with aliases
    availableOrders: {
      alias: string;
      type: DataType;
      min?: number;
      max?: number;
      enumValues?: string[];
    }[];
  }[];
  scenarios: {
    id: string;
    name: string;
    enabled: boolean;
  }[];
}
```

The context is serialized as compact JSON and injected into the system prompt. For a typical home (5 zones, 20 equipments), this is ~2-3KB — well within any LLM context window.

### 14.4 AI Intents

The AI assistant handles four distinct intents. The intent is detected from the user message by the LLM itself (first pass), then processed accordingly.

#### Intent 1: Create Scenario

User says: _"Éteins les lumières du salon si personne depuis 10 minutes après 22h"_

System prompt template:

```
You are the AI assistant for Winch, a home automation engine.

The user wants to create an automation scenario. Based on their request and the home context below, generate a valid Scenario JSON object.

RULES:
- Respond ONLY with a valid JSON object, no other text
- Use real IDs from the home context
- The JSON must match the Scenario schema exactly
- If something is ambiguous, make reasonable assumptions

HOME CONTEXT:
{context_json}

SCENARIO SCHEMA:
{scenario_schema}

AVAILABLE TRIGGER TYPES: data_change, data_threshold, zone_event, time_cron, time_sunset, time_sunrise, manual
AVAILABLE CONDITION TYPES: data_value, zone_value, time_range, day_of_week, sun_position
AVAILABLE ACTION TYPES: execute_order, zone_order, set_computed_data, notify, wait, if_then_else, run_scenario, log
```

Flow:

1. User types natural language request
2. Engine builds system prompt with home context + scenario schema
3. LLM returns JSON
4. Engine **validates** the JSON:
   - All referenced zone/equipment/data IDs exist
   - Trigger/condition/action types are valid
   - Order aliases exist on the referenced equipments
   - Numeric values are within min/max bounds
5. If validation passes → present the scenario in the visual editor for user review
6. If validation fails → retry once with error feedback appended, or show error to user
7. User reviews, optionally edits, then confirms → Scenario is created

#### Intent 2: Ask Question

User says: _"Quelle est la température du salon ?"_ or _"Combien de lumières sont allumées ?"_

System prompt:

```
You are the AI assistant for Winch. Answer the user's question about their home based on the current state.
Answer in the same language as the user. Be concise.

CURRENT HOME STATE:
{context_json}
```

The LLM responds with a natural language answer. No structured output needed.

#### Intent 3: Execute Action

User says: _"Éteins tout dans le salon"_ or _"Mets la lumière de la chambre à 50%"_

System prompt:

```
You are the AI assistant for Winch. The user wants to perform an action on their home.
Generate a JSON array of actions to execute.

Respond ONLY with a JSON array of action objects:
[
  { "type": "execute_order", "equipmentId": "...", "orderAlias": "...", "value": ... },
  { "type": "zone_order", "zoneId": "...", "order": "allLightsOff" }
]

HOME CONTEXT:
{context_json}
```

Flow:

1. LLM returns action array
2. Engine validates all IDs and orders
3. Engine presents a confirmation to the user: "I will: turn off all lights in Salon. Confirm?"
4. User confirms → actions are executed
5. Engine sends back the result

#### Intent 4: Suggest Scenarios (proactive)

This is triggered by the engine periodically (e.g. weekly) or on-demand. The engine sends usage patterns to the LLM and asks for scenario suggestions.

System prompt:

```
You are the AI assistant for Winch. Analyze the user's home setup and suggest useful automation scenarios they might want.

Consider:
- Equipments that exist but are not used in any scenario
- Common home automation patterns (lights off when no presence, night mode, etc.)
- The zone structure and equipment types available

Respond with a JSON array of suggestions:
[
  { "title": "...", "description": "...", "scenario": { ...scenario JSON... } }
]

HOME CONTEXT:
{context_json}

EXISTING SCENARIOS:
{scenarios_json}
```

### 14.5 API Endpoints

| Method | Route                    | Auth  | Description                                                         |
| ------ | ------------------------ | ----- | ------------------------------------------------------------------- |
| POST   | `/ai/prompt`             | user+ | Send a natural language message. Returns intent detection + result. |
| POST   | `/ai/prompt/:id/confirm` | user+ | Confirm a pending action or scenario creation                       |
| POST   | `/ai/prompt/:id/reject`  | user+ | Reject a pending proposal                                           |
| GET    | `/ai/suggestions`        | user+ | Get proactive scenario suggestions                                  |
| GET    | `/ai/config`             | admin | Get AI configuration                                                |
| PUT    | `/ai/config`             | admin | Update AI configuration (provider, API key, model)                  |
| GET    | `/ai/log`                | admin | Get AI interaction log                                              |

#### Prompt response format

```typescript
interface AIPromptResponse {
  id: string; // Interaction ID (for confirm/reject)
  intent: "create_scenario" | "ask_question" | "execute_action" | "suggest";
  message: string; // Natural language response to display to user

  // Only for create_scenario intent:
  scenario?: Scenario; // Proposed scenario (needs confirmation)

  // Only for execute_action intent:
  actions?: Action[]; // Proposed actions (needs confirmation)

  // Only for ask_question intent:
  answer?: string; // Direct answer text

  status: "confirmed" | "pending_confirmation" | "answered" | "error";
  error?: string;
}
```

### 14.6 UI Integration

The AI assistant appears as a **chat panel** accessible from any page (floating button bottom-right, or dedicated tab in navigation).

```
┌──────────────────────────────────┐
│  🤖 Winch Assistant             │
├──────────────────────────────────┤
│                                  │
│  User: Éteins tout dans le       │
│  salon si personne pendant       │
│  10 minutes le soir              │
│                                  │
│  Winch: J'ai préparé ce         │
│  scénario:                       │
│  ┌────────────────────────────┐  │
│  │ Extinction salon            │  │
│  │ Trigger: Zone Salon,        │  │
│  │   motion=false, 10min       │  │
│  │ Condition: 22:00-06:00      │  │
│  │ Action: Salon allLightsOff  │  │
│  └────────────────────────────┘  │
│                                  │
│  [✓ Créer]  [✏️ Modifier]  [✗]   │
│                                  │
├──────────────────────────────────┤
│  [Message...]              [➤]   │
└──────────────────────────────────┘
```

- "Créer" → confirms and creates the scenario
- "Modifier" → opens the scenario in the visual editor pre-filled
- "✗" → rejects

For execute_action intents, the confirmation shows the list of actions about to be executed with a single "Exécuter" button.

---

## 15. Design System

### 14.1 Brand Identity

**Winch** — the invisible structure of your smart home.

The design language draws from the winch: structural elegance, hidden strength, clean lines. The beauty of architecture that holds everything together invisibly. The UI should feel warm but precise, calm but informative. Not dark-tech aggressive, not corporate cold.

### 14.2 Color Palette

#### Light mode (default)

| Token            | Hex       | Usage                                                                                                    |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `primary`        | `#1B6B5A` | Main brand color. Navigation, active states, primary buttons. Main brand, evokes structural strength.    |
| `primary-light`  | `#E8F4F0` | Subtle backgrounds, selected states, hover tints                                                         |
| `primary-hover`  | `#155A4A` | Primary button hover                                                                                     |
| `accent`         | `#D4873F` | CTA buttons, important actions, highlights. Warmth and action, the visible surface hiding the structure. |
| `accent-hover`   | `#BE7535` | Accent button hover                                                                                      |
| `background`     | `#FAFAF8` | Page background. Off-white, not pure cold white.                                                         |
| `surface`        | `#FFFFFF` | Cards, panels, modals                                                                                    |
| `surface-raised` | `#FFFFFF` | Elevated cards (with shadow)                                                                             |
| `text`           | `#1A1A1A` | Primary text                                                                                             |
| `text-secondary` | `#6B7280` | Secondary text, labels, timestamps                                                                       |
| `text-tertiary`  | `#9CA3AF` | Placeholder text, disabled                                                                               |
| `border`         | `#E5E5E3` | Card borders, dividers                                                                                   |
| `border-light`   | `#F0F0EE` | Subtle separators                                                                                        |
| `success`        | `#22A06B` | On states, healthy, connected                                                                            |
| `warning`        | `#D4873F` | Warnings, attention needed                                                                               |
| `error`          | `#C9372C` | Errors, alerts, offline                                                                                  |
| `info`           | `#2563EB` | Informational states                                                                                     |

#### Dark mode (essential — dashboard consulted at night)

| Token            | Hex       | Usage                       |
| ---------------- | --------- | --------------------------- |
| `primary`        | `#3DBDA0` | Luminous version of primary |
| `primary-light`  | `#1A2F2A` | Subtle tinted backgrounds   |
| `accent`         | `#E9A55C` | Warm accent                 |
| `background`     | `#111113` | Page background             |
| `surface`        | `#1C1C1F` | Cards, panels               |
| `surface-raised` | `#242428` | Elevated cards              |
| `text`           | `#E8E8E6` | Primary text                |
| `text-secondary` | `#9CA3AF` | Secondary text              |
| `text-tertiary`  | `#6B7280` | Placeholder, disabled       |
| `border`         | `#2A2A2D` | Borders                     |
| `border-light`   | `#222225` | Subtle separators           |
| `success`        | `#2DD4A0` | On states                   |
| `warning`        | `#E9A55C` | Warnings                    |
| `error`          | `#EF5350` | Errors                      |

#### Semantic state colors (consistent across themes)

| State           | Light mode | Dark mode | Usage                                     |
| --------------- | ---------- | --------- | ----------------------------------------- |
| On / Active     | `#22A06B`  | `#2DD4A0` | Light on, device online, scenario enabled |
| Off / Inactive  | `#9CA3AF`  | `#6B7280` | Light off, device idle                    |
| Warning         | `#D4873F`  | `#E9A55C` | Low battery, high temperature             |
| Error / Offline | `#C9372C`  | `#EF5350` | Device offline, scenario error            |
| Motion detected | `#2563EB`  | `#60A5FA` | PIR triggered, presence active            |

### 14.3 Typography

Single font family for consistency. Inter is geometric, modern, highly legible on screens, free.

| Element             | Font           | Weight         | Size | Line height |
| ------------------- | -------------- | -------------- | ---- | ----------- |
| H1 (page title)     | Inter          | 600 (semibold) | 24px | 32px        |
| H2 (section title)  | Inter          | 600            | 20px | 28px        |
| H3 (card title)     | Inter          | 500 (medium)   | 16px | 24px        |
| Body                | Inter          | 400 (regular)  | 14px | 20px        |
| Body small          | Inter          | 400            | 13px | 18px        |
| Label               | Inter          | 500            | 12px | 16px        |
| Caption             | Inter          | 400            | 11px | 14px        |
| Data value (large)  | Inter          | 600            | 28px | 36px        |
| Data value (medium) | Inter          | 600            | 20px | 28px        |
| Data unit           | Inter          | 400            | 14px | 20px        |
| Mono (values, logs) | JetBrains Mono | 400            | 13px | 18px        |

**Note**: Base body size is 14px (not 16px). A dashboard displays dense information — 16px wastes space. Data values are intentionally oversized (28px) so they're readable at a glance or from across the room.

### 14.4 Logo

Concept: a stylized winch bracket — a supportive architectural element in profile, suggesting hidden structural strength.

```
        ┌───────┐
        │       │
    ┌───┘       │
    │           │
    │           │
    └───────────┘
```

Execution:

- A bracket/shelf profile shape: the top extends outward (cantilever) from a vertical support
- Rounded corners (radius 20%), `primary` color
- Represents load-bearing strength from an invisible source — the core metaphor
- Flat design, no shadows on the logo itself
- Works at all sizes: favicon (16px), app icon (512px), header logo

Variants:

- **Icon only**: the square with cutout (used as favicon, app icon)
- **Wordmark**: icon + "Winch" in Inter Semibold, spaced generously
- **Monochrome**: single color version for dark/light backgrounds

### 14.5 Spacing & Layout

Base unit: **4px**. All spacing is multiples of 4.

| Token | Value | Usage                           |
| ----- | ----- | ------------------------------- |
| `xs`  | 4px   | Tight spacing within components |
| `sm`  | 8px   | Between related elements        |
| `md`  | 16px  | Card padding, component gaps    |
| `lg`  | 24px  | Section gaps                    |
| `xl`  | 32px  | Page section separation         |
| `2xl` | 48px  | Major layout gaps               |

**Border radius:**

| Token         | Value  | Usage                   |
| ------------- | ------ | ----------------------- |
| `radius-sm`   | 6px    | Buttons, inputs, badges |
| `radius-md`   | 10px   | Cards, dropdowns        |
| `radius-lg`   | 14px   | Modals, large panels    |
| `radius-full` | 9999px | Pills, avatars, toggles |

**Shadows (light mode only, dark mode uses border instead):**

| Token       | Value                         | Usage            |
| ----------- | ----------------------------- | ---------------- |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`  | Subtle elevation |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.08)`  | Cards, dropdowns |
| `shadow-lg` | `0 8px 24px rgba(0,0,0,0.12)` | Modals, popovers |

### 14.6 Component Principles

#### Equipment Cards

- Each Equipment is a **card** on the dashboard
- Card shows: icon + name (top), primary Data value in large text (center), secondary data small (bottom), order buttons
- Tappable/clickable to expand details
- State color as a subtle left border or background tint (green = on, gray = off)
- Compact mode for mobile: just icon + name + primary value in a row

```
┌──────────────────────────┐
│ 💡  Spots Salon      ON  │  ← icon, name, state badge
│                          │
│        180               │  ← primary data value (large)
│      brightness          │  ← label (small, secondary color)
│                          │
│  [Off]  [━━━━━●━━━] 70%  │  ← order controls (button + slider)
└──────────────────────────┘
```

#### Zone View

- Zone displayed as a section with its name and aggregated data as pills/badges
- Equipment cards arranged in a responsive grid within the zone
- Collapsible child zones
- Zone header shows key aggregated data: temperature, motion indicator, lights count

```
┌──────────────────────────────────────────────┐
│ 🏠 Salon          21.5°C  🟢 Motion  💡 2/4  │  ← zone header with aggregated data
├──────────────────────────────────────────────┤
│  [Spots]  [Lampe]  [Temp]  [Volets]          │  ← equipment cards grid
└──────────────────────────────────────────────┘
```

#### Data Display Rules

- **Numbers**: always right-aligned in tables, large and prominent on cards
- **Units**: displayed smaller and lighter than the value itself: `21.5`°C not `21.5 °C`
- **Boolean states**: colored badges. ON = green badge, OFF = gray badge
- **Timestamps**: relative when recent ("2 min ago"), absolute when old ("Feb 16, 14:30")
- **Null/unknown values**: displayed as `—` in text-tertiary color

#### Animations

- State changes: 150ms ease-out transition on color/opacity
- Card expand/collapse: 200ms ease-out
- Page transitions: none (instant, snappy)
- Loading states: subtle pulse animation on skeleton cards
- No decorative animations. Everything serves a purpose.

### 14.7 Icons

Use **Lucide React** consistently. Stroke width: 1.5px (default). Size: 20px for inline, 24px for card headers, 16px for compact/table views.

| Concept           | Icon | Lucide name                                 |
| ----------------- | ---- | ------------------------------------------- |
| Light / Lamp      | 💡   | `Lightbulb`                                 |
| Dimmer            | 🔆   | `Sun`                                       |
| Temperature       | 🌡️   | `Thermometer`                               |
| Humidity          | 💧   | `Droplets`                                  |
| Motion / Presence | 👁️   | `Eye`                                       |
| Door contact      | 🚪   | `DoorOpen` / `DoorClosed`                   |
| Window contact    | 🪟   | `Square` (open) / `SquareX` (closed)        |
| Shutter / Cover   | ↕️   | `ArrowUpDown`                               |
| Lock              | 🔒   | `Lock` / `Unlock`                           |
| Battery           | 🔋   | `Battery` / `BatteryLow` / `BatteryWarning` |
| Power / Energy    | ⚡   | `Zap`                                       |
| Alarm             | 🚨   | `ShieldAlert`                               |
| Scenario          | ⚙️   | `Workflow`                                  |
| Zone / Room       | 🏠   | `Home`                                      |
| Device            | 📡   | `Radio`                                     |
| Settings          | ⚙️   | `Settings`                                  |
| User              | 👤   | `User`                                      |
| Notification      | 🔔   | `Bell`                                      |
| Online            | 🟢   | `Circle` (filled green)                     |
| Offline           | 🔴   | `Circle` (filled red)                       |

### 14.8 Responsive Breakpoints

| Breakpoint | Width          | Layout                                                    |
| ---------- | -------------- | --------------------------------------------------------- |
| Mobile     | < 640px        | Single column, compact equipment cards, bottom navigation |
| Tablet     | 640px – 1024px | 2-column grid, side navigation collapsed                  |
| Desktop    | > 1024px       | 3-4 column grid, side navigation expanded                 |

The UI must be **mobile-first** — many users check their home dashboard on their phone. The desktop layout is an expansion of the mobile layout, not the other way around.

### 14.9 Tailwind CSS Configuration

```javascript
// tailwind.config.js
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1B6B5A",
          light: "#E8F4F0",
          hover: "#155A4A",
          dark: "#3DBDA0", // dark mode variant
        },
        accent: {
          DEFAULT: "#D4873F",
          hover: "#BE7535",
          dark: "#E9A55C",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          raised: "#FFFFFF",
          dark: "#1C1C1F",
          "dark-raised": "#242428",
        },
        background: {
          DEFAULT: "#FAFAF8",
          dark: "#111113",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "data-lg": ["28px", "36px"],
        "data-md": ["20px", "28px"],
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
};
```

---

## 16. Key Implementation Notes for Claude Code

### AI Assistant

- LLM calls are always async and non-blocking — never block the main event loop
- API keys must be stored encrypted in SQLite (AES-256-GCM, encryption key derived from JWT_SECRET)
- Always validate LLM JSON output with a strict schema validator before accepting
- Set temperature low (0.1-0.2) for structured output (scenario creation, actions), higher (0.7) for conversational answers
- Implement a timeout on LLM calls (30s default) — if the provider is down, the rest of Winch must keep working
- The AI feature is entirely optional — if `provider: "none"`, all AI routes return 404 and UI hides AI elements
- For Ollama: use the `/api/generate` endpoint with `format: "json"` for structured output
- Context builder must be efficient — cache the context and invalidate only when zones/equipments change, not on every data update
- Rate limit AI requests per user (10/min default) to prevent abuse and runaway costs

### Authentication

- Use `bcrypt` for password hashing (cost factor 12)
- Use `jsonwebtoken` for JWT (HS256, secret from env)
- API tokens: generate with `crypto.randomBytes(32).toString('hex')`, prefix with `wch_`, store SHA-256 hash only
- Auth middleware: check `Authorization: Bearer <token>` header. Try JWT decode first, if it fails try API token lookup.
- Fastify `onRequest` hook for auth, with route whitelist for public endpoints (`/auth/login`, `/auth/setup`)
- Role-based authorization: use a `requireRole(minRole)` decorator on routes

### General

- Use UUID v4 for all entity IDs (use `crypto.randomUUID()`)
- All dates in ISO 8601 format
- Use strict TypeScript: `strict: true` in tsconfig
- All types are defined in `src/shared/types.ts` and shared between backend modules
- Use structured logging (JSON format) via pino (Fastify's default logger)

### MQTT

- Use `mqtt.js` `connectAsync` for clean async/await
- Always handle reconnection gracefully
- Parse all MQTT payloads as JSON with try/catch fallback to raw string
- MQTT message handling must never throw — wrap all handlers in try/catch with logging

### SQLite

- Use `better-sqlite3` synchronous API — it's intentionally synchronous and very fast
- Run migrations on startup
- Use WAL mode for better concurrent read performance: `PRAGMA journal_mode=WAL`
- Use transactions for batch operations

### Event Bus

- Use a typed EventEmitter pattern with TypeScript discriminated union for events
- All event handlers must be non-blocking
- Event handlers must never throw — wrap in try/catch with logging

### Computed Data expressions

- Use a safe expression parser (NOT `eval`). Consider `expr-eval` npm package or build a simple one
- Expressions reference other Data via the `binding.<alias>` and `equipment.<id>.<key>` syntax
- Re-evaluate when any referenced Data source changes

### Zone Aggregation

- On any `equipment.data.changed` event, re-compute the Zone aggregations for the Equipment's Zone and all parent Zones
- Cache aggregated values in memory (not in SQLite) for performance
- Emit `zone.data.changed` events only when values actually change

### Scenario Engine

- Triggers are registered on the event bus on startup (and when scenarios are created/updated)
- Duration-based triggers ("for": "15m") use `setTimeout` — store timer references to cancel on state change
- Action execution is sequential by default, with optional delays
- Log all executions to `scenario_log` table
- Limit concurrent scenario executions to prevent loops (configurable max, default 10)

### Frontend

- Use Zustand stores that are updated by WebSocket events
- The WebSocket connection should auto-reconnect
- The dashboard should work without page reload — all state is pushed in real-time
- Use Tailwind CSS utility classes, no custom CSS files
- Mobile-responsive layout

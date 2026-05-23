# Equipments

> **Layer 2 -- Functional**: the user-facing functional units. Each equipment lives in a Zone and binds to one or more physical Devices through aliases.
>
> See also: [Devices](devices.md) for the physical layer underneath.

## Equipment

An **Equipment** is the user-facing functional unit. It is the primary entity users interact with in the UI, recipes, and external integrations (MQTT publishers, notifications).

### 1 Interface

```typescript
type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "awning"
  | "switch"
  | "sensor"
  | "button"
  | "thermostat"
  | "weather"
  | "weather_forecast"
  | "gate"
  | "heater"
  | "energy_meter"
  | "main_energy_meter"
  | "energy_production_meter"
  | "media_player"
  | "appliance"
  | "water_valve"
  | "pool_pump"
  | "pool_cover"
  | "pool_heat_pump";

interface Equipment {
  id: string; // UUID v4
  name: string;
  zoneId: string; // FK -> Zone (where the equipment functions)
  type: EquipmentType; // Drives UI rendering, aggregation, valid orders
  icon?: string; // Lucide icon name (overrides type default)
  description?: string;
  enabled: boolean; // Disabled equipments are ignored by the engine
  createdAt: string;
  updatedAt: string;
}
```

### 2 Equipment vs Device

|                      | Device                              | Equipment                         |
| -------------------- | ----------------------------------- | --------------------------------- |
| **Nature**           | Physical hardware                   | Functional abstraction            |
| **Discovery**        | Auto-discovered from a plugin       | Manually created by user          |
| **Identity**         | `(integrationId, sourceDeviceId)`   | UUID + user-chosen name           |
| **Location**         | Optional `zoneId` (where installed) | Required `zoneId` (where used)    |
| **Cardinality**      | 1 Device -> N Equipments possible   | 1 Equipment -> N Devices possible |
| **User interaction** | Never (technical layer)             | Always (primary interface)        |

**Examples:**

- 1 Device -> 1 Equipment: Aqara temperature sensor -> "Temperature Cuisine"
- 1 Device -> N Equipments: Double relay -> "Lumiere Cuisine" + "Lumiere Cellier"
- N Devices -> 1 Equipment: 3 PIR sensors -> "Detection Cuisine" (via multiple `motion`-aliased DataBindings)

### 3 Equipment with details

```typescript
interface EquipmentWithDetails extends Equipment {
  dataBindings: DataBindingWithValue[];
  orderBindings: OrderBindingWithDetails[];
  /** Provider-supplied virtual data (e.g. energy aggregator cumuls). */
  computedData?: ComputedDataEntry[];
}
```

### 4 SQLite Schema

```sql
CREATE TABLE equipments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'generic',
  icon TEXT,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Data Binding

A **DataBinding** maps a `DeviceData` row to an Equipment-level alias. The alias is the stable name used in the UI, recipes, and history queries.

### 1 Interface

```typescript
interface DataBinding {
  id: string;
  equipmentId: string; // FK -> Equipment
  deviceDataId: string; // FK -> DeviceData
  alias: string; // Equipment-level name: "state", "brightness", "temperature"
  /** NULL = follow category default. 1 = force historize ON. 0 = force OFF. */
  historize?: number | null;
}

interface DataBindingWithValue extends DataBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  category: DataCategory;
  value: unknown;
  unit?: string;
  enumValues?: string[];
  lastUpdated: string | null;
  lastChanged: string | null;
  historize?: number | null;
}
```

### 2 How It Works

```
Device "Variateur #1"
+-- DeviceData: key="state",       category=light_state       <--+
+-- DeviceData: key="brightness",  category=light_brightness  <--+ DataBinding
+-- DeviceData: key="linkquality", category=generic              |
                                                                  |
Equipment "Spots Cuisine"                                         |
+-- alias "state"      ----------------------------------------- +
+-- alias "brightness" -----------------------------------------
```

### 3 Constraints

- `UNIQUE(equipment_id, alias)` -- each alias is unique per Equipment.
- When `DeviceData.value` changes, the bound alias reflects the new value immediately and `equipment.data.changed` is emitted.
- The alias is used in zone aggregation (looked up by `category`), recipe slots, MQTT publisher mappings, notification mappings, history queries, and chart series.

### 4 Historization control

Each binding may override the default historization decision per category. Resolution order: explicit `historize` override -> alias name default -> category default. `effectiveOn` is exposed via `HistoryBindingState`.

### 5 SQLite Schema

```sql
CREATE TABLE data_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_data_id TEXT NOT NULL REFERENCES device_data(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  historize INTEGER DEFAULT NULL,
  UNIQUE(equipment_id, alias)
);
```

---

## Order Binding

An **OrderBinding** maps a `DeviceOrder` to an Equipment-level command alias.

### 1 Interface

```typescript
interface OrderBinding {
  id: string;
  equipmentId: string;
  deviceOrderId: string;
  alias: string; // Equipment-level command: "turn_on", "set_brightness"
}

interface OrderBindingWithDetails extends OrderBinding {
  deviceId: string;
  deviceName: string;
  key: string;
  type: DataType;
  category?: OrderCategory;
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}
```

### 2 Multi-Device Dispatch

An Equipment can have multiple OrderBindings sharing the **same alias** but pointing to different Devices. Executing the alias dispatches to all of them in parallel:

```
Equipment "Eclairage Cuisine"
+-- OrderBinding alias="state" -> DeviceOrder on Relais #1
+-- OrderBinding alias="state" -> DeviceOrder on Relais #2
```

<!-- MISMATCH: src/shared/types.ts comments suggested UNIQUE(equipment_id, alias, device_order_id) for multi-dispatch, but the live migration 001_initial.sql declares UNIQUE(equipment_id, alias). Multi-device dispatch in the current code is achieved by EquipmentManager iterating bindings and matching the alias across multiple device orders -- not by storing multiple rows with the same alias. Verify before relying on multi-row dispatch. -->

### 3 Per-binding category override

Migration `006_pool_runtime_and_category_override.sql` added `category_override` so an Equipment of type `pool_pump` can re-tag a generic relay's `toggle_power` order as `pool_pump_toggle` without touching the device definition. Effective category is `COALESCE(order_bindings.category_override, device_orders.category)`.

### 4 SQLite Schema

```sql
CREATE TABLE order_bindings (
  id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  device_order_id TEXT NOT NULL REFERENCES device_orders(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  category_override TEXT,
  UNIQUE(equipment_id, alias)
);
```

---

## Computed Data

Sowel does **not** persist computed data in a SQLite table. There is no expression language, and no `computed_data` table. Instead, the EquipmentManager exposes a **provider registry** that internal modules use to attach virtual data points to an Equipment at read time:

```typescript
interface ComputedDataEntry {
  alias: string;
  value: unknown;
  unit?: string;
  category?: DataCategory;
  lastUpdated: string | null;
}

type ComputedDataProvider = (equipmentId: string) => ComputedDataEntry[];
```

Current providers in the codebase:

- **Energy aggregator** (`src/energy/energy-aggregator.ts`) -- exposes daily/monthly cumuls on `main_energy_meter` and `energy_production_meter` equipments.
- **Power submeter integrator** (`src/energy/power-submeter-integrator.ts`) -- integrates instantaneous power into Wh on `energy_meter` equipments without an energy counter (state persisted in `submeter_integrator_state`).
- **Pool runtime tracker** (`src/equipments/pool-runtime-tracker.ts`) -- daily ON-time of `pool_pump` equipments (state in `pool_runtime_state`).
- **Pool water temperature tracker** (`src/equipments/pool-water-temp-tracker.ts`) -- last active water temperature on `pool_heat_pump` (state in `pool_water_temp_state`).

Computed entries appear in `EquipmentWithDetails.computedData` and can be referenced from MQTT publishers, notifications, and chart series like any other binding alias.

> **Removed from the data model**: the legacy expression language (`OR()`, `AVG()`, `IF()`, `binding.<alias>`, etc.) and the `internal_rules` table mentioned in earlier versions of this document. They were never implemented. Automation logic now lives in **Recipes** (section 10).

---

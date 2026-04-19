# Spec 081 — Architecture

## Data Model Changes

### Types (`src/shared/types.ts`)

```typescript
export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
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
  | "pool_cover"; // NEW

export type WidgetFamily = "lights" | "shutters" | "heating" | "sensors" | "water" | "pool"; // pool NEW

export type OrderCategory =
  | "light_toggle"
  | "set_brightness"
  | "set_color_temp"
  | "set_color"
  | "shutter_move"
  | "set_shutter_position"
  | "toggle_power"
  | "set_setpoint"
  | "gate_trigger"
  | "valve_toggle"
  | "toggle_mute"
  | "set_input"
  | "pool_pump_toggle" // NEW
  | "pool_cover_move" // NEW
  | "pool_cover_position"; // NEW
```

### Constants (`src/shared/constants.ts`)

```typescript
export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"],
  pool: ["pool_pump", "pool_cover"], // NEW
};
```

### Equipment Manager

`VALID_EQUIPMENT_TYPES` set includes `pool_pump` and `pool_cover`.

## Migration 006

Two schema changes in a single migration:

```sql
-- Runtime tracking for pool pumps
CREATE TABLE IF NOT EXISTS pool_runtime_state (
  equipment_id TEXT PRIMARY KEY REFERENCES equipments(id) ON DELETE CASCADE,
  current_state TEXT NOT NULL,              -- ON | OFF | UNKNOWN
  state_since TEXT NOT NULL,                -- ISO 8601
  cumulative_seconds_today INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL             -- YYYY-MM-DD local
);

-- Category override on bindings (per-equipment semantics)
ALTER TABLE order_bindings ADD COLUMN category_override TEXT;
```

## Binding Candidates

New pure function in `src/equipments/binding-candidates.ts`:

```typescript
export interface BindingCandidate {
  id: string; // stable id for UI selection (e.g. "power1", "shutter1")
  label: string; // display name (e.g. "Relay 1 — POMPE")
  dataKeys: string[]; // device_data keys to bind
  orderKeys: string[]; // device_order keys to bind
}

export function computeBindingCandidates(
  equipmentType: EquipmentType,
  deviceData: DeviceData[],
  deviceOrders: DeviceOrder[],
): BindingCandidate[];
```

Grouping rules:

| Equipment type                       | Rule                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pool_pump`, `switch`, `light_onoff` | 1 candidate per ON/OFF enum order; data = same key                                                |
| `light_dimmable`, `light_color`      | 1 candidate per ON/OFF enum order, attach matching `brightness` / `color_temp` order if same root |
| `pool_cover`, `shutter`              | 1 candidate per "shutter group" (position + move/state that share the same numeric suffix)        |
| `thermostat`, `heater`               | 1 candidate joining power + setpoint + inside_temperature data                                    |
| `sensor`                             | 1 candidate with ALL sensor data (existing multi-value behavior)                                  |
| `water_valve`                        | 1 candidate per ON/OFF enum order                                                                 |
| `gate`                               | 1 candidate per gate-trigger order                                                                |
| `button`                             | 1 candidate with the `action` enum data                                                           |
| (fallback)                           | 1 candidate with everything (keep current behavior)                                               |

UI consumer:

- If `candidates.length === 1` → auto-bind (create all data/order bindings in the candidate).
- If `candidates.length > 1` → render a picker (radio or card list) showing candidate labels; user picks one; Sowel creates the selected candidate's bindings.
- If `candidates.length === 0` → device is NOT proposed.

## Device Availability Filter

New helper `src/equipments/binding-candidates.ts::hasFreeCandidates`:

```typescript
export function hasFreeCandidates(
  equipmentType: EquipmentType,
  deviceId: string,
  allBindings: { dataBindings: DataBinding[]; orderBindings: OrderBinding[] },
  device: DeviceWithDetails,
): boolean;
```

It calls `computeBindingCandidates` and filters out candidates whose primary order_key is already consumed by any existing `order_binding` on any equipment. If the filtered list is non-empty → true.

`DeviceSelector` and `AddBindingModal` call this helper for each candidate device to decide visibility.

## Category Override (order_bindings)

### Helper

```typescript
function inferBindingCategory(
  equipmentType: EquipmentType,
  order: DeviceOrder,
): OrderCategory | null {
  if (equipmentType === "pool_pump") {
    if (order.type === "enum" && looksLikeOnOff(order.enumValues)) return "pool_pump_toggle";
  }
  if (equipmentType === "pool_cover") {
    if (order.type === "enum" && looksLikeShutterMove(order.enumValues)) return "pool_cover_move";
    if (order.type === "number") return "pool_cover_position";
  }
  return null; // no override, use device's category
}
```

### Integration

- `equipment-manager.addOrderBinding()` computes the override and inserts it.
- `equipment-manager.update(id, { type })` recomputes overrides for ALL existing order_bindings of the equipment.
- SQL for `getOrderBindingsWithDetails`:

```sql
SELECT ob.id, ob.equipment_id, ob.device_order_id, ob.alias,
       COALESCE(ob.category_override, do2.category) AS category,
       do2.device_id, d.name AS device_name, do2.key, do2.type,
       do2.min_value, do2.max_value, do2.enum_values, do2.unit
FROM order_bindings ob
JOIN device_orders do2 ON ob.device_order_id = do2.id
JOIN devices d ON do2.device_id = d.id
WHERE ob.equipment_id = ?
```

## Runtime Tracker (pool_pump)

New manager `src/equipments/pool-runtime-tracker.ts`:

```
Startup:
  Load all pool_pump states from pool_runtime_state table.
  For each:
    if last_reset_date !== today(local) → reset cumulative to 0, update last_reset_date.
  Subscribe to eventBus(equipment.data.changed).

On equipment.data.changed event:
  Look up equipment; if type !== pool_pump → ignore.
  If alias is the on/off alias (data_binding to device's ON/OFF data):
    if value === "ON" and prev !== "ON":
      state = { currentState: ON, stateSince: now }
    if value === "OFF" and prev === "ON":
      elapsed = now - stateSince
      cumulative += elapsed (in seconds)
      state = { currentState: OFF, stateSince: now }
    persist to DB.
    emit equipment.data.changed(alias="runtime_daily", value=cumulative)

Midnight timer (every 60s):
  today = localDate()
  for each state where last_reset_date !== today:
    cumulative = if currentState === ON then (now - midnight in seconds) else 0
    last_reset_date = today
    persist + emit
```

### Surfacing runtime_daily

`equipment-manager.getDataBindingsWithValues()` appends a virtual entry for pool_pump:

```typescript
if (equipment.type === "pool_pump") {
  const runtime = poolRuntimeTracker.getRuntime(equipmentId); // in seconds
  bindings.push({ alias: "runtime_daily", value: runtime, type: "number", category: "generic", unit: "s", … });
}
```

Same pattern as the existing gate derived state (`deriveGateState`).

## Cover State Deriver (pool_cover)

In `equipment-manager.ts`, sibling of `deriveGateState`:

```typescript
function deriveCoverState(
  positionBinding: DataBindingWithValue | undefined,
): "OPEN" | "CLOSED" | "PARTIAL" | null {
  if (!positionBinding || positionBinding.value === null) return null;
  const p = Number(positionBinding.value);
  if (p <= 5) return "CLOSED";
  if (p >= 95) return "OPEN";
  return "PARTIAL";
}
```

Note: `MOVING` requires a direction signal that Tasmota doesn't always emit; we start with the 3-state derivation. Future enhancement can plug `MOVING` from the direction data binding if present.

Appended to `getDataBindingsWithValues` for `pool_cover` equipments as a virtual `cover_state` entry.

## Icons

### `PoolPumpIcon({ on })` — Design F

`ui/src/components/dashboard/WidgetIcons.tsx`.

- Tank 3-stages (dome cap + upper bulb + flange + lower body).
- Manometer with needle (under pressure in ON, at rest in OFF).
- Junction box on the right, "ON" centered inside (`text-anchor="middle"` + `dominant-baseline="central"`) when ON; 4 screws when OFF.
- Pipes: outer stroke `currentColor` + inner `#3B82F6` (water) in ON / transparent (hollow) in OFF.
- Widget card uses `className="text-active"` when ON (Sowel green), `text-primary` when OFF.

### `PoolCoverIcon({ position })` — Design G

- Rectangular pool frame.
- Vertical slats rolling from left, count proportional to `position` (same bucketing as shutter: 0/25/50/75/100).
- Roller stripe on the left edge.
- Uses `currentColor` + gradients (no hardcoded color).

### `WaterValveIcon({ open })` — FIX

- Pipe + handle; handle horizontal (open) / vertical (closed).
- In OPEN: `text-active` color + visible water flow.
- In CLOSED: `text-primary` muted.

### Registry updates

`ui/src/components/dashboard/widget-icons.ts`:

```typescript
pool_pump: {
  label: "Pompe piscine",
  component: PoolPumpIcon,
  previewProps: { on: false },
  types: ["pool_pump", "pool"],
},
pool_cover: {
  label: "Volet piscine",
  component: PoolCoverIcon,
  previewProps: { position: 50 },
  types: ["pool_cover", "pool"],
},
water_valve: {
  label: "Vanne d'arrosage",
  component: WaterValveIcon,
  previewProps: { open: false },     // FIX was empty
  types: ["water_valve", "water"],
},
```

`EQUIPMENT_DEFAULT_ICONS`:

```
pool_pump: "pool_pump",
pool_cover: "pool_cover",
```

`FAMILY_DEFAULT_ICONS`:

```
pool: "pool_pump",
```

## Dashboard Widget Rendering

The dashboard widget card (current code lives in `ui/src/components/dashboard/…`) receives the equipment type and renders:

- Icon from the registry (resolved by type).
- Textual info resolved from the equipment's data bindings:
  - `pool_pump` → `ON · 3h 45m` (from bound ON/OFF alias + runtime_daily virtual data).
  - `pool_cover` → `Ouvert 75%` (from derived `cover_state` + position).
  - `water_valve` → `Ouverte / Fermée`.
- A primary action button that calls `executeOrder(equipmentId, alias, value)`:
  - pool_pump: toggle the bound ON/OFF alias.
  - pool_cover: open/close/stop via `shutter_state` or `pool_cover_move` alias.
  - water_valve: toggle the bound ON/OFF alias.

## Event Flow — Full Tasmota 4CH Example

```
Tasmota 4CH_PRO_PISCINE publishes tele/… STATE: { POWER1: "ON", ... }
  → tasmota plugin emits device.data.updated(deviceId, key="power1", value="ON")
    → equipment-manager: for each data_binding targeting power1 → emit equipment.data.changed(eq_id=POMPE, alias="state", value="ON")
      → PoolRuntimeTracker: pump POMPE turned ON at T0, record stateSince=T0.

Tasmota publishes STATE: { POWER1: "OFF", ... }   (1 hour later)
  → equipment.data.changed(POMPE, "state", "OFF")
    → PoolRuntimeTracker: OFF received, elapsed = 3600s, cumulative += 3600
    → emits equipment.data.changed(POMPE, "runtime_daily", 3600)

UI dashboard widget for POMPE receives both events via WebSocket, re-renders:
  icon = PoolPumpIcon with on=false, text = "OFF · 1h 00m".
```

## Files to Create / Modify

### Backend

| File                                                    | Change                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrations/006_pool_runtime_and_category_override.sql` | New table + column                                                                                                                                     |
| `src/shared/types.ts`                                   | Types                                                                                                                                                  |
| `src/shared/constants.ts`                               | WIDGET_FAMILY_TYPES + ONOFF_ENUM_VALUES constant                                                                                                       |
| `src/equipments/binding-candidates.ts`                  | New helpers                                                                                                                                            |
| `src/equipments/binding-candidates.test.ts`             | New tests                                                                                                                                              |
| `src/equipments/equipment-manager.ts`                   | VALID_EQUIPMENT_TYPES, addOrderBinding override, update() retag, getOrderBindingsWithDetails SQL, deriveCoverState, append runtime_daily for pool_pump |
| `src/equipments/equipment-manager.test.ts`              | New scenarios                                                                                                                                          |
| `src/equipments/pool-runtime-tracker.ts`                | New manager                                                                                                                                            |
| `src/equipments/pool-runtime-tracker.test.ts`           | Tests                                                                                                                                                  |
| `src/index.ts`                                          | Instantiate PoolRuntimeTracker                                                                                                                         |

### Frontend

| File                                               | Change                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `ui/src/types.ts`                                  | Mirror backend types                                                 |
| `ui/src/components/dashboard/WidgetIcons.tsx`      | PoolPumpIcon, PoolCoverIcon, refactored WaterValveIcon               |
| `ui/src/components/dashboard/widget-icons.ts`      | Registry updates                                                     |
| `ui/src/components/equipments/DeviceSelector.tsx`  | Use `hasFreeCandidates` instead of "any binding exists"              |
| `ui/src/components/equipments/EquipmentForm.tsx`   | If N candidates, show picker; if 1, auto-bind                        |
| `ui/src/components/equipments/AddBindingModal.tsx` | Same filtering logic                                                 |
| `ui/src/components/dashboard/EquipmentWidget.tsx`  | New rendering + action button for pool_pump, pool_cover, water_valve |

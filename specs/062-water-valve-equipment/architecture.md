# Architecture — Spec 062

## Data model changes

### Types (`src/shared/types.ts`)

Add `"water_valve"` to the `EquipmentType` discriminated union:

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
  | "water_valve"; // ← NEW
```

Add `"water"` to the `WidgetFamily` type:

```typescript
export type WidgetFamily = "lights" | "shutters" | "heating" | "sensors" | "water";
```

Extend `ZoneAggregatedData` with new water fields:

```typescript
export interface ZoneAggregatedData {
  // ... existing fields
  waterValvesTotal?: number;
  waterValvesOpen?: number;
  waterFlowTotal?: number; // m³/h, only if at least one valve has flow bound
}
```

### Constants (`src/shared/constants.ts`)

Extend `WIDGET_FAMILY_TYPES`:

```typescript
export const WIDGET_FAMILY_TYPES: Record<WidgetFamily, EquipmentType[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"], // ← NEW
};
```

No new `DataCategory` added — we rely on device filtering by specific data keys instead of introducing a new category.

## Backend changes

### `src/equipments/equipment-manager.ts`

Add `"water_valve"` to `VALID_EQUIPMENT_TYPES`:

```typescript
const VALID_EQUIPMENT_TYPES: Set<string> = new Set([
  // ... existing types
  "water_valve", // ← NEW
]);
```

### `src/zones/zone-aggregator.ts`

Add aggregation logic for water valves in the zone aggregation pipeline. Pattern follows existing aggregations like `shuttersTotal` / `lightsOn`:

```typescript
// Inside computeForZone()
let waterValvesTotal = 0;
let waterValvesOpen = 0;
let waterFlowTotal = 0;
let waterFlowHasData = false;

for (const equipment of zoneEquipments) {
  if (equipment.type !== "water_valve") continue;
  waterValvesTotal++;
  const state = getAliasValue(equipment.id, "state");
  const isOpen = state === true || state === "ON" || state === "on";
  if (isOpen) waterValvesOpen++;
  const flow = getAliasValue(equipment.id, "flow");
  if (typeof flow === "number") {
    waterFlowTotal += flow;
    waterFlowHasData = true;
  }
}

// Cascade to aggregated data
data.waterValvesTotal = waterValvesTotal;
data.waterValvesOpen = waterValvesOpen;
if (waterFlowHasData) data.waterFlowTotal = waterFlowTotal;
```

Aggregation cascades up the zone tree like existing metrics.

### Tests

- **`src/zones/zone-aggregator.test.ts`** — add test cases:
  - Zone with 2 water_valve equipments, 1 open, 1 closed → `waterValvesTotal: 2, waterValvesOpen: 1`
  - Zone with flow data on open valves → `waterFlowTotal` is sum
  - Zone with no water_valve → fields absent

- **`src/equipments/equipment-manager.test.ts`** — add test case:
  - Creating an equipment with `type: "water_valve"` succeeds
  - Creating with invalid type rejects (unchanged)

## Frontend changes

### New icon component

**`ui/src/components/icons/WaterValveIcon.tsx`**

```typescript
interface WaterValveIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

export function WaterValveIcon({
  size = 24,
  strokeWidth = 1.5,
  className,
  title,
}: WaterValveIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      <rect x="2" y="14" width="20" height="6" rx="1" />
      <line x1="4" y1="14" x2="4" y2="20" />
      <line x1="20" y1="14" x2="20" y2="20" />
      <rect x="9" y="10" width="6" height="4" />
      <rect x="5" y="6" width="14" height="4" rx="2" />
    </svg>
  );
}
```

### Device filtering

**`ui/src/components/equipments/DeviceSelector.tsx`**

Extend `EQUIPMENT_TYPE_DATA_KEYS`:

```typescript
const EQUIPMENT_TYPE_DATA_KEYS: Partial<Record<EquipmentType, string[]>> = {
  // ... existing
  water_valve: ["flow", "irrigation_capacity", "irrigation_duration", "irrigation_interval"],
};
```

**Light/switch exclusion**: to prevent the SONOFF SWV from being offered when creating `light_onoff` / `switch`, extend the filter logic with an exclusion predicate:

```typescript
const WATER_VALVE_MARKERS = new Set([
  "flow",
  "irrigation_capacity",
  "irrigation_duration",
  "irrigation_interval",
]);

function looksLikeWaterValve(device: DeviceWithData): boolean {
  return device.data.some((d) => WATER_VALVE_MARKERS.has(d.key));
}

// In the compatible filter:
if (equipmentType === "light_onoff" || equipmentType === "switch") {
  compatible = compatible.filter((device) => !looksLikeWaterValve(device));
}
```

### Auto-bind rules

**`ui/src/components/equipments/bindingUtils.ts`**

Extend `RELEVANT_DATA`, `RELEVANT_ORDERS`, and `STANDARD_ALIASES` as described in FR7 of the spec.

### UI components

| File                                                             | Role                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ui/src/components/zones/ZoneWaterWidget.tsx` (NEW)              | Zone card — compact summary with count + flow                       |
| `ui/src/components/dashboard/ZoneWaterDashboardWidget.tsx` (NEW) | Dashboard widget — per-valve rows + "Fermer tout"                   |
| `ui/src/components/equipments/WaterValveControl.tsx` (NEW)       | Detail card control — toggle + timed watering                       |
| `ui/src/components/equipments/EquipmentCard.tsx`                 | Renders `WaterValveControl` when `equipment.type === "water_valve"` |
| `ui/src/components/zones/ZoneWidgetGrid.tsx`                     | Renders `ZoneWaterWidget` as part of the zone view                  |
| `ui/src/components/dashboard/WidgetGrid.tsx`                     | Renders `ZoneWaterDashboardWidget` for family "water"               |
| `ui/src/components/dashboard/WidgetIcons.tsx`                    | Maps family `water` → `WaterValveIcon`                              |
| `ui/src/components/dashboard/IconPicker.tsx`                     | Register `water_valve` as a custom icon option                      |

### State types

Extend the UI `ZoneAggregatedData` type mirror in `ui/src/types.ts`:

```typescript
export interface ZoneAggregatedData {
  // ... existing
  waterValvesTotal?: number;
  waterValvesOpen?: number;
  waterFlowTotal?: number;
}
```

### i18n

Add to `ui/src/i18n/locales/{en,fr}.json`:

```json
{
  "equipment.type.water_valve": "Vanne d'arrosage" / "Water valve",
  "widget.family.water": "Eau" / "Water",
  "water.open": "Ouverte" / "Open",
  "water.closed": "Fermée" / "Closed",
  "water.closeAll": "Fermer tout" / "Close all",
  "water.waterNow": "Arroser {{minutes}} min" / "Water for {{minutes}} min",
  "water.duration": "Durée" / "Duration",
  "water.minutes": "min",
  "water.flow": "Débit" / "Flow",
  "water.battery": "Batterie" / "Battery",
  "water.status.normal": "Normal" / "Normal",
  "water.status.waterShortage": "Pénurie d'eau" / "Water shortage",
  "water.status.leak": "Fuite détectée" / "Leak detected",
  "water.noActiveRecipe": "Pas de recette active — créez-en une dans Recettes" / "No active recipe — create one in Recipes",
  "zones.aggregation.waterValvesOpen": "{{open}}/{{total}}" / "{{open}}/{{total}}",
  "zones.aggregation.waterFlow": "{{flow}} m³/h" / "{{flow}} m³/h"
}
```

## Event flow (reactive pipeline)

The water_valve equipment type plugs into the existing reactive pipeline without new event types:

```
Zigbee2MQTT message (plugin:zigbee2mqtt)
  → DeviceManager.updateDeviceData() emits device.data.updated
    → EquipmentManager re-evaluates water_valve bindings
      → emits equipment.data.changed for alias "state" | "flow" | ...
        → ZoneAggregator recomputes zone aggregation (waterValvesOpen, waterFlowTotal)
          → emits zone.data.changed
            → WebSocket broadcasts to UI clients
              → Zustand stores update
                → ZoneWaterWidget, ZoneWaterDashboardWidget, WaterValveControl re-render
```

No new WebSocket event type, no new DB table, no migration.

## Files changed

| Domain            | File                                                             | Change                                                                                                |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Types             | `src/shared/types.ts`                                            | Add `water_valve` to `EquipmentType`; `water` to `WidgetFamily`; water fields in `ZoneAggregatedData` |
| Constants         | `src/shared/constants.ts`                                        | Add `water: ["water_valve"]` to `WIDGET_FAMILY_TYPES`                                                 |
| Backend           | `src/equipments/equipment-manager.ts`                            | Add `water_valve` to `VALID_EQUIPMENT_TYPES`                                                          |
| Backend           | `src/zones/zone-aggregator.ts`                                   | Add water aggregation logic                                                                           |
| Backend test      | `src/zones/zone-aggregator.test.ts`                              | Add test cases for water aggregation                                                                  |
| Backend test      | `src/equipments/equipment-manager.test.ts`                       | Add test case for water_valve type validation                                                         |
| UI types          | `ui/src/types.ts`                                                | Mirror `water_valve` type + aggregation fields                                                        |
| UI icon           | `ui/src/components/icons/WaterValveIcon.tsx` (NEW)               | Custom SVG icon                                                                                       |
| UI DeviceSelector | `ui/src/components/equipments/DeviceSelector.tsx`                | Add `water_valve` key filter + exclusion for light/switch                                             |
| UI bindings       | `ui/src/components/equipments/bindingUtils.ts`                   | Add `RELEVANT_DATA`, `RELEVANT_ORDERS`, `STANDARD_ALIASES` for water_valve                            |
| UI component      | `ui/src/components/zones/ZoneWaterWidget.tsx` (NEW)              | Zone card summary                                                                                     |
| UI component      | `ui/src/components/dashboard/ZoneWaterDashboardWidget.tsx` (NEW) | Dashboard widget                                                                                      |
| UI component      | `ui/src/components/equipments/WaterValveControl.tsx` (NEW)       | Equipment detail card control                                                                         |
| UI dispatch       | `ui/src/components/equipments/EquipmentCard.tsx`                 | Route `water_valve` type to `WaterValveControl`                                                       |
| UI grid           | `ui/src/components/zones/ZoneWidgetGrid.tsx`                     | Include `ZoneWaterWidget` when zone has water valves                                                  |
| UI grid           | `ui/src/components/dashboard/WidgetGrid.tsx`                     | Include `ZoneWaterDashboardWidget` for family `water`                                                 |
| UI icons map      | `ui/src/components/dashboard/WidgetIcons.tsx`                    | `water` → `WaterValveIcon`                                                                            |
| UI picker         | `ui/src/components/dashboard/IconPicker.tsx`                     | Register `water_valve` custom icon                                                                    |
| UI i18n           | `ui/src/i18n/locales/en.json`                                    | New strings                                                                                           |
| UI i18n           | `ui/src/i18n/locales/fr.json`                                    | New strings                                                                                           |

## Why this design

- **Minimal backend change** — one new type, one new family, one new aggregation block. No event changes, no DB migration.
- **UI adapts dynamically** — based on which aliases are bound. Cheap valves get a simple toggle; smart valves get full features.
- **Device filtering is tight** — excludes lights / switches by predicate, keeps the water_valve creation flow focused on irrigation devices.
- **Recipe-ready** — exposes all 8 aliases including cycles/interval/capacity/duration so the future auto-watering recipe can bind directly.
- **Design-system coherent** — custom SVG icon follows Sowel style (stroke 1.5, currentColor, rounded, no animation).
- **Simple extensibility** — new `water` widget family is ready for future water equipments (pump, meter, leak sensor).

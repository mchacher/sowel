# Spec 062 — Water valve equipment type

## Context

A new Zigbee device has appeared in production: `SONOFF_WATER_VALVE_00` (model: SWV, manufacturer: SONOFF). It is a smart water valve for automated garden irrigation. It exposes rich data/orders (flow meter, battery, state, irrigation cycles, volume limits, auto-close on shortage).

Currently Sowel has no equipment type that fits this device class. Creating it as a `switch` would lose semantic meaning, proper UI affordances, and block future features like a dedicated auto-watering recipe that takes rain data into account.

A follow-up recipe (tracked as a future spec 063, in a separate plugin repo) will use this equipment type as its actuator, coupled with rain data from a rain gauge or weather forecast plugin.

## Goals

1. Introduce a new equipment type `water_valve` (in the `water` widget family)
2. Ship complete UI coverage: zone card + dashboard widget + equipment detail card
3. Use a custom SVG icon (handwheel gate valve) that fits Sowel's design system
4. Auto-bind the right data/orders when a user selects a SONOFF SWV (or similar smart valve) as source
5. Keep device-selector filtering tight so users don't see irrelevant devices at creation time
6. Prepare the ground for the future auto-watering recipe (FR063) by exposing the right orders

## Non-Goals

- Full UI for cyclic watering configuration (duration + interval + cycle count + capacity). The device firmware handles the cycle loop itself once orders are set; Sowel will expose a simpler "water now for X minutes" one-shot action. Cyclic configuration will be driven by the future auto-watering recipe (063), not from the equipment detail card.
- Supporting dumb water valves that only expose `state` (no irrigation\_\*, no flow). Users can create those as `switch` equipment — it's a conscious trade-off to keep the device filter useful.
- Rain-based automation logic (that's the follow-up recipe 063).
- Multi-valve coordinated watering (zone-level "water all valves for X min") — can be added later if needed.
- Water metering / billing aggregation — not in scope.

## Functional Requirements

### FR1 — New equipment type `water_valve`

- Add `"water_valve"` to the `EquipmentType` union in `src/shared/types.ts`
- Add it to `VALID_EQUIPMENT_TYPES` in `src/equipments/equipment-manager.ts`
- Register it in the i18n locale files (en + fr) with a proper display name ("Vanne d'arrosage" / "Water valve")

### FR2 — New widget family `water`

- Add `"water"` to the `WidgetFamily` union
- Add `water: ["water_valve"]` to `WIDGET_FAMILY_TYPES` in `src/shared/constants.ts`
- Prepares the ground for future water-related equipments (pump, water meter, leak sensor) without creating them now

### FR3 — Standard aliases (8 total, 1 required)

The equipment declares these aliases. They can be auto-bound from device keys via the auto-bind flow, or manually bound by the user.

| Alias      | Direction    | Required | Device source key (SONOFF SWV)  | UI behavior                             |
| ---------- | ------------ | -------- | ------------------------------- | --------------------------------------- |
| `state`    | data + order | **yes**  | `state` (boolean)               | Big toggle + zone count                 |
| `flow`     | data         | no       | `flow` (m³/h)                   | Live flow meter in detail card          |
| `battery`  | data         | no       | `battery` (%)                   | Battery gauge + low-battery badge       |
| `status`   | data         | no       | `current_device_status` (enum)  | Status badge (normal / shortage / leak) |
| `duration` | order        | no       | `irrigation_duration` (seconds) | Used by "Water now X min" action        |
| `cycles`   | order        | no       | `total_number` (times)          | Exposed for recipes (not UI)            |
| `interval` | order        | no       | `irrigation_interval` (seconds) | Exposed for recipes (not UI)            |
| `capacity` | order        | no       | `irrigation_capacity` (liters)  | Exposed for recipes (not UI)            |

The UI adapts dynamically: a valve with only `state` bound renders just the toggle; a full SONOFF SWV renders all sections.

### FR4 — Custom icon `WaterValveIcon`

- New component `ui/src/components/icons/WaterValveIcon.tsx`
- Custom SVG in Sowel style (stroke 1.5, currentColor, 24x24 viewBox, rounded linecaps)
- 5 primitive elements: pipe body (rounded rect), 2 flange lines, stepped base rect, handwheel (rounded rect)
- No stem rod, no central knob (user simplification)
- Props: `size`, `strokeWidth`, `className`, `title` (for a11y)
- Static icon — no state-based animation
- Used in zone card, dashboard widget, equipment detail card, and the icon picker

### FR5 — Icon picker integration

- Register `water_valve` as a custom icon in the existing `IconPicker` component
- Users creating an equipment can pick this custom icon (alongside Lucide icons)

### FR6 — Device filtering for equipment creation

- In `DeviceSelector.tsx`, add `water_valve` to `EQUIPMENT_TYPE_DATA_KEYS` with filter keys:
  ```ts
  water_valve: ["flow", "irrigation_capacity", "irrigation_duration", "irrigation_interval"];
  ```
- Rule: a device is candidate if it has **at least one** of these specific keys. This reliably identifies smart water valves while excluding lights, switches, sensors, etc.
- **Also fix the light_onoff / switch filters** to exclude devices that expose any irrigation\_\* keys — avoids the SONOFF SWV being mistakenly offered as a light.
- Dumb water valves that only expose `state` are NOT shown (by design — they can be created as `switch` if needed).

### FR7 — Auto-bind rules

In `ui/src/components/equipments/bindingUtils.ts`:

```ts
RELEVANT_DATA["water_valve"] = [
  "light_state", // SONOFF SWV `state` gets categorized as light_state by the inference;
  // we accept this and rely on the key-based device filter (FR6) to avoid
  // contamination between light_onoff and water_valve.
  "battery",
  "generic", // flow, irrigation_*, current_device_status
];

RELEVANT_ORDERS["water_valve"] = [
  "state",
  "irrigation_duration",
  "irrigation_interval",
  "irrigation_capacity",
  "total_number",
  "auto_close_when_water_shortage",
];

STANDARD_ALIASES["water_valve"] = {
  irrigation_duration: "duration",
  irrigation_interval: "interval",
  irrigation_capacity: "capacity",
  total_number: "cycles",
  current_device_status: "status",
  auto_close_when_water_shortage: "autoCloseWaterShortage",
};
```

When a user selects a SONOFF SWV during water_valve creation, the auto-bind produces the exact mapping described in FR3.

### FR8 — Zone Card widget

Compact summary displayed inside a zone view (next to other zone-level summaries like lights, shutters, sensors).

- Header: `WaterValveIcon` (small, primary) + "Arrosage" label in uppercase
- Primary metric: `<openCount>/<total>` (format like "1/2")
- Secondary line: "X ouverte(s)" + aggregate flow across valves if any have `flow` bound
- Metric color: `primary` if at least one valve is open, `text-tertiary` otherwise
- Low-battery indicator: small warning icon if any valve has battery < 20%
- Click → opens a detail sheet listing all valves in the zone

Pattern: mirrors `ZoneLightsWidget` / `ZoneShutterWidget` in structure and styling.

### FR9 — Dashboard Widget (water family)

Larger widget shown in the dashboard per-zone, under the new `water` family.

- Header: zone name + `WaterValveIcon` (family) + count
- Per-valve row:
  - Name
  - State dot (primary if open, muted if closed)
  - Live flow (`X.X m³/h`) if `flow` bound and valve open
  - Battery indicator (compact gauge)
  - Click on row → toggles state via `executeOrder(equipment, "state", !current)`
- Global footer action: **"Fermer tout"** button — closes all valves in the zone (safety action, useful during leaks or holidays)
  - Disabled if no valve is open
  - No "Open all" button (dangerous + not a meaningful user action; automation via recipes)

### FR10 — Equipment Detail Card

Full detail view shown when clicking an individual `water_valve` equipment.

Layout (rendered top to bottom, each section only if its bindings exist):

1. **Header** — `WaterValveIcon` (large, primary) + name + zone name + state badge
2. **Primary control** — big ON/OFF toggle button.
   - If `flow` bound: live flow value displayed in m³/h (updates via WebSocket)
3. **Secondary metrics** (grid, compact):
   - Battery: percentage + horizontal gauge (if `battery` bound)
   - Status: badge (Normal / Water shortage / Leak) with color coding (if `status` bound)
4. **Arrosage ponctuel** section — only if `duration` order is bound:
   - Numeric input (minutes, default 10, range 1-120)
   - Button "Arroser X min"
   - On click: dispatches `executeOrder(equipment, "duration", minutes*60)` followed by `executeOrder(equipment, "state", true)`. The valve firmware then closes automatically after `duration` seconds.
5. **Cycles automatiques** section (info read-only):
   - Lists active recipe instances bound to this equipment (filtered on recipe instance slots pointing to this equipment id)
   - If none: shows "Pas de recette active — créez-en une dans Recettes"

No manual configuration of cycles/interval/capacity from the equipment card. Those are recipe-owned.

### FR11 — Zone aggregation

The water family gets basic aggregation on zones:

- `waterValvesTotal`: count of water_valve equipments in the zone and descendants
- `waterValvesOpen`: count of valves whose `state` alias is truthy
- `waterFlowTotal`: sum of `flow` bindings across open valves (in m³/h) — only if at least one has flow bound

Exposed in `ZoneAggregatedData` so the zone card can consume them directly.

### FR12 — i18n strings (FR + EN)

- Equipment type name: "Vanne d'arrosage" / "Water valve"
- Family label: "Eau" / "Water"
- UI strings for the zone card, widget, and detail card (state labels, button labels, section titles, etc.)
- All new strings added to `ui/src/i18n/locales/{en,fr}.json`

### FR13 — Tests

- Unit test for the `water_valve` type registration and auto-bind mapping
- Unit test for zone aggregation of water valves
- No UI tests (project convention: no React component tests)

## Acceptance Criteria

- [x] FR1: `water_valve` is a valid `EquipmentType` accepted by `equipment-manager.ts`
- [x] FR2: `water` is a valid `WidgetFamily` containing `water_valve`
- [x] FR3: All 8 aliases declared in `RELEVANT_DATA` / `RELEVANT_ORDERS`
- [x] FR4: `WaterValveIcon` component exists and renders correctly at sizes 14-96 px
- [x] FR5: `IconPicker` offers `water_valve` as a custom icon option
- [x] FR6: When creating a `water_valve`, the DeviceSelector shows ONLY devices with irrigation\_\* keys (e.g., SONOFF SWV) — no lights, no switches, no sensors
- [x] FR6: When creating a `light_onoff`, the SONOFF SWV is NOT offered (excluded by new predicate)
- [x] FR7: Selecting a SONOFF SWV auto-creates the expected bindings with standard aliases
- [x] FR8: Zone view shows a compact "Arrosage" card with count + flow
- [x] FR9: Dashboard shows a per-zone water widget with individual toggles + "Fermer tout"
- [x] FR10: Equipment detail card adapts based on present bindings; "Arroser X min" works end-to-end
- [x] FR11: Zone aggregation exposes `waterValvesTotal`, `waterValvesOpen`, `waterFlowTotal`
- [x] FR12: i18n strings added in en + fr
- [x] FR13: All existing tests pass; new unit tests cover the new type
- [x] TypeScript compiles clean, lint clean, UI compiles clean
- [x] No new imports from legacy code (spec 053+ plugin architecture respected)

## Edge Cases

- **Valve offline (device status `offline`)**: equipment shows as "déconnecté" in UI, toggle disabled
- **`flow` bound but valve currently closed**: show "—" instead of 0.0 m³/h to avoid noise
- **Low battery (< 20%)**: warning badge on zone card, equipment card, and widget row
- **Status = water_shortage or leak**: equipment card shows red badge; recipes should abstain from opening the valve
- **User manually opens then forgets**: safety net is the `auto_close_when_water_shortage` flag (existing device feature) — not replicated in Sowel, just trust the firmware
- **Recipe opens valve but `duration` not bound**: recipe has to handle timed close itself (setTimeout logic in the recipe engine), which is out of scope here
- **Multiple valves in same zone**: aggregation shows the count + total flow; toggling one doesn't affect others; "Fermer tout" closes all sequentially
- **User creates `water_valve` from a dumb `state`-only device**: not allowed by filter (device won't appear). Workaround: create as `switch` equipment type.

## Related

- Follow-up: spec 063 (separate plugin repo) — auto-watering recipe consuming rain data
- Prerequisite: none — this is a standalone addition
- Supersedes: none

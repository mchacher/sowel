# Implementation Plan — Spec 062

## Strategy

Four slices, implemented in order, bundled in a single PR:

1. **A** — Types + equipment type registration + aggregation (backend + tests)
2. **B** — Icon + device filtering + auto-bind rules (UI infrastructure)
3. **C** — Visible components: Zone Card + Dashboard Widget + Equipment Detail Card
4. **D** — i18n + doc

The order minimizes broken intermediate states: each slice leaves the codebase compilable and tested.

---

## Slice A — Backend foundation

### A.1 — Types

**`src/shared/types.ts`**

- Add `"water_valve"` to `EquipmentType` union
- Add `"water"` to `WidgetFamily` union
- Extend `ZoneAggregatedData` with `waterValvesTotal?: number`, `waterValvesOpen?: number`, `waterFlowTotal?: number`

**`src/shared/constants.ts`**

- Add `water: ["water_valve"]` to `WIDGET_FAMILY_TYPES`

### A.2 — Equipment manager

**`src/equipments/equipment-manager.ts`**

- Add `"water_valve"` to `VALID_EQUIPMENT_TYPES`

### A.3 — Zone aggregator

**`src/zones/zone-aggregator.ts`**

Add water valve aggregation logic inside `computeForZone()`:

- Iterate zone equipments, filter by `type === "water_valve"`
- Count total and open (state aliased as "state")
- Sum flow across open valves (if `flow` bound)
- Cascade up the zone tree (sum across descendants)

### A.4 — Tests

**`src/zones/zone-aggregator.test.ts`**

Add test cases:

- Zone with 2 water_valve equipments, 1 open → `waterValvesTotal: 2, waterValvesOpen: 1`
- Zone with flow on open valves → `waterFlowTotal` is the sum
- Zone with a closed valve that has flow → flow contribution is 0 (only open valves count)
- Zone with no water_valve equipments → aggregation fields are undefined
- Parent zone cascade: sub-zones contribute

**`src/equipments/equipment-manager.test.ts`**

Add test case:

- Creating an equipment with `type: "water_valve"` succeeds
- Creating with invalid type rejects (unchanged)

### A.5 — Validate slice A

```bash
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run
```

All must pass before moving to slice B.

---

## Slice B — UI infrastructure

### B.1 — Type mirror

**`ui/src/types.ts`**

- Add `"water_valve"` to `EquipmentType`
- Add `"water"` to `WidgetFamily`
- Extend `ZoneAggregatedData` with water fields (mirror backend)

### B.2 — Custom icon

**`ui/src/components/icons/WaterValveIcon.tsx` (NEW)**

Create the SVG component per the architecture.md spec (5 primitives, no animation, props: `size`, `strokeWidth`, `className`, `title`).

### B.3 — Device filtering

**`ui/src/components/equipments/DeviceSelector.tsx`**

- Add `water_valve: ["flow", "irrigation_capacity", "irrigation_duration", "irrigation_interval"]` to `EQUIPMENT_TYPE_DATA_KEYS`
- Add `WATER_VALVE_MARKERS` set and `looksLikeWaterValve()` predicate
- Extend the `compatible` filter logic: when `equipmentType` is `light_onoff` or `switch`, exclude devices that `looksLikeWaterValve()`

### B.4 — Auto-bind rules

**`ui/src/components/equipments/bindingUtils.ts`**

- Add `water_valve` entry in `RELEVANT_DATA`: `["light_state", "battery", "generic"]`
- Add `water_valve` entry in `RELEVANT_ORDERS`: `["state", "irrigation_duration", "irrigation_interval", "irrigation_capacity", "total_number", "auto_close_when_water_shortage"]`
- Add `water_valve` entry in `STANDARD_ALIASES` with the mapping from FR7

### B.5 — Icon picker registration

**`ui/src/components/dashboard/IconPicker.tsx`**

- Register `water_valve` as a custom icon option (alongside any existing custom icons)
- Component rendering uses `<WaterValveIcon />`

### B.6 — Widget icons map

**`ui/src/components/dashboard/WidgetIcons.tsx`**

- Map `water` family → `WaterValveIcon`

### B.7 — Validate slice B

```bash
cd ui && npx tsc -b --noEmit && npx eslint .
```

Must compile clean. Visual inspection of the icon at `/tmp/water-valve-icon-preview.html` already done.

---

## Slice C — Visible components

### C.1 — Zone card

**`ui/src/components/zones/ZoneWaterWidget.tsx` (NEW)**

- Props: `zoneId`, `aggregation` (from `useZoneAggregation`)
- Renders per FR8 layout:
  - Header: `WaterValveIcon` + "Arrosage" uppercase
  - Metric: `{openCount}/{total}`
  - Subtext: "X ouverte(s)" + total flow if available
  - Low-battery indicator if any valve < 20%
- Click handler: opens detail sheet (reuse existing pattern like `WidgetDetailSheet`)

**Integration**: `ui/src/components/zones/ZoneWidgetGrid.tsx` — render `ZoneWaterWidget` when `aggregation.waterValvesTotal > 0`.

### C.2 — Dashboard widget

**`ui/src/components/dashboard/ZoneWaterDashboardWidget.tsx` (NEW)**

- Props: `widget` (DashboardWidget), `zoneEquipments`
- Renders per FR9 layout:
  - Header with zone name + count + family icon
  - Per-valve row: name + state dot + live flow + battery
  - Click on row → toggle state
  - Global "Fermer tout" button — disabled if no valve is open
- Uses `executeZoneOrder(zoneId, "allWaterValvesClose")` for "Fermer tout" — **no, actually use per-equipment `executeOrder` loop for simplicity** (avoids adding a new zone order key, since we don't want `allWaterValvesOpen` anyway)

**Integration**: `ui/src/components/dashboard/WidgetGrid.tsx` — render this widget when `widget.family === "water"`.

### C.3 — Equipment detail card

**`ui/src/components/equipments/WaterValveControl.tsx` (NEW)**

- Props: `equipment`, `dataBindings`, `orderBindings`
- Renders per FR10 layout:
  - Big toggle ON/OFF (uses `executeOrder(equipment, "state", newState)`)
  - Live flow (if `flow` bound)
  - Battery + status metrics (if bound)
  - "Arroser X min" section (if `duration` order bound):
    - Numeric input (1-120 min, default 10)
    - Button: on click, sequentially `executeOrder("duration", min*60)` then `executeOrder("state", true)`
  - Cycles automatiques section: fetch recipe instances bound to this equipment, list them or show "Pas de recette active"
- Handle edge cases: offline device → disable controls with tooltip

**Integration**: `ui/src/components/equipments/EquipmentCard.tsx` — when `equipment.type === "water_valve"`, render `WaterValveControl`.

### C.4 — Validate slice C

```bash
cd ui && npx tsc -b --noEmit && npx eslint .
```

Manual spot-check against the design proposals.

---

## Slice D — i18n + docs

### D.1 — i18n strings

**`ui/src/i18n/locales/en.json`** and **`ui/src/i18n/locales/fr.json`**

Add the strings listed in architecture.md § i18n.

### D.2 — Documentation

**`docs/technical/data-model.md`**

- Add `water_valve` to the EquipmentType list
- Add `water` to the WidgetFamily list
- Document the 8 standard aliases

**`docs/user/equipments.md`**

- Add a short section "Water valve" describing:
  - Purpose (irrigation control)
  - Supported devices (SONOFF SWV and similar)
  - Available actions (toggle, timed watering)
  - Integration with auto-watering recipes (forward reference)

**`docs/specs-index.md`**

- Append spec 062 in the "V1.0+" section with status ✅

### D.3 — No CLAUDE.md update needed

The AI agent entry point already references data-model.md for new equipment types. No change needed.

---

## Validation Plan

### Phase 4 — automated checks

```bash
# Backend
npx tsc --noEmit
npx eslint src/ --ext .ts
npx vitest run

# UI
cd ui && npx tsc -b --noEmit && npx eslint .
```

All must pass with **zero errors** (warnings acceptable per CLAUDE.md convention).

### Phase 4 — manual test plan

1. **Local dev with restored prod DB** (via `./scripts/run-swap.sh local` + restore backup):
   - The SONOFF_WATER_VALVE_00 is already discovered (from prod backup)
   - Go to Equipments → New → Type = "Water valve"
   - Verify the DeviceSelector shows ONLY the SONOFF SWV (not lights, not switches)
   - Create the equipment "Arrosage potager" in the Jardin zone
   - Verify bindings are auto-created with standard aliases (`state`, `flow`, `battery`, `status`, `duration`, `cycles`, `interval`, `capacity`)
2. **Zone card visible** on the Jardin zone page
3. **Dashboard widget visible** in the "Water" family section
4. **Equipment detail card**:
   - Toggle ON → live flow updates (if device is actually connected)
   - Click "Arroser 2 min" → verify state becomes true and duration order is sent
   - Verify the SONOFF firmware auto-closes after the set duration (observed via device data update)
5. **Non-regression — light_onoff creation**:
   - Go to Equipments → New → Type = "Light"
   - Verify the SONOFF SWV is NOT in the DeviceSelector list (excluded by the new predicate)
6. **Aggregation**:
   - Zone "Jardin" shows correct count (1 open / 1 total) after creating and toggling
   - Parent zone "Extérieur" aggregates correctly

### Phase 4 — production validation (after merge + release)

Deploy spec 062 on sowelox via self-update. Manually verify the same flow with the real SONOFF SWV (already discovered since 2026-04-11).

---

## Risks & Mitigations

| Risk                                                                                                       | Mitigation                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device filtering is too tight — excludes valid smart valves                                                | The 4 marker keys (flow, irrigation\_\*) cover all Zigbee2MQTT valves we've seen. Users can still manually create via `switch` type for edge cases.                                   |
| Category misclassification of `state` as `light_state` contaminates lights widget                          | We do NOT update the category inference. The key-based filter in DeviceSelector prevents lights being created from valve devices. For existing lights equipments, unchanged behavior. |
| Zone aggregation of flow uses sum, but multiple valves in the same zone could mean different circuits      | Sum is the correct semantic for "total current consumption across the zone". Users who care about per-valve flow see it in the detail card.                                           |
| "Arroser X min" requires sequential order dispatch (`duration` then `state`) — race condition possible     | Use `await` between the two calls. MQTT publish is fast enough that the timing works. The SONOFF firmware accepts `duration` then `state` in sequence.                                |
| Recipe engine future binding: recipes slot to water_valve equipment but the spec doesn't define slot types | Defer to spec 063 (auto-watering recipe). The equipment exposes enough aliases for recipes to work.                                                                                   |

---

## Out of Scope

- Auto-watering recipe (spec 063, different repo)
- Rain-aware watering logic (spec 063)
- Valve cycling UI (rely on device firmware or recipes)
- Multi-valve "zone-wide water now" command
- Water usage statistics / billing
- Historical flow charts (could reuse existing history system, but not explicit in this spec)
- Support for dumb valves that only expose `state` (create as `switch` instead)
- Migration of existing SONOFF SWV data from device category `light_state` to a hypothetical `valve_state` — stays `light_state` as-is

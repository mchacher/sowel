# Spec 213 — Architecture

## Flow diagram

```
SONOFF plug → zigbee2mqtt plugin → DeviceManager ("device.data.updated")
  → EquipmentManager.handleDeviceDataUpdated
      emits equipment.data.changed { alias: "power", value: W }      (unchanged)
      if appliance + numeric power + no bound state:
        ApplianceCycleTracker.onPower(eqId, W, now)
          → transition? emit equipment.data.changed { alias: "state", value, previous }
  ApplianceCycleTracker end-delay timer fires
      → running → finished, emit equipment.data.changed { alias: "state" }

equipment.data.changed { alias: "state" }
  → HistoryWriter (virtual appliance series, enum)        → InfluxDB
  → WebSocket → useEquipments.handleEquipmentDataChanged  → AppliancePanel, MobileWidgetCard
  → state-watch recipe (alias match, unchanged)

EquipmentManager.getDataBindingsWithValues(eqId)
  → unshift buildApplianceStateBinding(eqId, tracker.getState(eqId))   (like gate / cover)
```

## Components

### New: `src/equipments/appliance-cycle-tracker.ts`

- `export type ApplianceCycleState = "off" | "ready" | "running" | "finished"`.
- `export const APPLIANCE_CYCLE_DEFAULTS = { startW: 15, endW: 10, endDelayS: 300 }`,
  `OFF_W = 1`.
- `export function nextCycleState(state, power, thresholds): { state, armEndDelay: boolean,
cancelEndDelay: boolean }` — pure, the FR2 table, no clock. Unit-tested on its own.
- `class ApplianceCycleTracker` — owns per-equipment `{ state, since, endTimer }` in memory.
  - `constructor({ eventBus, logger, getThresholds(eqId) })`.
  - `onPower(eqId, power)`: applies `nextCycleState`, arms / clears the `setTimeout` of
    `endDelayS`, emits on transition. Never throws (try/catch + structured log).
  - `getState(eqId)`: current state, or a cold start from the power passed (FR Edge Cases:
    `> startW` → running, `< OFF_W` → off, else ready).
  - `reevaluate(eqId, power)`: after a thresholds change.
  - `forget(eqId)`: clears the timer (type change, power unbound, equipment removed).
  - `destroy()`: clears every timer.
- Timers are `unref()`'d so they never hold the process open.

### Changed: `src/equipments/equipment-manager.ts`

- Holds an `ApplianceCycleTracker`, created in the constructor (it needs nothing outside the
  manager but the event bus and logger).
- `appliesApplianceCycle(equipment, bindings)`: FR1 test (type `appliance`, a `power` binding of
  type `number`, no `state` binding).
- `getDataBindingsWithValues`: after the gate and cover blocks, when FR1 holds (value `null` while
  the power has none), `unshift(buildApplianceStateBinding(...))` — id `virtual:appliance_state:<eqId>`,
  `enumValues`, `stale` copied from the power binding.
- In the device-data path, next to the gate's derived emit (`:1857`): when the binding that
  changed is the `power` of an equipment where FR1 holds, call `tracker.onPower`.
- `update()`: persist `applianceCycle`; on change, `tracker.reevaluate`. On a type change away
  from `appliance`, clear the field and `tracker.forget`.
- Binding removal / equipment removal: `tracker.forget`.

### Changed: `src/shared/types.ts` (and `ui/src/types.ts`)

- `export interface ApplianceCycleThresholds { startW: number; endW: number; endDelayS: number }`.
- `Equipment.applianceCycle?: ApplianceCycleThresholds | null` (spec 213 comment).
- `HistoryBindingState` (API response type) gains `virtual?: boolean` and
  `enumValues?: string[]`.

### New: `migrations/046_appliance_cycle.sql`

```sql
-- Spec 213 — per-appliance thresholds of the run state derived from power.
-- NULL = the defaults (start 15 W, end 10 W for 300 s).
ALTER TABLE equipments ADD COLUMN appliance_cycle TEXT;
```

JSON text, parsed in the row mapper, like other JSON columns of the table.

### Changed: `src/api/routes/equipments.ts`

- Schema: `applianceCycle: { type: ["object", "null"], properties: { startW, endW, endDelayS },
required: [...], additionalProperties: false }`.
- Validation of FR3.2 in the handler (cross-field rules), 400 with the field named.
- Rejected with 400 on a non-`appliance` type, as `family` is on a non-`switch` (`:498`).

### Changed: `src/history/history-writer.ts`

- `refreshCache`: skip `virtual:` bindings **except** `virtual:appliance_state:*`, which is added
  to `historizedBindings` and `bindingMeta` (type `enum`, its `enumValues`). The existing write
  path then handles it unchanged, enum encoding included.
- `equipment.updated` already triggers `refreshCache`; the virtual binding appears or goes with
  the bindings.

### Changed: `src/api/routes/history.ts`

- `/history/bindings/:equipmentId`: keep `virtual:appliance_state:*`, flagged `virtual: true`,
  `historize: null`, `effectiveOn: true`; add `enumValues` on every row. The gate and cover
  virtual bindings stay filtered out.

### Changed: UI

- `ui/src/components/history/history-utils.ts`: `familyOf(category, enumValues?)` and
  `isBooleanCategory(category, enumValues?)` return the non-boolean result for
  `appliance_state` with more than two `enumValues`. Callers pass the row's `enumValues`.
- History page binding list: no historize toggle on a `virtual` row.
- `AppliancePanel.tsx`, `MobileWidgetCard.tsx`, `EquipmentWidget.tsx`, `CompactEquipmentCard.tsx`
  (appliance cases): shared helpers `applianceIsOn`, `applianceState`, `applianceStateLabelKey`
  in `ui/src/lib/appliance.ts` (FR5.1), labels for `ready` / `finished`.
- `AnalyseView.tsx` and `tooltip-format.ts`: the series carries its `enumValues`, passed to
  `familyOf` / `isBooleanCategory` / `axisForCategory`.
- New `ui/src/components/equipments/ApplianceCyclePanel.tsx`: admin section on the equipment
  page for `appliance` (FR3.3, FR3.4), mounted next to `MeteringParentPanel`. Saves through
  `updateEquipment` in `ui/src/api/equipments.ts`.
- i18n `en.json` / `fr.json`: panel title, field labels, units, inactive notice, state labels.

## Files changed

| File                                                             | Change                              |
| ---------------------------------------------------------------- | ----------------------------------- |
| `migrations/046_appliance_cycle.sql`                             | new column                          |
| `src/shared/types.ts`, `ui/src/types.ts`                         | thresholds type, field, history row |
| `src/equipments/appliance-cycle-tracker.ts` (+ test)             | new: state machine and timers       |
| `src/equipments/equipment-manager.ts` (+ test)                   | virtual binding, power hook, field  |
| `src/api/routes/equipments.ts`                                   | field schema and validation         |
| `src/history/history-writer.ts` (+ test)                         | historize the virtual series        |
| `src/api/routes/history.ts`                                      | list it, `virtual`, `enumValues`    |
| `ui/src/lib/appliance.ts` (+ test)                               | `applianceIsOn`                     |
| `ui/src/components/equipments/AppliancePanel.tsx`                | on/off rule, labels                 |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`               | on/off rule, labels                 |
| `ui/src/components/dashboard/EquipmentWidget.tsx`                | on/off rule, labels                 |
| `ui/src/components/home/CompactEquipmentCard.tsx`                | on/off rule, labels                 |
| `ui/src/components/history/AnalyseView.tsx`, `tooltip-format.ts` | pass `enumValues`                   |
| `ui/src/pages/EquipmentDetailPage.tsx` (history row)             | no toggle on a derived series       |
| `ui/src/components/equipments/ApplianceCyclePanel.tsx`           | new settings section                |
| `ui/src/pages/EquipmentDetailPage.tsx`                           | mount it                            |
| `ui/src/components/history/history-utils.ts` (+ test)            | cardinality for `appliance_state`   |
| `ui/src/i18n/locales/{en,fr}.json`                               | strings                             |
| docs (see spec Docs Delta)                                       | EN + FR                             |

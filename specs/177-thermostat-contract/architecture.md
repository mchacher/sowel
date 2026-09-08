# Architecture — Spec 177

## The declaration

`src/shared/thermostat-contract.ts` is pure TypeScript with no backend dependency, so the UI
bundles it directly (the spec 150 pattern for `binding-candidates.ts`). It owns:

```ts
THERMOSTAT_STATE_ALIAS = "state"          // moved here from binding-candidates.ts, re-exported there
THERMOSTAT_CORE: readonly ThermostatCoreEntry[]   // the table in spec.md, one row per alias
THERMOSTAT_CORE_DATA_ALIASES: ReadonlySet<string> // derived from the table
THERMOSTAT_CORE_ORDER_ALIASES: ReadonlySet<string>
isThermostatCoreAlias(kind, alias): boolean
isThermostatDevice(data, orders): boolean          // identity: setpoint data or set_setpoint order
splitThermostatExtras(dataBindings, orderBindings) // { extraData, extraOrders }, sorted by alias
```

`binding-candidates.ts` imports the state alias from the contract and re-exports it, so the
existing importers (`bindingUtils`, `thermostat-state`, `inferDataBindingCategory`) are untouched.
The dependency runs contract → nothing, candidates → contract; never the other way.

## Flow

```
Device (any vendor)
  data: { key, category }      orders: { key, category?, type, enumValues? }
        │                                │
        ▼                                ▼
  isThermostatDevice() ── setpoint / set_setpoint category ──► offered in DeviceSelector
        │
        ▼
  computeBindingPlan("thermostat")
    data:   RELEVANT_DATA (categories, incl. generic)  ──► resolveAlias ──► core alias | raw key
    orders: bind ALL (BIND_ALL_ORDER_TYPES)            ──► resolveAlias ──► core alias | raw key
        │
        ▼
  bindings on the equipment
        │
        ▼
  ThermostatCard
    core  = bindings whose alias ∈ THERMOSTAT_CORE_*_ALIASES   → the existing controls
    extras = splitThermostatExtras(...)                          → ThermostatExtras (generic)
```

## Components

### New: `src/shared/thermostat-contract.ts`

The declaration above. `isThermostatDevice` takes the minimal `{ category? }` shapes so both
`DeviceWithData` (UI) and `CandidateData` (shared) satisfy it.

### New: `src/shared/thermostat-contract.test.ts`

Core sets, identity on Panasonic-like / MCZ-like / sensor / order-only devices, the extras split.

### Changed: `src/shared/types.ts`, `ui/src/types.ts`

`DataCategory` gains `operation_mode`, `OrderCategory` gains `set_operation_mode`. A TypeScript
union, no migration. `OPERATION_MODE_VALUES` (auto / heat / cool / dry / fan / off) lives in the
contract module.

### Changed: `src/shared/binding-candidates.ts`

`THERMOSTAT_STATE_ALIAS` becomes a re-export. The `thermostat` candidate case is split from
`heater` and returns no candidate when `isThermostatDevice` is false, so the shared module and the
selector agree on what a thermostat is (the case is not on the plan path, thermostat not being
candidate-based, but a shared truth must not contradict itself).

### Changed: `ui/src/components/equipments/bindingUtils.ts`

- `RELEVANT_ORDERS.thermostat` removed. `BIND_ALL_ORDER_TYPES = new Set(["thermostat"])`,
  consulted first by `isRelevantOrder`: a thermostat binds every order its device exposes.
- `TYPE_CATEGORY_ALIASES.thermostat` gains `temperature: "temperature"`, `operation_mode:
"operationMode"` and `set_operation_mode: "operationMode"` next to the spec 176
  `temperature_outdoor` rule, so the whole core is category-driven.
- `RELEVANT_DATA.thermostat` gains `operation_mode`.
- `STANDARD_ALIASES.thermostat` unchanged, with a comment naming #922 as its removal.

### Changed: `ui/src/components/equipments/DeviceSelector.tsx`

`EQUIPMENT_TYPE_DATA_KEYS.thermostat` removed. The compatibility chain gains a thermostat branch
calling `isThermostatDevice(device.data, device.orders ?? [])` before the key/category fallbacks.

### Changed: `ui/src/components/equipments/ThermostatCard.tsx`

Core only. Removed: the `profile` fallback for the mode, the fan-speed section, the eco indicator,
the stove badge, the reset-alarm button, `stoveStateColor`, the stove entries of `MODE_ICONS` /
`MODE_COLORS`. The mode selector translates with a raw-value fallback. Renders
`<ThermostatExtras>` after the core, passing the same `optimistic` map and `exec` so extras get the
spec 176 per-alias optimistic clearing for free (an extra's mirror is its own alias).

### New: `ui/src/components/equipments/ThermostatExtras.tsx`

Generic. Props: the two binding arrays, `optimistic`, `executing`, `onExec`. Computes
`splitThermostatExtras`, then:

| Extra                             | Rendered as                                                       | Sends               |
| --------------------------------- | ----------------------------------------------------------------- | ------------------- |
| order `enum` (values present)     | segmented buttons, current = optimistic ?? same-alias data value  | `(alias, value)`    |
| order `boolean` + same-alias data | toggle button showing on/off                                      | `(alias, !current)` |
| order `boolean`, no data mirror   | momentary action button                                           | `(alias, true)`     |
| order `number`                    | stepper, step 1, bounded by `min`/`max`, current from data mirror | `(alias, n ± 1)`    |
| order `text` / `json`             | nothing                                                           |                     |
| data with no same-alias order     | read-only chip: label · formatted value                           |                     |

Labels: `t("thermostat.extras.<alias>", humanize(alias))`; enum values:
`t("thermostat.values.<alias>.<value>", value)`; booleans: `common.on` / `common.off`; numbers with
the binding's unit. Both files stay free of any vendor alias.

### Changed: `ui/src/i18n/locales/{en,fr}.json`

The scattered `thermostat.fanSpeeds.*`, `thermostat.ecoModes.*`, `stove.state.*`,
`stove.profile.*`, `stove.pellet.*`, `stove.sparkPlug.*` keys move under the one generic scheme
`thermostat.values.<alias>.<value>` (only `ThermostatCard` used them). New `thermostat.extras.*`
labels for the aliases Sowel already knows and `thermostat.extras.title` for the section.

### Docs

- `docs/user/equipments.md` + `.fr.md`: the thermostat paragraph says core vs extras.
- `docs/technical/data-model/equipments.md`: a "Thermostat contract (spec 177)" section (no FR
  counterpart exists for that page).
- `docs/specs-index.md` + `.fr.md`: row 177.
- `specs/176-thermostat-run-state/spec.md`: one forward pointer.

## Files changed

| Domain | File                                                   | Change                                           |
| ------ | ------------------------------------------------------ | ------------------------------------------------ |
| shared | `src/shared/thermostat-contract.ts`                    | New: the declaration                             |
| shared | `src/shared/thermostat-contract.test.ts`               | New                                              |
| shared | `src/shared/binding-candidates.ts`                     | Re-export state alias; thermostat candidate gate |
| ui     | `ui/src/lib/thermostat-contract.ts`                    | New: re-export for the UI bundle                 |
| ui     | `ui/src/components/equipments/bindingUtils.ts`         | Bind-all orders; temperature category rule       |
| ui     | `ui/src/components/equipments/bindingUtils.test.ts`    | Unknown-vendor plan test                         |
| ui     | `ui/src/components/equipments/DeviceSelector.tsx`      | Category identity                                |
| ui     | `ui/src/components/equipments/ThermostatCard.tsx`      | Core only + extras section                       |
| ui     | `ui/src/components/equipments/ThermostatExtras.tsx`    | New: generic extras                              |
| ui     | `ui/src/components/equipments/ThermostatCard.test.tsx` | Extras regression tests                          |
| ui     | `ui/src/i18n/locales/{en,fr}.json`                     | Generic value/label keys                         |
| docs   | user + data-model + specs-index (EN/FR)                |                                                  |

# Spec 152 — Architecture

## Overview

A second, independent on/off command channel ("solar") is added to
`water_heater` and `switch` equipments. It reuses the entire existing
order/binding/resolution/execute pipeline; the only genuinely new primitives are
one `OrderCategory` (`solar_toggle`), one `DataCategory` (`solar_state`), and the
UI that renders/binds a second toggle. Nothing in the arbiter, the event bus, the
REST surface, or the DB schema changes.

## Design principle

The main on/off already lives as _"an order binding whose category is
`light_toggle`/`toggle_power`, alias `state`, resolved by `findOrderByCategory`"_
(spec 150). The solar channel is the exact same shape under a reserved category
and alias, so the two never collide during category-first resolution:

| Channel   | Order alias | Order category                  | State alias   | State category |
| --------- | ----------- | ------------------------------- | ------------- | -------------- |
| Main      | `state`     | `light_toggle` / `toggle_power` | `state`       | `light_state`  |
| **Solar** | `solar`     | `solar_toggle`                  | `solar_state` | `solar_state`  |

## Data model changes

### `src/shared/types.ts`

- `OrderCategory` (`:69-96`) gains `| "solar_toggle"`.
- `DataCategory` (`:10-…`) gains `| "solar_state"`.

### `ui/src/types.ts`

- Mirror both additions (kept in sync by convention with the backend union).

Migration **023** adds `data_bindings.category_override TEXT` (mirror of the
`order_bindings` column from migration 006; nullable, no backfill —
`COALESCE(category_override, dd.category)` = `dd.category` on existing rows). With
that column, a solar binding is a normal row (`alias='solar'`,
`category_override='solar_toggle'` on the order; `alias='solar_state'`,
`category_override='solar_state'` on the data).

## Backend changes

### 1. On/off channel helpers — `src/shared/binding-candidates.ts`

- `POWER_TOGGLE_CATEGORIES` (`:92`) stays main-only. Add a sibling constant
  `SOLAR_TOGGLE_CATEGORIES = new Set<OrderCategory>(["solar_toggle"])` and a
  predicate `isSolarOrderCategory(cat)`.
- `isOnOffOrder` is unchanged: the _device_ order the user assigns to the solar
  role is still an ordinary on/off order (Zigbee boolean `state`, Tasmota enum).
  The solar-ness lives in the **equipment binding's category override**, not in
  the device order.
- `computeBindingCandidates` for `water_heater`/`switch` (`:165-193`) is
  unchanged (it enumerates the physical on/off channels). Solar assignment is a
  role choice made in the editor over those same channels — see UI.

### 2. Binding category inference — `src/shared/binding-candidates.ts`

- `inferBindingCategory(equipmentType, orderShape)` (`:498-529`) keeps returning
  `null` for `switch`/`water_heater`'s main channel (falls back to the device's
  own `light_toggle`/`toggle_power`). Solar is **never inferred** — it is set
  explicitly by the editor when the user picks the "Solaire" role, which passes
  an explicit `category = "solar_toggle"` (and `alias = "solar"`) to
  `addOrderBinding` / `addDataBinding`.
- `addOrderBinding` (`equipment-manager.ts:680-723`) already accepts a category
  override path; confirm it persists an explicit `solar_toggle` (extend the
  signature only if the UI cannot currently pass an explicit alias+category for
  a chosen order — see plan).

### 3. Resolution — `src/equipments/binding-resolver.ts`

Add thin resolvers (or call the generic `findOrderByCategory`/`findDataByCategory`
directly at the call sites):

```ts
findOrderByCategory(orderBindings, ["solar_toggle"], ["solar"]); // solar command
findDataByCategory(dataBindings, ["solar_state"], ["solar_state"]); // solar state
```

The main-channel resolution (`["light_toggle","toggle_power"], ["state"]`) is
unchanged, so a solar binding never shadows it and vice versa.

### 4. Order execution — `src/equipments/equipment-manager.ts`

`executeOrder(equipmentId, alias, value, source)` (`:745-940`) is **unchanged**:
it already resolves bindings by alias via `getOrderBindingsByAlias`. Passing
alias `"solar"` naturally dispatches only the solar binding; `"state"` only the
main one. Add coverage, not code.

### 5. Zone aggregation — `src/zones/zone-aggregator.ts`

`solar_state` is an actuator state, not a measurement. The aggregator already
guards numeric aggregation (e.g. temperature at `:570` requires
`alias === "temperature"`), and only aggregates known measurement categories.
Confirm `solar_state` is treated exactly like `light_state`/`appliance_state`
(never summed/averaged). Add a regression test.

## UI changes

### 6. States family (Analyse) — `ui/src/components/history/history-utils.ts`

`familyOf()` must map `solar_state` → `"states"` (alongside `light_state`,
`appliance_state`, `lock_state`, `gate_state`, `cover_state`). Add its semantic
tick labels (`Arrêt`/`Marche`) wherever the states family renders ticks
(TimeSeriesChart / history-utils). This makes a solar-state series chart as a
stepped [0,1] state, per spec 144.

### 7. Binding metadata — `ui/src/components/equipments/bindingUtils.ts`

- Extend the per-type category maps (`:106` `switch`, `:119` `water_heater`) to
  include `solar_state` (and, for orders, allow `solar_toggle`).
- Add the FR/EN human label for the `solar` role and the `solar_state` category.

### 8. Binding editor — the one substantial UI addition

In the equipment binding management (settings) for `water_heater`/`switch`, the
user must be able to take an on/off device channel and bind it under the
**"Solaire"** role rather than (or in addition to) the main on/off. Concretely:
a role selector on an on/off candidate → main (`state`/`light_toggle`) vs solar
(`solar`/`solar_toggle`), which drives the alias + category override passed to
`addOrderBinding` (and the matching state to `addDataBinding` as `solar_state`).
Exact component: the equipment bindings editor used on the detail/settings page
(see `ui/src/components/equipments/…` binding UI). This is the only place that
needs new interaction beyond rendering.

### 9. Two independent toggles

The main-on/off resolution → toggle already exists in
`ui/src/components/equipments/LightControl.tsx` (main), and the compact/mobile
cards render it. Add a **parallel solar control**:

- `CompactEquipmentCard.tsx` (`:247` region): render main toggle iff main
  on/off binding resolves; render a "Solaire" toggle iff the solar binding
  resolves. Independent handlers:
  `executeEquipmentOrder(id, "solar", onVal|offVal)`.
- `MobileWidgetCard.tsx` (`:443`) and `mobile-click-action.ts` (`:55-82`):
  same, add the solar order resolution + a distinct tap target.
- `EquipmentDetailPage.tsx`: render the main control (include `water_heater`,
  which the inline block at `:267` currently omits) and a solar control block
  below it. State from `solar_state`.
- Solar glyph: Lucide `Sun` (stroke 1.5). Label: FR "Solaire" / EN "Solar".

### 10. UI order resolution helpers — `ui/src/components/equipments/bindingUtils.ts` (or `LightControl` twin)

Add a small `findSolarOrder(orderBindings)` /
`findSolarState(dataBindings)` mirroring `findOrderByCategory` usage, so the
cards resolve the solar channel the same way everywhere (keep the UI resolver in
sync with the backend one, per the existing convention).

## Interaction with the arbiter (no change, must stay true)

- The follow-up recipe dispatches the solar order via
  `ctx.dispatchOrder(equipmentId, "solar", "ON"|"OFF")` inside its
  `onGranted`/`onRevoked` callbacks — `source.kind = "recipe"`.
- The arbiter's `onOrderExecuted` (`capacity-arbiter.ts:437-511`) already
  classifies order sources: a `manual` solar order → manual-override suspension
  (FR-6); a `recipe` solar order → recipe intent. This is verified by AC7, not
  re-implemented.
- `energyProfile` is unchanged. For the Calypso the admin sets
  `class = deferrable` (auto-default already), `nominalPowerW ≈ 650` (heat pump
  only at 62 °C — the 1800 W booster never engages in PV mode), and raises
  `minOnS` to cover the appliance's own ~30 min release tail. The global
  `releaseHoldS` is unchanged; there is no per-profile release delay (corrects
  an earlier assumption).

## Files touched (summary)

| File                                                                          | Change                                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/shared/types.ts`                                                         | `+solar_toggle` (OrderCategory), `+solar_state` (DataCategory) |
| `src/shared/binding-candidates.ts`                                            | `SOLAR_TOGGLE_CATEGORIES`, `isSolarOrderCategory`              |
| `src/equipments/binding-resolver.ts`                                          | solar order/state resolution (or call sites)                   |
| `src/equipments/equipment-manager.ts`                                         | explicit alias+category on add binding if needed; tests        |
| `src/zones/zone-aggregator.ts`                                                | confirm `solar_state` excluded from aggregation + test         |
| `ui/src/types.ts`                                                             | mirror the two new categories                                  |
| `ui/src/components/history/history-utils.ts`                                  | `familyOf("solar_state") → states` + ticks                     |
| `ui/src/components/equipments/bindingUtils.ts`                                | solar role/category metadata + labels + UI resolver            |
| equipment bindings editor component                                           | "Solaire" role assignment for on/off channels                  |
| `ui/src/components/home/CompactEquipmentCard.tsx`                             | second (solar) toggle                                          |
| `ui/src/components/dashboard/MobileWidgetCard.tsx` + `mobile-click-action.ts` | second (solar) toggle                                          |
| `ui/src/components/equipments/EquipmentDetailPage.tsx`                        | main (incl. water_heater) + solar control blocks               |
| i18n FR/EN files                                                              | "Solaire"/"Solar" + tooltip                                    |
| `docs/user/equipments.{md,fr.md}`, `docs/technical/data-model.md`             | document the solar channel                                     |

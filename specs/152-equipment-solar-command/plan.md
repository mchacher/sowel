# Spec 152 — Implementation plan

## Task breakdown (in dependency order)

### A. Types & constants

- [x] A1 — `src/shared/types.ts`: add `"solar_toggle"` to `OrderCategory`,
      `"solar_state"` to `DataCategory`.
- [x] A2 — `ui/src/types.ts`: mirror both.
- [x] A3 — `src/shared/binding-candidates.ts`: add `SOLAR_CHANNEL_TYPES` +
      `SOLAR_ORDER_ALIAS`/`SOLAR_STATE_ALIAS` and the solar branches of
      `inferBindingCategory`/`inferDataBindingCategory`; `isOnOffOrder`/candidates
      unchanged. (Shipped as inference, not a standalone `isSolarOrderCategory`.)

### B. Binding & resolution (backend)

- [x] B1 — `src/equipments/binding-resolver.ts`: solar resolvers (or documented
      direct `findOrderByCategory(…, ["solar_toggle"], ["solar"])` /
      `findDataByCategory(…, ["solar_state"], ["solar_state"])` call sites).
- [x] B2 — `equipment-manager.ts`: ensure `addOrderBinding`/`addDataBinding`
      can persist an **explicit** alias (`solar`) + category override
      (`solar_toggle` / `solar_state`). Extend the input path only if it cannot
      today.
- [x] B3 — Confirm `executeOrder(id, "solar", …)` dispatches solar-only (no code
      change expected) — locked by tests.

### C. Aggregation & history classification

- [x] C1 — `src/zones/zone-aggregator.ts`: confirm/treat `solar_state` as an
      actuator state excluded from measurement aggregation.
- [x] C2 — `ui/src/components/history/history-utils.ts`: `familyOf("solar_state")
    → "states"`; add `Arrêt`/`Marche` semantic ticks for the series.

### D. UI — binding editor

- [x] D1 — UI resolves the solar channel via the existing
      `findOrderByCategory([solar_toggle],[solar])` /
      `findDataByCategory([solar_state],[solar_state])` (bindingUtils, shared with
      the backend). Solar label reuses the `equipments.group.solar` i18n key.
- [~] D2 — A solar binding is created through the existing **AddBindingModal**
  free-alias entry: pick the device on/off order/data and set alias
  `solar` / `solar_state`; the backend infers the category. No dedicated
  role-selector UI was added (the free-alias path already satisfies AC1);
  a discoverability preset can follow if wanted.

### E. UI — two toggles

- [x] E1 — `CompactEquipmentCard.tsx`: render main toggle iff main binding;
      "Solaire" toggle iff solar binding; independent handlers. **The solar
      toggle reuses the exact same switch/toggle control as the light on/off,
      only the glyph changes to a small sun** (user directive).
- [x] E2 — `MobileWidgetCard.tsx` + `mobile-click-action.ts`: solar toggle.
- [x] E3 — `EquipmentDetailPage.tsx`: include `water_heater` in the main control
      block; add a solar control block; state from `solar_state`.
- [x] E4 — Lucide `Sun` glyph, FR/EN i18n strings.

### F. Docs

- [x] F1 — `docs/user/equipments.{md,fr.md}`: document the solar channel and the
      two-toggle card (with the Calypso wiring as the worked example).
- [~] F2 — `docs/technical/data-model.md` is high-level and does not enumerate
  binding columns or category unions, so there is nothing to add there.
  Migration 023 is documented in the migration file and architecture.md.

## Test Plan

### Modules to test

- `src/shared/binding-candidates.ts` — `isSolarOrderCategory`, candidate
  stability.
- `src/equipments/binding-resolver.ts` — solar order/state resolution vs main.
- `src/equipments/equipment-manager.ts` — `executeOrder` alias routing; add-binding
  persists explicit solar alias+category.
- `src/zones/zone-aggregator.ts` — `solar_state` not aggregated.
- `ui/src/components/history/history-utils.ts` — `familyOf`, ticks.

### Scenarios per module

| Module             | Scenario                                                          | Expected                                                                 |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| binding-resolver   | Equipment with main + solar order bindings, resolve solar         | Returns the `solar`/`solar_toggle` binding, not the main one             |
| binding-resolver   | Resolve main on/off when a solar binding also exists              | Returns the `state`/`light_toggle` binding, unaffected by solar          |
| binding-resolver   | Solar-only equipment (Calypso), resolve main                      | Returns none; resolve solar returns the solar binding                    |
| binding-resolver   | Resolve `solar_state` data                                        | Returns the `solar_state` binding; main `light_state` unaffected         |
| equipment-manager  | `executeOrder(id, "solar", "ON")` with main + solar bound         | Dispatches only to the solar device order; main device order not called  |
| equipment-manager  | `executeOrder(id, "state", "ON")` with main + solar bound         | Dispatches only to the main device order; solar not called               |
| equipment-manager  | `executeOrder(id, "solar", …)` with no solar binding              | Explicit "no matching binding" outcome, no dispatch                      |
| equipment-manager  | add on/off order under solar role                                 | Row persisted with `alias='solar'`, `category_override='solar_toggle'`   |
| binding-candidates | `isSolarOrderCategory("solar_toggle") / ("light_toggle")`         | `true` / `false`; on/off candidates for switch/water_heater unchanged    |
| zone-aggregator    | Zone with a `solar_state` binding among equipments                | `solar_state` never contributes to any numeric aggregate                 |
| history-utils      | `familyOf("solar_state")`                                         | `"states"`                                                               |
| history-utils      | Mixed chart: `temperature` + `solar_state`                        | temperature on measurement axis; solar_state stepped on [0,1] state axis |
| arbiter (guard)    | manual solar order on a profiled equipment (`source.kind=manual`) | manual-override suspension fires (existing FR-6 path, regression guard)  |
| arbiter (guard)    | recipe solar order (`source.kind=recipe`)                         | treated as recipe intent, no override suspension                         |

### Retro-compat

- Pre-152 `switch` / `water_heater` with only a main on/off binding: identical
  behaviour, no solar toggle rendered, no new aggregation, charts unchanged.
- Other equipment types: untouched (no solar candidate offered).

## Manual verification (Phase 4)

Drive it on a local docker instance (shadow / dev, per repo conventions — never
prod, never a dev run on prod data):

1. Create a `water_heater`, bind a Zigbee relay's `state` under the **Solaire**
   role. Compact card shows a single "Solaire" toggle (no main on/off).
2. Toggle it → the relay actuates; `solar_state` reflects on the toggle.
3. Add a second relay as the **main** on/off → card now shows two independent
   toggles; each drives its own device.
4. Analyse the equipment: the solar state charts as a stepped Arrêt/Marche line,
   not a smooth 0→1 measurement.

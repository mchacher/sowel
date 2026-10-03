# Spec 183 — Plan

## Steps

- [ ] 1. Contract module and tests.
- [ ] 2. Types (backend + UI), `CATEGORY_EXPECTED_TYPE`, `VALID_EQUIPMENT_TYPES`, `NON_SUBMETER_TYPES` (both), `TIMED_EXCLUDED_TYPES`.
- [ ] 3. Contract-first auto-binding generalised to a per-type contract map (backend `createWithAutoBindings`, UI `computeBindingPlan`), `ev_charger` behaviour unchanged.
- [ ] 4. UI binding rules, type meta, form, device selector.
- [ ] 5. Read model `electricVehicleState.ts` + tests; `ElectricVehicleControl`.
- [ ] 6. Surfaces: card, zone group, widgets, sheet, detail page (no energy panel).
- [ ] 7. i18n EN/FR, docs EN/FR, specs index EN/FR.
- [ ] 8. Validate; candidate-instance check with the Renault plugin when it exists.

## Test plan

| Module                      | Scenario                                          | Expected                                                                                                                                                         |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electric-vehicle-contract` | Core table                                        | data: battery_level, range, plugged, charging_state, reported_at, at_home, mileage, charge_limit; orders: wake, charge_start, charge_limit (set_ev_charge_limit) |
| `electric-vehicle-contract` | Category map                                      | each new category → its alias                                                                                                                                    |
| `electric-vehicle-contract` | Identity                                          | `ev_battery_level` → true; `battery` (device battery) alone → false                                                                                              |
| `electric-vehicle-contract` | Charging state guard                              | the seven values true; others false                                                                                                                              |
| `electric-vehicle-contract` | Extras split                                      | fuel/hvac extras kept, core removed, sorted                                                                                                                      |
| `equipment-manager`         | Create `electric_vehicle`                         | accepted                                                                                                                                                         |
| `equipment-manager`         | API auto-bind of a Renault-shaped device          | contract aliases; `fuelAutonomy` extra under its key; vendor key equal to an alias does not take it                                                              |
| `equipment-manager` (retro) | API auto-bind of an EV charger                    | unchanged (spec 182 test still green)                                                                                                                            |
| `metering`                  | `electric_vehicle` with a numeric `power` binding | not a submeter                                                                                                                                                   |
| `timed-command`             | `electric_vehicle`                                | never eligible                                                                                                                                                   |
| `bindingUtils` (UI)         | Plan for a Renault-shaped device                  | contract aliases, orders `wake` / `charge_start`, extras                                                                                                         |
| `bindingUtils` (UI, retro)  | EV charger plan                                   | unchanged                                                                                                                                                        |
| `electricVehicleState` (UI) | Full car                                          | battery, range, plugged, state, age, charge limit and its order bounds, wake/charge orders                                                                       |
| `electricVehicleState` (UI) | `reported_at` 3 h old                             | `stale` with the age; fresh → not stale                                                                                                                          |
| `electricVehicleState` (UI) | `reported_at` absent                              | age from `lastUpdated`                                                                                                                                           |
| `electricVehicleState` (UI) | State outside the enum, battery null              | state null, battery null                                                                                                                                         |
| `widget-utils`              | `electric_vehicle`                                | opens the sheet                                                                                                                                                  |

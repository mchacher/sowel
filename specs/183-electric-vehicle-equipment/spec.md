# Spec 183 — Electric vehicle equipment type

- **Status**: Implemented — AC6 (surfaces) to verify on a candidate instance with the Renault plugin
- **Date**: 2026-10-03
- **Related**: spec 182 (EV charger — the other half of a charge), spec 177 (thermostat contract — the pattern for an equipment contract in code), spec 156 (UPS — new categories with a closed enum), spec 143 (low-battery monitor — why the car's battery is not `battery`)
- **First plugin**: `sowel-plugin-renault` (MyRenault account; Renault Rafale E-Tech plug-in hybrid now, a Megane E-Tech soon)

## Context

Spec 182 gave Sowel the charger. The charger knows whether a car is plugged and drawing; it does not know the car's battery level, and it cannot make a sleeping car charge. Both were measured on the owner's installation:

- A Renault Rafale whose charge pauses goes to sleep within minutes. The charger then reads the car as plugged but not asking for current (pilot ~9 V), and nothing on the charger side wakes it — not a start command, not a charger reboot, not twenty seconds without mains. Only a physical replug at the car, or a **remote command sent to the car through the manufacturer's cloud**, does. A remote lights command (the lights do not even flash) restarted the charge thirteen seconds later.
- The same cloud reports the battery level, the electric range, whether the car is plugged and charging, and the mileage — which is what lets a charging recipe aim at "80 % by 7 am" rather than at a number of kWh.

So a car is an equipment in its own right. Sowel has none: no type, no categories for a vehicle's battery or charge state, no order to wake it.

**The equipment defines the contract, the plugin adapts.** This spec declares what an electric vehicle is in Sowel, brand-independent. The Renault plugin is the first to publish it.

## Goals

1. A first-class `electric_vehicle` equipment type for anything that plugs in: battery-electric and plug-in hybrid cars alike.
2. **The electric vehicle contract** (`src/shared/electric-vehicle-contract.ts`, the spec 177 / 182 pattern): aliases, categories, identity, and the charging-state vocabulary.
3. A `wake` order: brand-independent, the plugin chooses how. And an optional `charge_start` for the cars whose maker allows it.
4. Surfaces that say how old the car's data is: a sleeping car reports nothing for hours, and a battery level of "8 %" read three hours ago is not the same fact as one read now.

## Non-goals

- **Charging logic.** When to charge, from the surplus or off-peak, and when to wake the car, belong to the charging recipe. The car only exposes and obeys.
- **Linking a car to a charger in the core.** The recipe binds both in its slots (one charger may serve two cars). Decided with the maintainer.
- **Climate control, horn, lights, door locks as user commands.** A plugin may use one of them to implement `wake`; they are not part of the contract.
- **GPS coordinates.** Decided with the maintainer: the contract carries `at_home` only; no coordinate is published, stored or historised.
- **Charge power and energy.** The charger measures them (spec 182). A car publishing `power` or `energy` would become a second submeter for the same kilowatt-hours.
- **Fuel** (a plug-in hybrid's tank and fuel range): published by a plugin as extras, outside the contract. Decided with the maintainer.
- **Charge schedules and charge mode.** Forbidden on the first car (Rafale) and varying by maker; a later spec when a car supports them.
- **The recipe's own target** ("80 % by 7 am") is a recipe parameter, not car data: the recipe enforces it by stopping the charger at `battery_level`, which works even on a car that does not expose `charge_limit`.

## The electric vehicle contract

### Core aliases

| Alias            | Side  | Category                        | Type    | Unit | Required    | Meaning                                                                          |
| ---------------- | ----- | ------------------------------- | ------- | ---- | ----------- | -------------------------------------------------------------------------------- |
| `battery_level`  | data  | **`ev_battery_level`** (new)    | number  | %    | yes         | Traction battery state of charge                                                 |
| `range`          | data  | **`ev_range`** (new)            | number  | km   | recommended | Electric range                                                                   |
| `plugged`        | data  | **`ev_plugged`** (new)          | boolean | —    | recommended | A charging cable is connected to the car                                         |
| `charging_state` | data  | **`ev_charging_state`** (new)   | enum    | —    | recommended | What the car says about charging (vocabulary below)                              |
| `reported_at`    | data  | **`ev_reported_at`** (new)      | string  | ISO  | recommended | When the car itself last reported — not when the plugin polled                   |
| `at_home`        | data  | **`ev_at_home`** (new)          | boolean | —    | optional    | The car is at the home location (computed by the plugin, no coordinates)         |
| `mileage`        | data  | **`ev_mileage`** (new)          | number  | km   | optional    | Odometer                                                                         |
| `charge_limit`   | data  | **`ev_charge_limit`** (new)     | number  | %    | optional    | The charge limit the car applies by itself (set in the car or its app)           |
| `charge_limit`   | order | **`set_ev_charge_limit`** (new) | number  | %    | optional    | Change that limit, on cars whose maker allows it; bounded by the order's min/max |
| `wake`           | order | **`ev_wake`** (new)             | none    | —    | recommended | Wake the car; the plugin chooses the means                                       |
| `charge_start`   | order | **`ev_charge_start`** (new)     | none    | —    | optional    | Ask the car to start charging, on cars whose maker allows it                     |

Everything else a plugin binds — fuel level and range, climate status, tyre pressures, the maker's raw codes — is an **extra**: bound and visible, and no core path, card layout or recipe contract keys off it (the spec 177 rule).

### Charging state

`ev_charging_state` is a closed enum, resolved by the plugin to exactly one value:

| Value       | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `unplugged` | No cable                                            |
| `idle`      | Plugged, not charging and not waiting               |
| `scheduled` | Plugged, waiting for a charge the car has scheduled |
| `waiting`   | Plugged, ready, waiting for the charger to deliver  |
| `charging`  | Charging                                            |
| `completed` | The charge ended (target reached or full)           |
| `error`     | The car reports a charging fault                    |

`waiting` is the state a sleeping car is left in: it is how a recipe recognises the car it must wake (together with the charger's `vehicle = connected`).

### Why new categories

- **`ev_battery_level` is not `battery`**: `battery` is the device-battery category the low-battery monitor watches (spec 143). A car at 8 % would raise "replace the battery".
- **`ev_plugged`, `ev_charging_state`, `ev_at_home`** carry meanings no existing category has, and a recipe must find them without knowing the maker.
- **`ev_reported_at`** because a car's data can be hours old while the binding's own timestamp says "just now" (the plugin polled a cache). The age that matters is the car's.
- **Orders**: `ev_wake` / `ev_charge_start` are momentary, like `display_wake` — no value.

### Identity

A device is offered for an `electric_vehicle` when it declares `ev_battery_level`.

## Functional requirements

- **FR1 — Type.** `electric_vehicle` is a valid `EquipmentType`, creatable from the form and the API, persisted, exported and restored. No migration.
- **FR2 — Contract module.** `src/shared/electric-vehicle-contract.ts` declares the core table, the category → alias map, the identity rule, `EV_CHARGING_STATE_VALUES`, and the extras split. Binding, UI and tests import it.
- **FR3 — Categories.** The eleven categories join `DataCategory` / `OrderCategory` (backend and UI mirror), with their expected value types; the eight data categories are labelled EN/FR (order categories are not shown to users, as for spec 182).
- **FR4 — Auto-binding.** Both creation paths (UI plan and API `deviceIds`) bind the contract points under their contract alias, from their category, first; `generic` data binds as extras; other orders are opt-in.
- **FR5 — Not a meter, not a load.** An `electric_vehicle` is never a submeter and never a flexible load for the arbiter: no energy profile (the server clears one on save, including one carried over from another type), no metering panel. The charger is the load.
- **FR6 — No timed command.** Like the charger (spec 182 FR12).
- **FR7 — Freshness.** Every surface that shows the battery level shows its age from `reported_at` when it is more than 15 minutes old ("il y a 2 h").
- **FR8 — Zone card and dashboard widget** (desktop and mobile): a car icon, the battery level as the headline with a bar, the range, a plug/charging indicator, the age. A mobile tap opens the detail sheet.
- **FR9 — Detail page and sheet.** The contract values (the battery bar marks `charge_limit` when bound), a **Wake** button when `wake` is bound a **Start charging** button when `charge_start` is bound, and a charge-limit stepper when the `charge_limit` order is bound (each sends its order and reports success or the plugin's error), then the extras.
- **FR10 — Zone grouping.** A new "Vehicles" group in the zone view.
- **FR11 — Documentation.** User guide (EN/FR) section with the contract; data model; specs index EN/FR.

## Acceptance criteria

- [x] AC1 — `electric_vehicle` creatable (form, API), persisted, exported, restored; other types unchanged.
- [x] AC2 — The contract module is the single declaration.
- [x] AC3 — A device publishing the contract categories auto-binds the contract aliases on both paths; extras under their keys.
- [x] AC4 — The device picker offers devices with `ev_battery_level`.
- [x] AC5 — No energy profile, no metering panel, no timed command on a vehicle; not counted as a submeter.
- [ ] AC6 — Card, widgets and sheet show battery, range, plug/charge state and the age when old; Wake and Start charging send their orders and show the outcome.
- [x] AC7 — `tsc`, tests and lint green (backend, tests, UI); docs checks green.

## Edge cases

| Case                                           | Expected                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `reported_at` absent                           | Age taken from the binding's own update time                  |
| Battery level unknown (null)                   | "—", no bar                                                   |
| `charging_state` outside the enum              | Indicator hidden                                              |
| `wake` refused by the maker or the car         | Button reports the plugin's error message                     |
| Car offline in the cloud (no network for days) | Equipment degraded per spec 116 by the plugin's device status |
| Plug-in hybrid                                 | Same contract; fuel values as extras                          |
| Two cars on one account                        | Two devices, two equipments                                   |

## Decisions

Taken with the maintainer on 2026-10-03: one type for battery-electric and plug-in hybrid, fuel as extras; location as `at_home` only; orders `wake` and `charge_start`; the car's charge limit in the contract (`charge_limit`, data and order — order category `set_ev_charge_limit` —, optional); car ↔ charger link in the recipe, not the core. Measured the same day: the Rafale forbids `charging-start` (`err.func.wired.forbidden`) and wakes on a remote lights command.

Taken by the agent, flagged for review: category names with an `ev_` prefix; `reported_at` as a contract point rather than a binding attribute; a 15-minute threshold before showing the age; a dedicated "Vehicles" zone group.

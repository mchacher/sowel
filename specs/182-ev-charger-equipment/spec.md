# Spec 182 — EV charger equipment type

- **Status**: Implemented — merged (PR #1005), amended after the 2026-10-03 test run; first device `sowel-plugin-tuya` v0.2.0
- **Date**: 2026-10-03
- **Related**: spec 140 (energy capacity arbiter), spec 177 (thermostat contract — the pattern for an equipment contract in code), spec 176 (`appliance_state` for an on/off run state), spec 156 (UPS — the precedent for new data categories with a closed enum), spec 135 (water heater — controllable load with metering)
- **First device**: [`sowel-plugin-tuya`](https://github.com/mchacher/sowel-plugin-tuya) v0.1.0, the dé portable EV charger

## Context

An electric vehicle is the largest deferrable load a home has: 1.4 to 3.7 kW on a single-phase portable charger, 7 to 11 kW on a wallbox, for hours, at a time of the user's choosing. Spec 140's class table already names "EV" as the archetypal deferrable load, yet Sowel has no equipment type for a charger. Today one can only be modelled as a `switch`, which loses everything that makes it a charger: whether a car is plugged in, the charging current, the energy delivered in the current session, and the identity a recipe needs to find it.

The first integration exists: `sowel-plugin-tuya` drives a dé portable charger over the local network, walked end to end on real hardware. It publishes a status, a vehicle state, live power, energy increments, a current setpoint and three orders — but under `generic` categories wherever Sowel has no word for the concept. Those words are what this spec adds.

**The equipment defines the contract, the plugin adapts.** `ev_charger` declares, in Sowel, which aliases a charger carries and which data and order categories each one has, reusing existing categories wherever they fit (`power`, `energy`, `current`, `voltage`, `toggle_power`) and adding new ones only where none does. Any integration that wants its device to be an EV charger publishes those categories; the tuya plugin is updated to do so as a follow-up.

## Goals

1. A first-class `ev_charger` equipment type: creatable, auto-bound, rendered on every surface (zone card, dashboard widget desktop and mobile, detail page), with its own icon.
2. **The EV charger contract** (`src/shared/ev-charger-contract.ts`): the core aliases, their categories, the identity rule, and the vehicle-state vocabulary — declared once and imported by binding, UI and tests, like the thermostat contract (spec 177).
3. Three new data categories and one order category, so that the vehicle state, the charging current and the session energy are first-class values a card, a chart and a recipe can read without knowing the plugin.
4. A **deferrable** flexible load by default for the arbiter, with charger-appropriate anti-short-cycle timings, and its consumption counted as a submeter.

## Non-goals

- **Charging logic.** Solar-surplus charging, off-peak charging, a target energy or a departure time are a recipe (`ev-charge-smart`, next step of the EV project). The equipment only exposes and commands.
- **Power modulation by the arbiter.** The arbiter grants or revokes; it never commands a power level (spec 140). A "modulating claim" is a separate core spec.
- **Vehicle data** (state of charge, range, battery temperature). A charger does not know them; they belong to a future vehicle equipment fed by a car integration.
- **Charger configuration** beyond the current setpoint: plug-in behaviour, schedules, NFC, phase switching, maximum installation current. They stay extras when a plugin exposes them.
- **Three-phase accounting.** A three-phase charger publishes its total `power`; per-phase readings are extras.
- **Auto-creating the equipment from the plugin.** As for every type, the user creates it and binds a device.

## The EV charger contract

### Core aliases

| Alias            | Side  | Category                             | Type    | Unit | Required    | Meaning                                                                                |
| ---------------- | ----- | ------------------------------------ | ------- | ---- | ----------- | -------------------------------------------------------------------------------------- |
| `state`          | data  | `appliance_state` (or `light_state`) | boolean | —    | yes         | Charging enabled and active: the charger is delivering, or ready to deliver on request |
| `state`          | order | `toggle_power` (or `light_toggle`)   | boolean | —    | yes         | Start / stop charging                                                                  |
| `vehicle`        | data  | **`ev_vehicle_state`** (new)         | enum    | —    | recommended | Whether a vehicle is there and drawing: `disconnected`, `connected`, `charging`        |
| `power`          | data  | `power`                              | number  | W    | recommended | Live power delivered to the vehicle                                                    |
| `energy`         | data  | `energy`                             | number  | Wh   | optional    | Energy increments (the core's additive convention), for the energy history             |
| `charge_current` | data  | **`ev_charge_current`** (new)        | number  | A    | optional    | The charging current the charger is set to deliver                                     |
| `charge_current` | order | **`set_ev_charge_current`** (new)    | number  | A    | optional    | Set the charging current; the order's `min` / `max` carry the charger's range          |
| `session_energy` | data  | **`ev_session_energy`** (new)        | number  | kWh  | optional    | Energy delivered since the vehicle was plugged in (resets with each session)           |
| `current`        | data  | `current`                            | number  | A    | optional    | Measured charging current                                                              |
| `voltage`        | data  | `voltage`                            | number  | V    | optional    | Measured supply voltage                                                                |

Everything else a plugin binds — charger status codes, temperatures, the last session's energy, configuration — is an **extra**: it stays bound and visible in the detail page's generic list, it varies from one charger to the next, and no core code path, card layout or recipe contract may key off it (the spec 177 rule).

### New categories

| Category                | Kind  | Type   | Unit | Values / range                           |
| ----------------------- | ----- | ------ | ---- | ---------------------------------------- |
| `ev_vehicle_state`      | data  | enum   | —    | `disconnected`, `connected`, `charging`  |
| `ev_charge_current`     | data  | number | A    | ≥ 0                                      |
| `ev_session_energy`     | data  | number | kWh  | ≥ 0, resets at the start of each session |
| `set_ev_charge_current` | order | number | A    | the order's own `min` / `max`            |

`ev_vehicle_state` is a closed enum mirroring the IEC 61851 states a charger reads on its pilot line: **A** — no vehicle (`disconnected`); **B** — a vehicle is connected but not drawing, whether it is waiting, paused, full or refused (`connected`); **C/D** — the vehicle is drawing (`charging`). A plugin resolves its own status vocabulary to exactly one value. Error states are not a vehicle state: they stay the plugin's own status extra.

Why new categories rather than reuse:

- **`set_ev_charge_current` is not `set_setpoint`**: `set_setpoint` is the thermostat's identity category (spec 177), so reusing it would offer every charger as a thermostat and target it with zone temperature orders.
- **`ev_session_energy` is not `energy`**: `energy` is an additive delta (`history-writer.ts`); a per-session counter written there would be summed into nonsense.
- **`ev_charge_current` is not `current`**: `current` is a measurement; a setpoint stored under it would chart as a measured value and be compared against the real one.

### Identity

A device is offered for an `ev_charger` when it declares a data point of category `ev_vehicle_state` or an order of category `set_ev_charge_current`. Both are categories a plugin declares, never a vendor key. A plain relay or a metered plug is not a charger and is not offered — it can still be bound manually.

## Functional requirements

- **FR1 — Type.** `ev_charger` is a valid `EquipmentType`: creatable from the form and the API, persisted, exported and restored. No SQLite migration (equipment types are not CHECK-constrained).
- **FR2 — Contract module.** `src/shared/ev-charger-contract.ts` declares the core table above, the identity rule, `EV_VEHICLE_STATE_VALUES`, and a helper splitting core bindings from extras. Binding, UI and tests import it; nothing restates it.
- **FR3 — Categories.** The four new categories join `DataCategory` / `OrderCategory` (backend and the UI mirror), with their expected value types, and the UI labels them in English and French.
- **FR4 — Auto-binding.** Creating an `ev_charger` from a device binds each core point under its contract alias, resolved from its **category**, whatever the plugin calls the key (`toggle_power` → `state`, `ev_vehicle_state` → `vehicle`, `set_ev_charge_current` → `charge_current`, …). A device's `temperature` / `temperature_device` reading is aliased `charger_temperature`, so it never joins the zone's room-temperature average. Every other `generic` data point binds as an extra under its own key; other categorised points and orders outside the contract (charger configuration) are opt-in, added by hand. Contract points bind first, so a vendor key that happens to equal a contract alias cannot take it. The same rules apply when the equipment is created through the API with `deviceIds`.
- **FR5 — Device picker.** The picker offers the devices that match the identity rule; its existing "show all devices" switch reaches any other device, as for the other types.
- **FR6 — Energy arbiter.** `ev_charger` defaults to class **deferrable**, with `minOnS` 600 and `minOffS` 300: an on-board charger negotiates for several seconds at each start, and a car toggled every few minutes is a car whose charge the user stops trusting. Both values stay editable per equipment. The arbiter reads the `power` binding as the load's live draw and the `state` binding as its on/off state — no arbiter code change.
- **FR7 — Metering.** A charger with a `power` or `energy` binding is a submeter, as any equipment is (spec 091); it is also a metering relay type, so its cards show live power and it ranks in the submeter list like a metered switch or water heater.
- **FR8 — Zone card and dashboard widget** (desktop and mobile): the charger icon, a vehicle badge (`Débranchée` / `Branchée` / `En charge`), live power when charging, and the start/stop toggle (an explicit toggle, never a tap on the whole tile). On mobile, a tap opens the detail sheet rather than toggling: starting a charge is not a light switch.
- **FR9 — Detail page.** A charger panel: start/stop, the vehicle state, live power, session energy, and — when a `charge_current` order is bound — a current stepper bounded by the order's `min` / `max`, with 1 A steps, sending `set_ev_charge_current`. Measured current and voltage when bound. Extras below, in the generic list. The energy-management panel (spec 140) is available as for any controllable load.
- **FR12 — No timed command.** The timed command (spec 174) is never offered on an `ev_charger`, on any surface or through the API (`TIMED_EXCLUDED_TYPES`): the charge is driven by a recipe and the arbiter, a generic "send, then send back" would cut a charge midway, and the charging current carries no state for it to watch. _(Amendment after the 2026-10-03 test run.)_
- **FR13 — No duplicated measurements.** The detail page shows the charger's power, current and voltage in its control block; the generic electrical-measurements panel is not shown on an `ev_charger`. The energy-consumption panel (hour, day, month, year) stays. _(Amendment after the 2026-10-03 test run.)_
- **FR10 — Zone grouping.** Chargers appear in the zone view's "Énergie / Power" group, next to UPS units.
- **FR11 — Documentation.** The user guide (EN/FR) gains an EV charger section with its contract table; the data model lists the type and the categories; the energy guide (EN/FR) lists `ev_charger` among the flexible-load types.

## Acceptance criteria

- [x] AC1 — `ev_charger` is creatable (form, API), persisted, exported and restored; existing types unchanged.
- [x] AC2 — The contract module is the single declaration: binding, UI and tests import it.
- [x] AC3 — A device publishing the contract categories auto-binds `state` (data + order), `vehicle`, `power`, `energy`, `charge_current` (data + order), `session_energy`, `current`, `voltage` under those aliases, whatever its keys; its temperature binds as `charger_temperature`; any other data point binds as an extra under its key; configuration orders are not auto-bound.
- [x] AC4 — The picker offers identity-matching devices first.
- [x] AC5 — A new `ev_charger` pre-fills the energy profile as deferrable, 10 min on / 5 min off.
- [x] AC6 — Zone card, desktop widget and mobile widget show the icon, the vehicle badge, the power and the toggle; the mobile tap opens the sheet.
- [x] AC7 — The detail page starts and stops the charge and sets the current within the order's range.
- [x] AC8 — The charger counts as a submeter on the Energy page.
- [x] AC9 — `tsc` (backend, tests, UI), the whole test suite and lint pass; docs parity and impact checks pass.

## Edge cases

| Case                                                                     | Expected                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only `state` bound (a relay modelled as a charger)                       | Toggle works; no vehicle badge, no power, no stepper                                                                                                                                                                                                                             |
| `vehicle` bound, value null or outside the enum                          | Badge hidden                                                                                                                                                                                                                                                                     |
| `charge_current` order without `min` / `max`                             | Stepper bounded 6 to 32 A (the IEC 61851 floor, the common single-phase ceiling)                                                                                                                                                                                                 |
| `charge_current` order bound, no setpoint reading                        | The stepper starts at the minimum on the first press and shows the last value the charger accepted                                                                                                                                                                               |
| `charge_current` data bound, order not bound                             | Current shown read-only                                                                                                                                                                                                                                                          |
| Charger offline                                                          | Equipment degraded/offline per spec 116; the start/stop toggle is hidden on every surface and the stepper disabled                                                                                                                                                               |
| Device's `temperature` reading                                           | Aliased `charger_temperature`, never folded into the zone temperature average                                                                                                                                                                                                    |
| A second `power`-category point (e.g. per-phase power)                   | First by binding order wins today (the arbiter's `isPowerAlias`); per-phase points are extras — documented, not solved here                                                                                                                                                      |
| Plugin still publishing `generic` for vehicle and setpoint (tuya v0.1.0) | Bound as extras under their keys. Surfaces read category first, then the contract alias, so a key that happens to equal an alias (v0.1.0's `vehicle`) still shows; the setpoint (`currentSetpoint`) and its order stay hidden until the plugin publishes the contract categories |

## Follow-ups (outside this repository)

- **`sowel-plugin-tuya` v0.2.0**: publish `ev_vehicle_state` (key `vehicle`), `ev_charge_current` and `set_ev_charge_current` (key `charge_current`, order bounded by the charger's DP 152), `ev_session_energy` (key `session_energy`). A plugin spec 002 there, written against this contract. Its start/stop order must also declare `valueOn: true` / `valueOff: false`: Sowel's on/off surfaces send `"ON"` / `"OFF"`, and the dispatcher maps them to a boolean only when the device declares its wire values (`order-wire-value.ts`); v0.1.0 does not, so a toggle from the UI would be refused by the plugin today.
- **Recipes**: `ev-charge-smart` declares its slot with `equipmentType: "ev_charger"`.

## Decisions taken without the maintainer

The maintainer asked for this feature to run autonomously up to the pull request. These choices are the agent's and are flagged for review:

1. Four new categories (above), named with an `ev_` prefix rather than generic names (`vehicle_state`, `charge_current`), because each is meaningful only on a charger.
2. `state` (not `charge`) as the start/stop alias, so every on/off surface and the arbiter's state lookup work unchanged.
3. Default timings 10 min on / 5 min off.
4. Mobile tap opens the sheet instead of toggling.
5. The "Power" zone group rather than a new "Mobility" group.

## Test run on a candidate instance (2026-10-03)

A local instance built from `main` (the v1.72.0 runtime with this code), a fresh database and only `sowel-plugin-tuya` 0.2.0, driven with Playwright against the owner's charger, desktop and mobile:

- API and UI creation bind the contract aliases; the device picker offers only the charger; configuration orders are opt-in.
- Zone card, detail page (badge, start/stop, session, current, voltage, stepper 8 → 9 → 8 A applied by the charger, extras), desktop widget and mobile widget render; a mobile tap opens the sheet and sends no order.
- The energy panel offers the charger as a flexible load, 10 min on / 5 min off.
- A start request while the car does not ask for current (pilot 9.6 V, IEC state B) is reported as not reflected: correct, the car decides.

Fixed from that run: the timed command was offered (FR12), the electrical-measurements panel repeated the control block (FR13), the device-temperature label read "inverter temperature" on every device, and the desktop tile's toggle carried a stray separator.

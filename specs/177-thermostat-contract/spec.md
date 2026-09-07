# Spec 177 — What a Sowel thermostat is, and extras rendered as extras

Issue: [#921](https://github.com/mchacher/sowel/issues/921) (part 1 of 2, split out of #919).
Part 2 is [#922](https://github.com/mchacher/sowel/issues/922): make the plugins publish the
contract and migrate existing bindings. It is deliberately not here.

## Context

`bindingUtils.ts` states the intent: integrations expose protocol-specific keys, the equipment
model provides a strict, integration-agnostic contract, and recipes and scenarios depend on those
standard aliases. For `thermostat` the contract was never written down. Two keys were
canonicalised (`targetTemperature → setpoint`, `insideTemperature → temperature`) and the rest of
the vendor vocabulary went straight through and _became_ the type, in three places:

1. The auto-binding order list for a thermostat was the Panasonic and MCZ key list
   (`nanoe`, `airSwingUD`, `airSwingLR`, `profile`, `resetAlarm`). Every other equipment type has a
   generic list (`state`, `position`, `brightness`, `R1..R4`).
2. A device was offered as a thermostat only when it exposed the raw key `targetTemperature`.
3. The card special-cased `profile` (a pellet-stove mode), `fanSpeed`, `ecoMode`, `stoveState`, and
   gated a `resetAlarm` button on a stove state string.

Spec 176 is what that cost: on the submetered Panasonic, `power` meant both the clamp's wattage and
the unit's on/off, the boolean had nowhere to live, and five ON orders went out in ninety seconds.
Spec 176 fixed the symptom with a dedicated alias. The cause is that an equipment's vocabulary was
whatever its device exposed. In that spec's own words: **an alias is not a vocabulary.**

Related specs: 077 (data/order categories, the plugin-agnostic layer this spec keys on), 150
(binding candidates), 152 (reserved binding-role aliases), 176 (the thermostat run state).

## Goals

1. Declare, in one place under `src/shared/`, the small integration-agnostic core every thermostat
   surface and every recipe may rely on.
2. Make compatibility and auto-binding derive from that declaration and from spec 077 categories,
   never from a vendor key.
3. Make the card lead with the core and render whatever else is bound generically, so no vendor
   concept has a code path of its own in the product UI.
4. Change nothing a running installation depends on: no data, no plugin, no binding, no migration.

## Non-Goals

- What any plugin publishes. `sowel-plugin-panasonic-cc` and `sowel-plugin-mcz-maestro` keep their
  keys; the `STANDARD_ALIASES.thermostat` key map stays as the compatibility layer until #922
  removes it.
- Existing bindings. A production thermostat keeps every binding it has today.
- Making the plugins publish `operation_mode` / `set_operation_mode` with the vocabulary above.
  The category and the values are declared here; adopting them is plugin work (#922).
- The metering convention (`power` data = wattage on a submetered unit, spec 176).
- Other equipment types. Their order lists are already generic; if an audit finds another vendor
  vocabulary it gets its own issue.
- Splitting `thermostat` into several types (reversible heat pump vs pellet stove). Raised in #919,
  parked: the two share the whole core and diverge only in their extras, which is exactly what the
  extras surface absorbs.

## Functional Requirements

### FR1 — The core is declared once

`src/shared/thermostat-contract.ts` declares the thermostat core. It is the only place the list
exists; `bindingUtils`, `DeviceSelector`, `binding-candidates` and `ThermostatCard` import it.

| Alias                | Data | Order | Meaning                                                                                                                                                 |
| -------------------- | ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `temperature`        | ✓    |       | The measured room temperature. What the zone aggregator folds into the room average.                                                                    |
| `setpoint`           | ✓    | ✓     | The target temperature. Data: category `setpoint`. Order: category `set_setpoint`.                                                                      |
| `state`              | ✓    |       | The boolean run state the device reports about itself (spec 176). Read first by every on/off surface.                                                   |
| `power`              | ✓    | ✓     | Order: the on/off command (category `toggle_power`). Data: the wattage on a submetered unit; on a legacy thermostat, the boolean bound before spec 176. |
| `operationMode`      | ✓    | ✓     | The operating mode. Data category `operation_mode`, order category `set_operation_mode`, values below.                                                  |
| `outsideTemperature` | ✓    |       | Optional. The outdoor probe many units carry; pinned by the spec 176 category rule and shown next to the room temperature.                              |

**The `power` collision, settled.** The order `power` is the on/off command and stays so: it is
what the card drives, what zone orders send (`allThermostatsPowerOn`), what recipes parameterised
by alias use. The data `power` is _not_ the run state: by contract it is the live wattage where a
clamp is bound, and the boolean run state lives under `state`. A boolean bound under `power` is a
legacy shape that `thermostatPowerStateBinding` keeps reading (spec 176), never a contract. No
alias is renamed by this spec.

**The operating mode has a category and a vocabulary.** `operation_mode` (data) and
`set_operation_mode` (order) join the spec 077 taxonomy so the mode resolves from a category like
the rest of the core, whatever the plugin calls the key (`operationMode`, `mode`, `system_mode`).
A plugin declaring them commits to the common HVAC set, on the model of `ups_status` (spec 156):

| Value  | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| `auto` | the unit chooses between heating and cooling                           |
| `heat` | heating                                                                |
| `cool` | cooling                                                                |
| `dry`  | dehumidification                                                       |
| `fan`  | ventilation only                                                       |
| `off`  | optional; for units whose mode carries the stop (Zigbee `system_mode`) |

`power` stays the on/off command; `off` in the mode is a value some units report, never something
the core depends on. A pellet stove has one mode, `heat`; its programme (`profile`) is an extra.
Until #922, the Panasonic `operationMode` key (category `generic`) reaches the core through the
key map, and the MCZ `profile` is an extra.

**Identity.** A device qualifies as a thermostat when it exposes a data point of category
`setpoint` or an order of category `set_setpoint`. Both Panasonic and MCZ publish these today (spec
077), so no plugin changes. A device without a setpoint (a sensor, a clamp) is not offered as a
thermostat; the selector's "show all devices" toggle remains the escape hatch for a submetered
unit's clamp, exactly as today.

### FR2 — Everything else is an extra

An extra is any bound alias that is not in the core. Extras stay bound, stay usable, and vary from
one equipment to the next. They do not define the type: no core code path, no recipe contract, no
card layout keys off them. `nanoe`, `airSwingUD`, `fanSpeed`, `profile`, `stoveState`,
`resetAlarm`, `pelletSensor` are extras, and so is anything a vendor Sowel has never met publishes.

### FR3 — Auto-binding derives from the contract

A thermostat binds the whole surface of the device it is created from: the core resolves to its
canonical aliases through spec 077 categories (and, until #922, the `STANDARD_ALIASES.thermostat`
key map), and every other order binds under its own key as an extra. The thermostat order list no
longer exists as a hand-written vendor key list.

Why bind all rather than core only with manual opt-in (the spec 133 camera pattern): a thermostat
device is one appliance with no channel to protect from cross-binding (the spec 150 concern), the
data side already binds everything through the `generic` category, and binding the core only would
silently drop the fan speed and eco controls a Panasonic user has today. The plan is still shown
before it is written (issue #707).

The room temperature and the operating mode join the category-driven core: on a thermostat, a data point of category
`temperature` resolves to the `temperature` alias whatever the plugin calls the key, in line with
the spec 176 `temperature_outdoor → outsideTemperature` rule. Scoped to `thermostat`, like the
water-heater override that precedes it in the same table.

### FR4 — The card leads with the core, renders extras generically

`ThermostatCard` renders, in this order:

1. **Core**: room temperature (+ outside), power toggle, setpoint stepper, mode selector driven by
   the `operationMode` order's enum values. The `profile` fallback for the mode selector is gone: a
   pellet stove's profile is an extra.
2. **Extras**, in a secondary section, from what is actually bound and nothing else:
   - one control per extra **order**, chosen by the order's type: `enum` → a segmented button row;
     `boolean` with a data binding of the same alias → a toggle; `boolean` without one → a momentary
     action button (sends `true`); `number` → a stepper bounded by the order's `min`/`max`. `text`
     and `json` orders get no generic control.
   - one read-only chip per extra **data** binding that has no order of the same alias.
   - labels come from i18n when a translation exists for the alias or the value, and fall back to
     the alias humanised (`airSwingUD` → "Air swing UD") and the raw value. Translations are
     dictionary entries, never layout.

The `resetAlarm` special case is gone: it is a boolean order with no mirror, hence a momentary
action button, always available. The stove-state colour semantics are gone with it: a stove state
is an enum reading and renders as a chip.

The compact card and the dashboard widgets read the core only and are unchanged.

## Acceptance Criteria

- [ ] The core alias set for `thermostat` is declared in one place in `src/shared/`, and the UI
      tables import it rather than restating it.
- [ ] `RELEVANT_ORDERS.thermostat` no longer exists as a vendor key list; a thermostat from an
      unknown vendor auto-binds its core under canonical aliases and its extras under their keys.
- [ ] A device is offered as a thermostat by the `setpoint` / `set_setpoint` categories, never by
      the raw key `targetTemperature`.
- [ ] `ThermostatCard` leads with the core and renders bound extras generically; no `resetAlarm`,
      `stoveState`, `profile`, `fanSpeed` or `ecoMode` branch remains in the card.
- [ ] An existing thermostat bound to the full Panasonic or MCZ surface still shows and controls
      everything it did before: fan speed, nanoe, air swing, profile, eco, reset alarm, stove state,
      pellet sensor, ignition count.
- [ ] Docs updated EN + FR; specs 077, 150, 152 and 176 cross-referenced.
- [ ] No data, plugin, binding or migration change.

## Edge Cases

- A submetered thermostat: the clamp device carries no setpoint, is not offered as compatible, and
  is added through "show all" exactly as today; its `power` data binds through `RELEVANT_DATA`.
  Should the clamp carry a relay order, it binds as an extra and the plan preview shows it.
- An extra order whose alias collides with a core alias cannot happen: the core is resolved first
  and `uniqueAlias` suffixes the second (`power_2`), which is then an extra.
- An extra `boolean` order with a `boolean` data mirror is a toggle; the optimistic value clears
  when the mirror is re-reported, through the existing per-alias mechanism of spec 176.
- An extra order with no enum values and type `enum` renders nothing (no values to offer).
- A thermostat with only the core bound renders no extras section at all.
- A legacy `state` order (bound before the `toggle_power → power` override) is an extra order
  whose mirror is the core `state` reading: it renders as a toggle, never as a one-shot.
- A reading whose same-alias order has no generic control (`text`, `json`) still shows as a chip.
- A device publishing two readings of category `temperature` (a fumes probe and a room probe): the
  first in publication order takes the `temperature` alias, the second is offered as
  `temperature_2`. Neither shipped plugin does this; the plan preview (issue #707) shows it before
  anything is written, and the alias can be swapped there.
- Unknown mode values (a vendor publishing `heating` rather than `heat`) render the raw value
  rather than a translation key, in the mode selector as in the extras.

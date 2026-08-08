# Spec 135 — Water heater equipment type

## Context

Sowel has no equipment type for a **water heater** (chauffe-eau / cumulus /
ballon d'eau chaude). Users currently model one as a bare `switch`, which
loses the identity (icon, label) and offers no place for the water
temperature. A real installation (the reporting user's friend) drives
several water heaters through Zigbee relays (Tuya WHD02) plus, in some
cases, a separate temperature probe (TYZGTH1CH-D1RF).

## Goal

Add a first-class `water_heater` equipment type: **ON/OFF control**, an
**optional water-temperature display**, optional **power/energy** display
when the relay meters it, **automatic binding**, a **custom state-aware
icon**, and full **dashboard support (desktop + mobile)** — consistent
with how `heater` / `switch` are handled.

## Scope

### In scope

- New `EquipmentType`: `"water_heater"`.
- ON/OFF actuation via the standard on/off channel (boolean `light_toggle`
  order or ON/OFF enum — same rule as `switch`, so Zigbee relays work,
  cf. spec that fixed the WHD02 candidate filter).
- Optional **water temperature** display, bound under a distinct alias
  (`water_temperature`) so it is NOT counted in the zone room-temperature
  average (the zone aggregator only aggregates category `temperature` with
  alias exactly `temperature`).
- Optional **power / energy** auto-attached when the relay device exposes
  them (metering water-heater plug), mirroring the metering-switch feature
  (spec 129).
- **Auto-binding**: creating a `water_heater` from a relay device binds
  its on/off (+ metering if present) automatically; the temperature is an
  optional extra binding (often on a separate device).
- **Custom SVG icon** (`WaterHeaterIcon`), state-aware: heating = warm
  (amber/active), off = neutral (primary/grey). Registered in the custom
  icon registry like the light/shutter icons.
- **Dashboard widget** (desktop `EquipmentWidget` + mobile
  `MobileWidgetCard`): on/off toggle, temperature (if bound), power (if
  bound). Zone view card + equipment detail control.
- FR/EN i18n.
- Docs: `docs/user/equipments.{md,fr.md}`,
  `docs/technical/data-model.md`.

### Out of scope

- **Setpoint / target temperature control** — the temperature is
  read-only. A settable setpoint would make this a thermostat variant;
  deferred (few Zigbee water heaters expose it).
- Scheduling / boost / HP-HC-aware heating logic — that is a **recipe**
  concern (a future `water-heater-schedule` recipe can drive the on/off),
  not the equipment type.
- Solar-surplus water-heater optimization — future recipe, out of the
  equipment scope.
- No new DataCategory is introduced: reuse `light_state` (on/off),
  `temperature` (probe, aliased `water_temperature`), `power`, `energy`.

## Data model

No SQLite migration, no new event, no new API route. `water_heater` is a
new value of the existing `EquipmentType` union and the runtime
`VALID_EQUIPMENT_TYPES` set. All plumbing (bindings, orders, WS, zone) is
already type-agnostic.

## Acceptance criteria

- [x] AC1 — `water_heater` is a creatable equipment type (form, API,
      persisted, restored).
- [x] AC2 — Creating one from a Zigbee relay (boolean `state`
      light_toggle) auto-binds the on/off channel; the device appears in
      the picker (candidate-based, `isOnOffOrder`).
- [x] AC3 — If the relay device also exposes power/energy, they are
      auto-attached (single-channel only, like the metering switch).
- [x] AC4 — A temperature reading can be bound (optionally, possibly from
      another device) under alias `water_temperature`; it is displayed on
      the widget/card and **excluded** from the zone temperature average.
- [x] AC5 — ON/OFF works from the desktop widget, the mobile widget, the
      zone card and the detail page.
- [x] AC6 — A custom state-aware icon renders on all cards (heating vs
      off visually distinct), desktop and mobile.
- [x] AC7 — No regression on existing types (heater/switch unchanged).

## Edge cases

| Case                                          | Expected                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Relay device only (no temp probe)             | on/off works, no temperature shown                                                |
| Temperature bound but relay offline           | equipment degraded/offline per spec 116, temp still shown if its device is online |
| Metering absent on the relay                  | no power/energy shown, no error                                                   |
| Temperature value null / non-number           | temperature hidden                                                                |
| Water temp bound as alias `water_temperature` | NOT added to zone temperature average                                             |
| Multi-gang relay used                         | one on/off candidate per channel (existing logic)                                 |

# Spec 125 — Solar Panel equipment + APsystems integration

## Context

APsystems micro-inverters (DS3, YC600, QS1) drive residential PV panels and talk a
proprietary Zigbee protocol to their gateway (ECU). The companion firmware project
**ESP32-ECU** (ESP32 + CC2530) reverse-engineers that link and republishes each
inverter's telemetry over MQTT, fully local (no cloud, no EMA account). See its
`docs/mqtt-api.md` for the wire contract.

Sowel has no first-class notion of PV production at the panel level today. The only
production-aware construct is the `energy_production_meter` equipment type, which
feeds self-consumption accounting but represents a single aggregate meter, not the
individual panels a user actually reasons about ("le panneau du toit sud").

This spec introduces, in two coordinated parts:

1. **Sowel core** — a new `solar_panel` ("Panneau Photovoltaïque") equipment type, plus
   a new generic `temperature_device` data category. One equipment = one physical PV
   panel = one inverter channel.
2. **Plugin** — `sowel-plugin-apsystems`, a read-only MQTT integration that consumes
   the ESP32-ECU telemetry, discovering one device per micro-inverter.

## Goals

1. A user can create a **Solar Panel** equipment in Sowel and bind it to a single PV
   panel (one inverter channel), seeing its live DC power (W), cumulative energy
   (Wh/kWh), DC voltage (V), DC current (A) and the inverter temperature.
2. On the zone dashboard, each Solar Panel shows its **produced power (W)** and its
   **online/offline** status at a glance (compact card), with a detailed view on click.
3. The `sowel-plugin-apsystems` plugin auto-discovers one **device per micro-inverter**
   and pushes per-channel data, with truthful online/offline status.
4. A multi-channel inverter (DS3 = 2 panels) yields **two** Solar Panel equipments from
   a single device, both showing the shared inverter temperature.

## Non-Goals

- **No multi-inverter production aggregation** into the energy dashboard /
  self-consumption (`self-consumption-writer` unchanged). Explicitly out of scope.
- **No power control / throttle** (per-inverter, incoherent with a per-panel equipment;
  firmware MQTT command path not shipped). Deferred.
- No zone-level aggregation of solar power/energy (consistent with current Sowel:
  `power`/`energy` are not zone-aggregated), and **no new `WidgetFamily`** — solar
  panels follow the `energy_meter` precedent (individual equipment card, no family
  grouping widget).
- No Home Assistant discovery, no bespoke "solar dashboard" page.

## Functional Requirements

### FR1 — `solar_panel` equipment type (Sowel core)

A new `EquipmentType` value `"solar_panel"`, display name **Solar Panel** (EN) /
**Panneau Photovoltaïque** (FR), Lucide icon `Sun`. Read-only (no orders). Like the
energy meter types, it has **no `WidgetFamily`**: it is surfaced as an individual
equipment card on the dashboard, not as a family-grouped zone widget.

### FR2 — `temperature_device` data category (Sowel core)

A new generic `DataCategory` `"temperature_device"` — the internal temperature of a
device (inverter, chip, motor…), alongside `temperature` and `temperature_outdoor`.
Distinct from `temperature` so it is **never** folded into a zone's room-temperature
average. Modelled on `temperature_outdoor`:

- Streaming category (spec 116) with a 15-min freshness window.
- Historized by default with a 0.2 °C deadband.
- UI label "Inverter temperature" / "Température onduleur" (generic device-temp label;
  the inverter context comes from the binding's device name).
- The existing Zigbee2MQTT `device_temperature` → `temperature` mapping is left
  **unchanged** (no behavior change on existing installs). `temperature_device` is used
  only by the APsystems plugin for now.

### FR3 — Device-data contract (interface between plugin and core)

A "solar panel" device (produced by `sowel-plugin-apsystems`, reusable by any future PV
plugin) exposes these data points per micro-inverter. `sourceDeviceId` is the inverter
serial (stable id).

| key             | type   | category             | unit | level    |
| --------------- | ------ | -------------------- | ---- | -------- |
| `power`         | number | `power`              | W    | inverter |
| `energy`        | number | `energy`             | Wh   | inverter |
| `ac_voltage`    | number | `voltage`            | V    | inverter |
| `frequency`     | number | `generic`            | Hz   | inverter |
| `inverter_temp` | number | `temperature_device` | C    | inverter |
| `signal`        | number | `rssi`               | %    | inverter |
| `ch<N>_voltage` | number | `voltage`            | V    | panel N  |
| `ch<N>_current` | number | `current`            | A    | panel N  |
| `ch<N>_power`   | number | `power`              | W    | panel N  |
| `ch<N>_energy`  | number | `energy`             | Wh   | panel N  |

### FR4 — Per-channel binding candidates

When binding a `solar_panel` equipment to an inverter device, Sowel offers **one
candidate per inverter channel** (detected by the `ch<N>_` key prefix). Each candidate
groups that channel's four metrics **plus the shared `inverter_temp`** so both panels of
a DS3 display the same inverter temperature (allowed: `data_bindings` is unique on
`(equipment_id, alias)`, not on `device_data_id`).

- Device with `ch1_*` + `ch2_*` → 2 candidates ("Panel 1", "Panel 2"), each =
  `{ch<N>_voltage, ch<N>_current, ch<N>_power, ch<N>_energy, inverter_temp}`.
- Device with only `ch1_*` → 1 candidate.
- Device with no `ch<N>_*` keys → `[]`.

Inverter-level `power`/`energy`/`ac_voltage`/`frequency`/`signal` stay on the device,
unbound (available to a future inverter-health sensor).

### FR5 — Equipment cards (compact + detailed)

- **Compact card** (zone dashboard, dedicated `SolarPanelEquipmentWidget`, modelled on
  `EnergyMeterEquipmentWidget`): `Sun` icon, **produced power** as the headline value
  (W, or kW above 1000), and the **online/offline** state via the existing
  `EquipmentStatusBadge`.
- **Detailed view** (equipment detail page + widget detail sheet): all bound metrics
  (panel power, energy, voltage, current, inverter temperature) listed with values,
  units and the status badge. Read-only — no order controls.

### FR6 — `sowel-plugin-apsystems` discovery & data (plugin)

Subscribes to `tele/<root>/SENSOR` and `tele/<root>/LWT` (root configurable, default
`esp32ecu`). On each retained `SENSOR` message (one JSON object keyed by inverter
serial):

- For every serial present: `upsertFromDiscovery` (idempotent) with the FR3 capability
  set actually present, `updateDeviceData` with the values, and
  `updateDeviceStatus(serial, "online")`.
- For every serial seen previously but **absent** from this message:
  `updateDeviceStatus(serial, "offline")`.

`Name` (optional) is informational only; device identity is the serial.

### FR7 — Bridge & inverter availability

- `tele/<root>/LWT` = `Online` → integration `connected`.
- `tele/<root>/LWT` = `Offline` → integration `disconnected`, all known inverter
  devices marked `offline`.
- Per-inverter `offline` driven by absence from `SENSOR`. Correct at night: DS3 are
  panel-powered, drop out after dark, and the panel cards read `offline` until sunrise
  (intended, not a fault).

### FR8 — Plugin settings

`mqtt_url` (required), `mqtt_username`, `mqtt_password`, `mqtt_client_id` (default
`sowel-apsystems`), `base_topic` (default `esp32ecu`). Same pattern as
`sowel-plugin-tasmota`.

## Acceptance Criteria

### Core (Sowel repo)

- [x] `solar_panel` is a valid `EquipmentType`; `temperature_device` is a valid
      `DataCategory`; backend + UI type mirrors compile.
- [x] Creating a Solar Panel equipment is possible from the UI (type in the picker with
      `Sun` icon, localized label EN/FR).
- [x] Binding to a device exposing `ch1_*`/`ch2_*` offers two candidates ("Panel 1",
      "Panel 2"); each includes the 4 channel metrics + `inverter_temp`.
- [x] The compact zone card shows produced power (W/kW) + online/offline badge.
- [x] The detailed view lists power/energy/voltage/current/inverter-temperature.
- [x] Binding a Solar Panel does NOT change the zone temperature/humidity averages.
- [x] `temperature_device` is streaming (15 min), historized by default (0.2 deadband),
      and has an EN/FR category label.

### Plugin (sowel-plugin-apsystems repo)

- [ ] A `SENSOR` payload with two serials discovers two devices with the FR3 data
      points present in the payload; values + categories match.
- [ ] A serial that disappears from `SENSOR` flips that device `offline`; an `LWT`
      `Offline` flips all `offline` and the integration `disconnected`.
- [ ] `base_topic` default `esp32ecu`; changing it re-roots the subscriptions.
- [ ] Pure parser unit-tested: 1-inverter, 2-inverter, missing-channel, `Name`-present,
      malformed-JSON.

## Edge Cases

- **Malformed / non-object SENSOR payload** → `warn`, ignored, no crash.
- **Single connected panel** (only `Ch1*`) → one data set with `ch1_*` only → one
  candidate.
- **Retained SENSOR on (re)connect** → late subscriber discovers immediately;
  idempotent upsert avoids duplicates.
- **Night / all inverters silent** → every known device `offline`; cards read offline;
  no flapping (firmware 20-miss hysteresis, spec 016, before a serial leaves).
- **Same `inverter_temp` bound to both panels** → allowed (unique is `(equipment_id,
alias)`); each panel keeps alias `inverter_temp`.
- **`Name` changes in firmware** → serial-based identity unchanged; no device
  re-creation.

# Spec 083 — Pool Heat Pump Plugin (Polytropic Master Inverter)

## Goal

Add a new integration plugin `polytropic_master` that talks Modbus RTU (over TCP via a Waveshare gateway) to a Polytropic Master Inverter pool heat pump. Expose its readings (water temperature, outdoor temperature, mode, setpoint) as a Sowel device, and create a new equipment type `pool_heat_pump` that surfaces them in the UI through the existing thermostat widget.

## Why

- The pool heat pump has no native cloud or Wi-Fi integration — only Modbus.
- Sowel does not yet have a Modbus capability; this plugin is the first.
- The user wants visibility on water/outdoor temperature and the ability to neutralise the heat pump (lower the setpoint) without leaving the Sowel UI.
- Mode write is intentionally NOT supported — only the setpoint is writable. The pump cannot be cleanly stopped via Modbus other than by lowering the setpoint well below the current water temperature.

## Scope (in)

- New plugin repo `mchacher/sowel-plugin-polytropic-master` distributed via the official registry.
- Modbus RTU over TCP client targeting a Waveshare gateway (default `192.168.0.242:4196`, slave 17).
- Single device per plugin instance.
- Polling interval configurable in UI (default 60s). Immediate re-poll after a successful write.
- 4 read DataCategories on the device:
  - `pool_water_temperature` (new) — register 512, ×10 °C
  - `temperature_outdoor` (existing) — register 515, ×10 °C
  - `appliance_state` (existing, used for mode enum: OFF / SMART / BOOST / ECO) — register 1000
  - `pool_temperature_setpoint` (new) — register 1001, ×10 °C
- 1 writable order on the device:
  - `set_pool_temperature_setpoint` (new) — register 1001, °C in [10, 30], step 0.5
- New `EquipmentType: "pool_heat_pump"` modelled on `thermostat`. Reuses the existing thermostat widget by exposing the same aliases:
  - `temperature` (alias) → bound to PAC `water_temperature`, but consumed via a computed `effective_water_temperature` (see below)
  - `setpoint` (alias) → bound to PAC `setpoint`
  - `mode` (alias) → bound to PAC `mode` (read-only display)
  - `filtration_state` (alias, optional) → bound to any boolean/ON-OFF data on a third-party device (typically the Sonoff 4CH PRO relay driving the filtration pump). Used by the computed engine, see below.
- **Computed `effective_water_temperature`** (derived from the equipment's own bindings, no cross-equipment reference):
  - If `filtration_state` is bound and ON → expose the live `water_temperature`.
  - If `filtration_state` is bound and OFF → expose the **last value seen while it was ON**, until 24h have elapsed since that last "active" sample. After 24h → `null`.
  - If `filtration_state` is **not bound** (fallback) → expose live `water_temperature` if `mode != OFF`, otherwise expose the last value while `mode != OFF`, also subject to the 24h cap.
- UI:
  - Equipment creation in the existing equipment form, type "pool_heat_pump".
  - Detail page: same layout as thermostat.
  - Dashboard widget: same widget as thermostat (`ThermostatEquipmentWidget`).
  - Translations en/fr.
- Tests:
  - Unit tests for the Modbus parser (decode/encode ×10 scaling, mode enum mapping).
  - Unit tests for the freshness/gating logic of `effective_water_temperature` (live, frozen, 24h expiry, fallback path).

## Scope (out)

- Multiple PAC instances per plugin (V1 = single device).
- Mode write (reg 1000 stays read-only).
- Direct compressor / flow status registers (not in the user's mapping).
- Schedule recipe for the pool heat pump (out of this spec; a recipe could be added later, similar to spec 082).
- Auto-detection of which Sonoff channel drives the filtration — the user wires it manually via the `filtration_state` binding.

## User stories

- As a user, I install the `polytropic_master` plugin from the Sowel plugin store and configure host/port/slave/polling.
- As a user, I create a `pool_heat_pump` equipment, bind it to the discovered Modbus device, and optionally bind `filtration_state` to my Sonoff 4CH PRO relay.
- As a user, I see water temperature on my dashboard widget. When the filtration is off, the value freezes (and is marked as not live) and disappears after 24h of continuous off.
- As a user, I can lower the setpoint to 10°C from the widget to neutralise the heat pump.
- As a user, when the Modbus gateway is offline, the device status flips to `offline` and the integration shows an error in the integrations page.

## Acceptance criteria

- [ ] Plugin appears in `plugins/registry.json` with `id: "polytropic_master"`, type `integration`.
- [ ] Plugin can be installed, configured (host, port, slaveId, pollIntervalSec), started, stopped from the UI.
- [ ] On start, the plugin discovers exactly one device with the four data points and one order listed above.
- [ ] Polling reads the four registers; values are decoded with the correct ×10 scaling.
- [ ] Mode register decodes to one of `OFF`, `SMART`, `BOOST`, `ECO`; unknown values fall back to the raw integer string with a `warn` log.
- [ ] Writing the setpoint via Sowel sends a Modbus write to register 1001 with value × 10, then triggers an immediate poll within 1s.
- [ ] Setpoint slider in UI is constrained to `[10, 30]` °C with step 0.5.
- [ ] If the Modbus gateway is unreachable for one poll cycle the plugin retries once; after consecutive failures (3 cycles) the device flips to `offline` and the integration is marked errored.
- [ ] Equipment type `pool_heat_pump` is selectable in the equipment creation form.
- [ ] The dashboard `ThermostatEquipmentWidget` renders correctly for `pool_heat_pump` and shows the `effective_water_temperature`, setpoint, and mode badge.
- [ ] Computed `effective_water_temperature` follows the rules in the Scope section, validated by unit tests:
  - filtration ON → live water temp
  - filtration OFF, last active sample < 24h → frozen value
  - filtration OFF, last active sample ≥ 24h → `null`
  - filtration not bound, mode ≠ OFF → live water temp
  - filtration not bound, mode = OFF, last active < 24h → frozen
  - filtration not bound, mode = OFF, last active ≥ 24h → `null`
- [ ] Translations en/fr added for `pool_heat_pump` equipment type and any new UI strings.
- [ ] Documentation updated (`docs/user/equipments.md`, `docs/technical/data-model.md`, `docs/technical/architecture.md`).

## Edge cases

- Modbus gateway unreachable on plugin start → plugin retries with exponential backoff (max 60s), logs a warn.
- Setpoint write fails → plugin logs error, does not update the local cache; the UI eventually reflects the discrepancy at next poll.
- Mode register returns unmapped value → log warn, expose raw integer as enum value.
- `filtration_state` binding is removed at runtime → fallback to mode-based gating with no data loss (last known active sample remains valid for the 24h window).
- 24h timer baseline: starts from the last sample where the gating predicate was true (filtration ON, or mode != OFF). Plugin restart preserves the baseline by persisting it in the equipment computed state (reuses existing computed-engine persistence).

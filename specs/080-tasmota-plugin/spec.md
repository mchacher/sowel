# Spec 080 — Tasmota Plugin Integration

## Summary

New integration plugin `sowel-plugin-tasmota` that auto-discovers Tasmota-flashed devices on the local MQTT broker and exposes their relays and shutters to Sowel. Distributed as a separate GitHub repo and registered in Sowel's plugin registry.

## Why

- User has Sonoff 4CH Pro + Sonoff Mini flashed with Tasmota firmware
- Tasmota is a widely used open firmware for Sonoff/ESP devices
- Devices publish on the local MQTT broker (Mosquitto on sowelox) already used by Sowel
- No need to run additional bridges like zigbee2mqtt or Home Assistant

## Requirements

### R1 — Auto-discovery via LWT

The plugin discovers Tasmota devices by subscribing to `tasmota/tele/+/LWT`. When a device publishes `Online`, the plugin interrogates it with `STATUS 0` and `STATUS 11` commands to learn its capabilities.

### R2 — Supported capabilities (MVP)

- **Relays** (`POWER1..POWERn`) — exposed as on/off data + order
- **Shutters** (`Shutter1..Shuttern`) — exposed as position (0-100%) + open/close/stop order
- **LWT** (Last Will Testament) — drives device `online`/`offline` status

Not in scope (future): sensors (temperature, humidity), energy metering, dimmers, RGB, DS18B20, button events.

### R3 — Relay typing is generic

All Tasmota relays are exposed as generic on/off switches. The user binds them to whatever equipment type suits their use (pompe → switch, spot → light_onoff, radiateur → heater). No magic inference from friendly names.

### R4 — Shutter absorbs its physical relays

When a device has a shutter configured, Tasmota internally consumes 2 relays for open/close. The plugin must NOT expose those underlying relays as switches — only the shutter abstraction.

### R5 — Commands

The plugin executes orders by publishing to `tasmota/cmnd/<device>/<command>`:

- Relay ON/OFF → `POWERn` with `ON`/`OFF`
- Shutter position → `ShutterPositionn` with 0-100
- Shutter move → `ShutterOpenn` / `ShutterClosen` / `ShutterStopn` (empty payload)

### R6 — Plugin settings

- `mqtt_url` (required) — broker URL (default: `mqtt://localhost:1883`)
- `mqtt_username` / `mqtt_password` (optional)
- `mqtt_client_id` (optional, default: `sowel-tasmota`)
- `base_topic` (optional, default: `tasmota`)

### R7 — Registry entry

The plugin is referenced in `plugins/registry.json` so it can be installed from the UI.

## Acceptance Criteria

- [x] AC1: Plugin repo `sowel-plugin-tasmota` created with `createPlugin(deps)` export
- [x] AC2: Plugin subscribes to `<base_topic>/tele/+/LWT` on startup
- [x] AC3: On `LWT=Online`, plugin sends `STATUS 0` and `STATUS 11` and parses response
- [x] AC4: Device is upserted via `deviceManager.upsertFromDiscovery` with relays + shutters
- [x] AC5: On `LWT=Offline`, device status is set to `offline`
- [x] AC6: Relay state updates from `tele/<device>/STATE` reach `device.data.updated`
- [x] AC7: Shutter position updates reach `device.data.updated`
- [x] AC8: Order `POWERn ON` publishes correct MQTT command
- [x] AC9: Order `ShutterPositionn X` publishes correct MQTT command
- [x] AC10: Shutter's internal relays (e.g. POWER1+POWER2 when `ShutterRelay1=1,2`) are NOT exposed as switches
- [x] AC11: Registry entry points to plugin version 1.0.0
- [ ] AC12: Plugin installable via Sowel UI (pending manual test)

## Scope

### In scope

- GitHub repo `sowel-plugin-tasmota` (new)
- Plugin implementation with `IntegrationPlugin` interface (apiVersion 2)
- MQTT discovery + parsing + command dispatch
- Registry update in main Sowel repo
- Unit tests for the parser (mock MQTT messages)

### Out of scope

- Sensors (temperature, humidity, luminosity)
- Energy metering
- Dimmers / RGB lights
- Button / switch events (physical button press → Sowel action)
- Manual device declaration (only auto-discovery)
- Home Assistant auto-discovery mode (`SetOption19`)
- UI changes in Sowel (plugin config is generic, driven by manifest `settings`)

## Edge Cases

- **Device offline at startup** — LWT retained, so plugin still gets `Offline`. Device status = `offline`, no discovery.
- **Device appears for the first time** — No LWT retained. Plugin must send `STATUS 0` when seeing the first `tele/<device>/STATE` to catch devices it missed at start.
- **Device firmware changes (new relays added)** — `STATUS 0` response differs. `upsertFromDiscovery` updates the device data/orders.
- **Duplicate discovery** — If Sowel restarts and LWT is still retained, same device is re-upserted. `upsertFromDiscovery` handles this idempotently.
- **No shutter configured** — device has only relays. All POWERs exposed.
- **Shutter uses non-contiguous relays** — rare; respect whatever `ShutterRelay1` reports.

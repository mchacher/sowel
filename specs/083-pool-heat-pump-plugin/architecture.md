# Architecture — Spec 083 Pool Heat Pump Plugin

## Components touched

| Layer           | Component                                                                                        | Type of change                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sowel core      | `src/shared/types.ts`                                                                            | New `EquipmentType: "pool_heat_pump"`; new `DataCategory` values `pool_water_temperature`, `pool_temperature_setpoint`; new `OrderCategory: "set_pool_temperature_setpoint"` |
| Sowel core      | `src/shared/constants.ts`                                                                        | Add `pool_heat_pump` to `WIDGET_FAMILY_TYPES` (thermostat family) and any equipment-type registries                                                                          |
| Sowel core      | `src/equipments/binding-candidates.ts`                                                           | Recognise `pool_heat_pump` in `inferBindingCategory`, `computeBindingCandidates`, etc.                                                                                       |
| Sowel core      | `src/equipments/equipment-manager.ts` and computed engine                                        | Register a new computed-data evaluator `effective_water_temperature` for `pool_heat_pump` equipments                                                                         |
| Sowel UI        | `ui/src/components/equipments/*`                                                                 | Allow creating a `pool_heat_pump` equipment, propose `filtration_state` as an optional alias                                                                                 |
| Sowel UI        | `ui/src/components/dashboard/widget-icons.ts` and `EquipmentWidget.tsx` / `MobileWidgetCard.tsx` | Map `pool_heat_pump` to the existing `ThermostatEquipmentWidget` (no new widget code)                                                                                        |
| Sowel UI        | `ui/src/i18n/locales/{en,fr}.json`                                                               | Translations                                                                                                                                                                 |
| Plugin registry | `plugins/registry.json`                                                                          | Add `polytropic_master` entry                                                                                                                                                |
| Plugin repo     | `mchacher/sowel-plugin-polytropic-master` (new repo)                                             | Full plugin implementation                                                                                                                                                   |
| Docs            | `docs/user/equipments.md`, `docs/technical/data-model.md`, `docs/technical/architecture.md`      | Document the new equipment type and the Modbus integration model                                                                                                             |

## Data model changes

### `src/shared/types.ts`

```ts
export type DataCategory =
  | ...
  | "pool_water_temperature"        // NEW
  | "pool_temperature_setpoint"     // NEW
  | ...;

export type OrderCategory =
  | ...
  | "set_pool_temperature_setpoint" // NEW
  | ...;

export type EquipmentType =
  | ...
  | "pool_heat_pump"                // NEW
  | ...;
```

No DB migration required — `EquipmentType` and category strings are stored as text in SQLite.

### Equipment aliases convention

| Alias              | Bound to (typical)                                                                      | Required | Read/Write |
| ------------------ | --------------------------------------------------------------------------------------- | -------- | ---------- |
| `temperature`      | PAC device, `water_temperature` data                                                    | yes      | R          |
| `setpoint`         | PAC device, `setpoint` data + setpoint order                                            | yes      | R/W        |
| `mode`             | PAC device, `mode` data                                                                 | yes      | R          |
| `filtration_state` | Any third-party device exposing an enum/boolean indicating that water circulation is on | no       | R          |

The thermostat widget reads aliases `temperature`, `setpoint`, `mode` — those names are deliberately reused so the same widget renders without per-type branching.

## Computed `effective_water_temperature`

Lives in the equipment computed-data engine (`src/equipments/computed-engine.ts` or equivalent). Pseudo-code:

```ts
function evaluate(equipment, bindings, internalState) {
  const water = bindings["temperature"]?.value; // alias
  const filt = bindings["filtration_state"]?.value; // optional alias
  const mode = bindings["mode"]?.value;
  const now = Date.now();

  const isActive =
    filt !== undefined
      ? Boolean(filt === "ON" || filt === true)
      : mode !== "OFF" && mode !== undefined;

  if (isActive) {
    // sample is fresh
    internalState.lastActiveTs = now;
    internalState.lastActiveValue = water;
    return water;
  }

  // not active — return last active sample if within 24h
  if (internalState.lastActiveTs && now - internalState.lastActiveTs < 24 * 3600 * 1000) {
    return internalState.lastActiveValue;
  }
  return null;
}
```

`internalState` is persisted via the computed-engine's existing memo store (one per equipment).

## Modbus plugin design (`sowel-plugin-polytropic-master`)

### Project layout

```
sowel-plugin-polytropic-master/
├── manifest.json
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts            # createPlugin entry
    ├── modbus-client.ts    # Modbus RTU-over-TCP wrapper around `modbus-serial`
    ├── modbus-client.test.ts
    ├── polytropic-plugin.ts# Main plugin class (start/stop/poll/executeOrder)
    └── registers.ts        # Register definitions, scaling, enum mapping
```

### Dependencies

- `modbus-serial` (npm) — supports RTU-over-TCP via `connectRTUBuffered({ host, port })` then `setID(slaveId)`.
- Pino logger child injected by Sowel via `createPlugin({ logger })`.

### Plugin lifecycle

1. **createPlugin(deps)** returns an `IntegrationPlugin` per `src/shared/plugin-api.ts`.
2. **start()** :
   - Read settings (host, port, slaveId, pollIntervalSec) — defaults `192.168.0.242 / 4196 / 17 / 60`.
   - Connect Modbus client. On connection error, log warn, schedule retry with exponential backoff up to 60s.
   - Discover the single device:
     - sourceDeviceId = `polytropic_master_<slave>`.
     - Manufacturer `Polytropic`, model `Master Inverter`.
     - 4 data points + 1 order as per the spec.
   - Start poll timer.
3. **poll()** (every `pollIntervalSec`):
   - Read holding registers in two reads: `[512, 515]` for temps, `[1000, 1001]` for mode/setpoint.
   - Decode water/outdoor temps as signed 16-bit ÷ 10.
   - Decode setpoint as signed 16-bit ÷ 10.
   - Decode mode as enum: `0→OFF`, `21→SMART`, `22→BOOST`, `23→ECO`. Unknown values logged as warn and forwarded as `RAW_<n>`.
   - Push values to Sowel via `deviceManager.updateDeviceData()`.
   - On read failure, increment `consecutiveFailures` counter. After 3 consecutive failures, mark device offline and integration errored. On the next success, mark online again.
4. **executeOrder(device, orderKey, value)** :
   - Only `setpoint` is writable. Compute Modbus write value = round(value × 10).
   - `client.writeRegister(1001, value)`. On success, log info and trigger an immediate `poll()` (re-poll mechanism).
   - On error, log error, do not update local cache.
5. **stop()** :
   - Clear poll timer, close Modbus connection.

### Settings schema (UI)

| Key                 | Type   | Default         | Required |
| ------------------- | ------ | --------------- | -------- |
| `host`              | text   | `192.168.0.242` | yes      |
| `port`              | number | `4196`          | yes      |
| `slave_id`          | number | `17`            | yes      |
| `poll_interval_sec` | number | `60`            | yes      |

### Manifest

```json
{
  "id": "polytropic_master",
  "type": "integration",
  "name": "Polytropic Master Inverter",
  "description": "Pool heat pump (Polytropic Master Inverter) over Modbus RTU/TCP via a Waveshare gateway",
  "icon": "Waves",
  "author": "mchacher",
  "repo": "mchacher/sowel-plugin-polytropic-master",
  "version": "1.0.0",
  "tags": ["pool", "heat-pump", "modbus"]
}
```

## Event flow

```
poll tick ──► modbus read 4 regs ──► decode
                                     ├─► deviceManager.updateDeviceData(water_temperature)
                                     ├─► deviceManager.updateDeviceData(outdoor_temperature)
                                     ├─► deviceManager.updateDeviceData(mode)
                                     └─► deviceManager.updateDeviceData(setpoint)
                                            │
                                            ▼
                                     EventBus device.data.updated
                                            │
                                            ▼
                                     EquipmentManager re-evaluates
                                            ├─► alias temperature (raw water)
                                            ├─► alias setpoint
                                            ├─► alias mode
                                            ├─► alias filtration_state (from other device)
                                            └─► computed effective_water_temperature
                                                     │
                                                     ▼
                                            EventBus equipment.data.changed
                                                     │
                                                     ▼
                                            ThermostatEquipmentWidget re-renders
```

## Error handling

- All Modbus reads/writes wrapped in try/catch with structured pino logs (`{ err, host, slaveId, register }`).
- No throw escapes the plugin handlers (Sowel rule).
- Connection lifecycle: single persistent TCP socket; on close, schedule reconnect with backoff.

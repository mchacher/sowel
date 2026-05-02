# Spec 086 — Architecture

## Data flow

```
Shelly Pro 3EM
  └── MQTT topic shelly/<id>/status/em1data:N      (cumulative, ~1/min)
       │  total_act_energy        (Wh forward, monotonic)
       │  total_act_ret_energy    (Wh reverse, monotonic)
       │
       ▼
sowel-plugin-shelly-mqtt v1.1.0
  ├── parseEm1DataStatus → { energy_forward, energy_reverse }
  ├── ENERGY-DELTA SYNTHESISER  (NEW)
  │     last_fwd, last_rev   (loaded from device_data SQLite at start)
  │     delta_fwd = current_fwd − last_fwd     (or 0 if < 0)
  │     delta_rev = current_rev − last_rev     (or 0 if < 0)
  │     energy   = delta_fwd − delta_rev       (signed, Wh)
  │     persist current_fwd / current_rev as new baseline
  └── deviceManager.updateDeviceData(integrationId, sourceDeviceId, {
        energy_forward, energy_reverse, energy
      })
       │
       ▼
DeviceManager (unchanged)
  └── persists key/value to SQLite device_data table
       │
       ▼
EquipmentManager (unchanged)
  └── propagates value through bindings
       │
       ▼
Event Bus: equipment.data.changed { alias: "energy", category: "energy", value: Δ }
       │   ┌──────────────┬──────────────────────────────┐
       │   ▼              ▼                              ▼
       │  HistoryWriter   EnergyAggregator              WebSocket → UI
       │  └─ writes raw   └─ debounced refresh
       │     point +         from InfluxDB:
       │     HP/HC split     hour / day / month / year
       │
       ▼
InfluxDB sowel + sowel-energy-hourly + sowel-energy-daily
```

## Key design decisions

### Plugin synthesises `energy` (not the aggregator)

The aggregator is generic and currently triggers on `alias === "energy"`
([energy-aggregator.ts:77](src/energy/energy-aggregator.ts#L77)). Keeping
this trigger means **zero changes to the aggregator** — the smallest
surface area for a behaviour-preserving change.

The plugin is the right place to synthesise `energy` because it is the
only component that knows the cadence at which forward/reverse counters
arrive (1/min via `em1data:N` notifications). It can compute deltas
between two consecutive readings of the same channel deterministically.

### Baseline persistence via existing `device_data` table

Sowel already persists the latest known value for every device data key
into SQLite. The plugin re-uses this on start:

```ts
const lastFwd = deviceManager.getDeviceDataValue(integrationId, sourceDeviceId, "energy_forward");
const lastRev = deviceManager.getDeviceDataValue(integrationId, sourceDeviceId, "energy_reverse");
```

No new file, no new schema, no new migration.

### Reset detection

A monotonic counter that goes backwards means one of:

- Shelly factory reset (rare, manual user action)
- Out-of-order MQTT delivery within QoS 0 (rare, single VM)
- Counter rollover (extremely rare, takes years at Wh granularity)

In all three cases, emitting a negative delta would corrupt every
downstream cumul. The plugin treats `current < last` as
`delta = 0` and refreshes the baseline to `current`. The lost interval
between `last` and the rollover is accepted — the alternative would
introduce false-positive rollback paths.

### `energy_forward` and `energy_reverse` stay raw cumulative

These two aliases continue to carry the **cumulative** Shelly counters
(monotonic), as today. They remain useful for:

- The Live page (no consumption — Live uses `power`).
- Future scenarios that need to know absolute milestones (e.g., "alert
  when monthly imports cross 200 kWh").
- The forthcoming `energydata-stack` (spec 087) — Telegraf will read the
  same MQTT topics and store the same raw counters in its own Influx,
  independently.

## File changes

### Sowel core — small public API addition

The plugin needs to read the last persisted value of a device data key
to hydrate its baseline at start. The existing `DeviceManager` only
exposes setters to plugins; a small public getter is added.

| File                                 | Change                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/devices/device-manager.ts`      | Expose a public method `getDeviceDataValue(integrationId, sourceDeviceId, key): string \| number \| boolean \| null`. Internally re-uses the existing `findDeviceDataByDeviceAndKey` statement. |
| `src/devices/device-manager.test.ts` | Add coverage for the getter (returns `null` for unknown device or unknown key, returns the typed value otherwise).                                                                              |
| `plugins/registry.json`              | Bump `shelly_mqtt` entry to 1.1.0.                                                                                                                                                              |
| `specs/086-…/spec.md`, `plan.md`     | Mark acceptance criteria + tasks as done at the end.                                                                                                                                            |

The change is purely additive (no signature change to existing methods),
so existing plugins keep compiling. A Sowel patch release is needed
nonetheless because the plugin's TS will reference the new symbol.

### `sowel-plugin-shelly-mqtt` (separate repo)

| File                            | Change                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/shelly-plugin.ts`          | Extend the local `DeviceManager` interface to include the new `getDeviceDataValue` method.                          |
| `src/shelly-plugin.ts`          | Add private map `lastCumul: Map<sid, { fwd?: number; rev?: number }>`.                                              |
| `src/shelly-plugin.ts`          | On `start()`, hydrate `lastCumul` from `device_data` for each known channel via `getDeviceDataValue`.               |
| `src/shelly-plugin.ts`          | Update `handleEm1DataStatus`: compute deltas, synthesise `energy`, refresh baseline.                                |
| `src/shelly-parser.test.ts`     | Already covers `parseEm1DataStatus`; add new tests for the synthesiser logic.                                       |
| `src/shelly-plugin.test.ts`     | New file: ESM mock of DeviceManager, exercise restart / reset / first-event flows.                                  |
| `manifest.json`, `package.json` | Bump version 1.0.0 → 1.1.0; bump `manifest.json` `sowelVersion` to `>=1.5.1` (the version that exposes the getter). |

### Equipment bindings (operational, not code)

After the plugin is updated, the user adds `energy_forward`,
`energy_reverse`, `energy` aliases to `Shelly Grid` and `Shelly Solar`
via the Sowel UI (Equipment edit). No DB migration: bindings are stored
per-equipment in SQLite already.

## Event flow (concrete example)

Time `t` (em1data:0 received from Shelly):

```
total_act_energy      = 6105.7 Wh
total_act_ret_energy  = 4690.3 Wh
```

State before:

```
last_fwd = 6100.2
last_rev = 4685.4
```

Plugin computes:

```
delta_fwd = 5.5
delta_rev = 4.9
energy    = 0.6 (signed Wh, 0.6 Wh net imported in the last minute)
```

Plugin emits:

```
deviceManager.updateDeviceData(integrationId, "shelly-pro3em_00-em0", {
  energy_forward: 6105.7,
  energy_reverse: 4690.3,
  energy:         0.6,
});
```

State after (persisted via DeviceManager → SQLite):

```
last_fwd = 6105.7
last_rev = 4690.3
```

Equipment Manager fires `equipment.data.changed` for the `energy`
binding on Shelly Grid → HistoryWriter writes the 0.6 Wh delta to Influx

- HP/HC classification → EnergyAggregator schedules a debounced refresh
  → Consumption page sees the new hour / day total via WebSocket.

## What does NOT change

- `EnergyAggregator` code: untouched.
- `HistoryWriter` code: untouched.
- `TariffClassifier`: untouched.
- Influx schema (measurements, tags, fields): untouched.
- Energy REST API + WebSocket payloads: untouched.
- Energy UI pages: untouched.

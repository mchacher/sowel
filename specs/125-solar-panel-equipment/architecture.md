# Architecture — Spec 125 (Solar Panel + APsystems)

## System flow

```
APsystems DS3/YC600/QS1  --Zigbee-->  ESP32 + CC2530 (ESP32-ECU firmware)
                                          |
                                  MQTT (local broker)
                                          |
                tele/<root>/SENSOR  (retained JSON, keyed by serial)
                tele/<root>/LWT     (retained Online/Offline + will)
                                          |
                                          v
        sowel-plugin-apsystems  (subscribes, parses, presence-tracks)
                                          |
            deviceManager.upsertFromDiscovery / updateDeviceData / updateDeviceStatus
                                          |
                                          v
   Device (1 per inverter, sourceDeviceId = serial)
     data: power, energy, ac_voltage, frequency, inverter_temp, signal,
           ch1_voltage/current/power/energy, ch2_voltage/current/power/energy
                                          |
                  user binds a "Solar Panel" equipment per channel
                                          |
   binding-candidates(solar_panel) --> 1 candidate per ch<N>_  ("Panel 1", "Panel 2")
                                        each = ch<N>_{V,I,P,E} + shared inverter_temp
                                          |
                                          v
   Equipment (type solar_panel)
     compact card  -> produced power (W) + EquipmentStatusBadge (online/offline)
     detailed view -> power, energy, voltage, current, inverter temperature
```

## MQTT wire contract (consumed, not defined here)

`tele/<root>/SENSOR`, one object per producing inverter (from ESP32-ECU `docs/mqtt-api.md`):

```json
{
  "705000165830": {
    "Name": "Toit Sud",
    "ACVoltage": 228.4,
    "Frequency": 50.02,
    "Temperature": 19.1,
    "Signal": 78,
    "Power": 115.5,
    "Energy": 1732.1,
    "Ch1Voltage": 36.7,
    "Ch1Current": 1.55,
    "Ch1Power": 56.9,
    "Ch1Energy": 848.6,
    "Ch2Voltage": 36.4,
    "Ch2Current": 1.61,
    "Ch2Power": 58.6,
    "Ch2Energy": 883.5
  }
}
```

Payload field → device data key mapping (plugin parser):

| MQTT field     | device key      | category             | unit |
| -------------- | --------------- | -------------------- | ---- |
| `Power`        | `power`         | `power`              | W    |
| `Energy`       | `energy`        | `energy`             | Wh   |
| `ACVoltage`    | `ac_voltage`    | `voltage`            | V    |
| `Frequency`    | `frequency`     | `generic`            | Hz   |
| `Temperature`  | `inverter_temp` | `temperature_device` | C    |
| `Signal`       | `signal`        | `rssi`               | %    |
| `Ch<N>Voltage` | `ch<N>_voltage` | `voltage`            | V    |
| `Ch<N>Current` | `ch<N>_current` | `current`            | A    |
| `Ch<N>Power`   | `ch<N>_power`   | `power`              | W    |
| `Ch<N>Energy`  | `ch<N>_energy`  | `energy`             | Wh   |

`Name` is read but not mapped to a data point (informational).

## Part 1 — Sowel core (this repo)

### New equipment type (no widget family)

`solar_panel` joins `EquipmentType`. It is intentionally **absent** from
`WIDGET_FAMILY_TYPES` — exactly like `energy_meter` / `energy_production_meter` /
`main_energy_meter`, which are rendered as individual equipment cards rather than
family-grouped widgets. So there is NO `WidgetFamily` change.

### New data category `temperature_device`

Modelled on `temperature_outdoor`. Touch points (sibling-by-sibling):

| Domain        | File                                                                 | Change                                                              |
| ------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Types         | `src/shared/types.ts`                                                | `DataCategory += "temperature_device"`                              |
| Streaming     | `src/shared/constants.ts` (`STREAMING_CATEGORIES`)                   | add `temperature_device`                                            |
| Streaming TTL | `src/shared/constants.ts` (`STREAMING_TIMEOUT_MS`)                   | `temperature_device: 15 * 60 * 1000`                                |
| History       | `src/history/history-writer.ts`                                      | add to historized-by-default set + deadband `0.2`                   |
| UI types      | `ui/src/types.ts`                                                    | mirror `DataCategory`                                               |
| UI history    | `ui/src/components/history/history-utils.ts`                         | add to category lists                                               |
| UI label      | `ui/src/components/history/binding-label.ts`                         | label branch for `temperature_device`                               |
| UI sensor     | `ui/src/components/equipments/sensorUtils.tsx`                       | include in sensor category ordering                                 |
| UI relevance  | `ui/src/components/equipments/bindingUtils.ts`, `DeviceSelector.tsx` | `solar_panel` → `[power,energy,voltage,current,temperature_device]` |
| i18n          | `ui/src/i18n/locales/{en,fr}.json`                                   | `category.temperature_device` label                                 |

The existing Zigbee2MQTT `device_temperature` → `temperature` mapping is **left
unchanged** (per product decision): `temperature_device` is consumed only by the
APsystems plugin, so there is no behavior change on existing installs.

### Per-channel binding candidates

New `case "solar_panel"` in `computeBindingCandidates()`. Group by `/^ch(\d+)_/`, then
append the shared `inverter_temp` key (if present) to each channel candidate:

```ts
case "solar_panel": {
  const sharedTemp = deviceData.find((d) => d.key === "inverter_temp")?.key;
  const byChannel = new Map<number, string[]>();
  for (const d of deviceData) {
    const m = /^ch(\d+)_/.exec(d.key);
    if (!m) continue;                          // ignore inverter-level keys
    const n = Number(m[1]);
    if (!byChannel.has(n)) byChannel.set(n, []);
    byChannel.get(n)!.push(d.key);
  }
  return [...byChannel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, keys]) => ({
      id: `ch${n}`,
      label: `Panel ${n}`,
      dataKeys: sharedTemp ? [...keys, sharedTemp] : keys,
      orderKeys: [],
    }));
}
```

Binding the same `inverter_temp` deviceData to both panel equipments is allowed:
`data_bindings` is `UNIQUE(equipment_id, alias)`, not on `device_data_id`
(`migrations/001_initial.sql:83`).

### Zone aggregation — no change

`solar_panel` falls through to the default `accumulateBindings()` path. Its bound
categories are `power`/`energy`/`voltage`/`current`/`temperature_device`, none of which
the aggregator sums (it only handles `temperature` with `alias === "temperature"`,
plus humidity/luminosity/motion/contacts). `temperature_device` is a distinct category,
so it is never room-aggregated. Net: zero `zone-aggregator` edits.

### UI cards

| Card             | File                                                                                | Pattern to follow                           |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| Compact (zone)   | `ui/src/components/dashboard/EquipmentWidget.tsx` → new `SolarPanelEquipmentWidget` | `EnergyMeterEquipmentWidget`                |
| Detailed (sheet) | `ui/src/components/dashboard/WidgetDetailSheet.tsx`                                 | sensor/energy read-only detail content      |
| Detailed (page)  | `ui/src/pages/EquipmentDetailPage.tsx`                                              | reuse a read-only data panel                |
| Type icon/label  | `ui/src/components/equipments/EquipmentCard.tsx`                                    | `TYPE_ICONS`/`TYPE_LABELS` += `solar_panel` |
| Default icon     | `ui/src/components/dashboard/widget-icons.ts`                                       | `EQUIPMENT_DEFAULT_ICONS.solar_panel="Sun"` |
| Type picker      | `ui/src/components/equipments/EquipmentForm.tsx`                                    | `EQUIPMENT_TYPE_KEYS += solar_panel`        |

Compact card headline value = the `power`-category binding:

```ts
const power = equipment.dataBindings.find((b) => b.category === "power");
// format: W, or (W/1000).toFixed(1) + " kW" above 1000
```

Status via the existing `EquipmentStatusBadge` (`equipment.status` / `statusReason`).

### Files changed (core summary)

| Domain    | File                                                  | Change                                                               |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| Types     | `src/shared/types.ts`                                 | `EquipmentType += solar_panel`; `DataCategory += temperature_device` |
| Constants | `src/shared/constants.ts`                             | streaming + timeout + z2m remap for temperature_device               |
| History   | `src/history/history-writer.ts`                       | temperature_device default-on + deadband                             |
| Equipment | `src/equipments/binding-candidates.ts` (+ `.test.ts`) | `case "solar_panel"`                                                 |
| UI        | (see "UI cards" + "New data category" tables above)   | type mirrors, cards, labels, i18n                                    |

## Part 2 — `sowel-plugin-apsystems` (new repo)

Structure mirrors `sowel-plugin-tasmota` (closest template; ESP32-ECU mimics the
Tasmota `tele/<root>/SENSOR` + `LWT` shape).

```
sowel-plugin-apsystems/
  manifest.json            # id "apsystems", icon "Sun", FR8 settings, apiVersion 2
  package.json             # type module, dep mqtt ^5
  tsconfig.json
  src/
    index.ts               # createPlugin factory + ApsystemsPlugin (lifecycle/status/settings)
    mqtt-connector.ts       # copied verbatim from tasmota
    apsystems-engine.ts     # subscribe SENSOR+LWT, discovery loop, presence tracking
    apsystems-parser.ts     # PURE: payload JSON -> { perSerial: { discovered, data } }  (tested)
    apsystems-parser.test.ts
  README.md
```

### Key difference vs tasmota

Tasmota = one topic subtree per device. APsystems = **one** `tele/<root>/SENSOR` carrying
every inverter in a single JSON. Discovery iterates the top-level keys of one payload;
presence tracking keeps a `Set<serial>` of the previous cycle, and the diff drives
`updateDeviceStatus`.

### Plugin lifecycle (index.ts)

`isConfigured()` = `mqtt_url` present. `start()` builds the `MqttConnector`, connects,
wires `ApsystemsEngine` subscriptions. `getStatus()` reflects the broker connection.
`executeOrder()` throws (read-only). `stop()` disconnects.

### Registry (Sowel repo, after first release)

Add an `apsystems` entry to `plugins/registry.json` (`owner: mchacher`, `type:
integration`, `icon: Sun`) and backfill `sha256` via
`scripts/backfill-registry-sha256.mjs` once the GitHub release is published — a separate
follow-up PR, not part of the core feature branch.

## Events

No new event types. The plugin emits only the whitelisted
`system.integration.connected`/`disconnected` (via the shared `MqttConnector`). Domain
events are emitted by Sowel managers in reaction to `deviceManager` calls — standard
reactive pipeline.

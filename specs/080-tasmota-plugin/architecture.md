# Spec 080 — Architecture

## Plugin structure

Plugin lives in a separate GitHub repo `sowel-plugin-tasmota`, following the same pattern as `sowel-plugin-zigbee2mqtt` and `sowel-plugin-lora2mqtt`.

```
sowel-plugin-tasmota/
├── package.json                # name, version, build scripts
├── manifest.json               # plugin id, settings declaration
├── src/
│   ├── index.ts                # createPlugin(deps) entry
│   ├── tasmota-plugin.ts       # IntegrationPlugin implementation
│   ├── tasmota-parser.ts       # STATUS 0/11 parser
│   └── tasmota-parser.test.ts  # unit tests
├── dist/                       # tsc output (distributed in release tarball)
└── README.md
```

## MQTT Topics

Tasmota convention (with default `base_topic = "tasmota"`):

| Direction | Topic pattern                            | Purpose                           |
| --------- | ---------------------------------------- | --------------------------------- |
| SUB       | `tasmota/tele/+/LWT`                     | Online/Offline presence           |
| SUB       | `tasmota/tele/<device>/STATE`            | Periodic full state (every 5 min) |
| SUB       | `tasmota/tele/<device>/SENSOR`           | (Future) sensor readings          |
| SUB       | `tasmota/stat/<device>/RESULT`           | Command responses + state deltas  |
| SUB       | `tasmota/stat/<device>/STATUS0..11`      | STATUS command responses          |
| PUB       | `tasmota/cmnd/<device>/STATUS`           | Query device info                 |
| PUB       | `tasmota/cmnd/<device>/POWERn`           | Toggle relay `n`                  |
| PUB       | `tasmota/cmnd/<device>/ShutterPositionn` | Set shutter `n` position (0-100)  |
| PUB       | `tasmota/cmnd/<device>/ShutterOpenn`     | Open shutter `n`                  |
| PUB       | `tasmota/cmnd/<device>/ShutterClosen`    | Close shutter `n`                 |
| PUB       | `tasmota/cmnd/<device>/ShutterStopn`     | Stop shutter `n`                  |

`<device>` is the Tasmota `Topic` setting (e.g. `SONOFF_4CH_PRO_PISCINE`).

## Discovery Flow

```
Plugin startup
  → Connect to MQTT broker
  → Subscribe: tasmota/tele/+/LWT
  → Subscribe: tasmota/stat/+/STATUS0
  → Subscribe: tasmota/stat/+/STATUS11
  → Subscribe: tasmota/tele/+/STATE
  → Subscribe: tasmota/stat/+/RESULT

On tasmota/tele/<device>/LWT = "Online"
  → Publish: tasmota/cmnd/<device>/STATUS → 0
  → Publish: tasmota/cmnd/<device>/STATUS → 11

On tasmota/stat/<device>/STATUS0 (full device info)
  → Parse: module type, FriendlyName, relay count, shutter config
  → Build DiscoveredDevice (data[] + orders[])
  → deviceManager.upsertFromDiscovery("tasmota", "tasmota", discovered)
  → deviceManager.updateDeviceStatus("tasmota", <device>, "online")

On tasmota/stat/<device>/STATUS11 (periodic state)
  → Parse: current POWER states, shutter positions
  → deviceManager.updateDeviceData("tasmota", <device>, { power1: "ON", shutter_position: 50 })

On tasmota/tele/<device>/STATE (periodic state, every 5 min)
  → Same parsing as STATUS11

On tasmota/stat/<device>/RESULT (command result)
  → Same parsing as STATUS11

On tasmota/tele/<device>/LWT = "Offline"
  → deviceManager.updateDeviceStatus("tasmota", <device>, "offline")
```

## Data Model

### DiscoveredDevice (sent to Sowel core)

For a device with 4 relays (POWER1..POWER4), where POWER1+POWER2 are bound to a shutter:

```typescript
{
  friendlyName: "SONOFF_4CH_PRO_PISCINE",
  manufacturer: "Tasmota",
  model: "Sonoff 4CH Pro",         // from Module field
  ieeeAddress: undefined,
  data: [
    { key: "power3", type: "enum", category: "generic", enumValues: ["ON", "OFF"] },
    { key: "power4", type: "enum", category: "generic", enumValues: ["ON", "OFF"] },
    { key: "shutter_position", type: "number", category: "position", unit: "%" },
  ],
  orders: [
    { key: "power3", type: "enum", category: "light_toggle", enumValues: ["ON", "OFF"] },
    { key: "power4", type: "enum", category: "light_toggle", enumValues: ["ON", "OFF"] },
    { key: "shutter_state", type: "enum", category: "shutter_move", enumValues: ["OPEN", "CLOSE", "STOP"] },
    { key: "shutter_position", type: "number", category: "set_shutter_position", min: 0, max: 100, unit: "%" },
  ],
  rawExpose: { /* STATUS 0 response */ },
}
```

Note: POWER1 and POWER2 are absorbed by the shutter — not exposed separately.

### Plugin-level state

The plugin maintains in-memory state per device:

```typescript
interface TasmotaDevice {
  topic: string; // "SONOFF_4CH_PRO_PISCINE"
  module: string; // "Sonoff 4CH Pro"
  friendlyName: string; // from FriendlyName1
  relayCount: number; // from Status.FriendlyName array length
  shutterRelays: number[]; // [1, 2] if shutter uses relays 1+2
  online: boolean;
}
```

## Order Dispatch

`executeOrder(device, orderKey, value)`:

```typescript
switch (true) {
  case orderKey.startsWith("power"):
    const n = parseInt(orderKey.slice(5)); // power3 → 3
    publish(`${baseTopic}/cmnd/${device.sourceDeviceId}/POWER${n}`, value);
    break;

  case orderKey === "shutter_state":
    const action =
      value === "OPEN" ? "ShutterOpen1" : value === "CLOSE" ? "ShutterClose1" : "ShutterStop1";
    publish(`${baseTopic}/cmnd/${device.sourceDeviceId}/${action}`, "");
    break;

  case orderKey === "shutter_position":
    publish(`${baseTopic}/cmnd/${device.sourceDeviceId}/ShutterPosition1`, String(value));
    break;
}
```

## Tasmota STATUS 0 Response Shape

```json
{
  "Status": {
    "Module": 23,
    "DeviceName": "SONOFF_4CH_PRO_PISCINE",
    "FriendlyName": ["Pompe", "Spot", "Volet", "Volet"],
    "Topic": "SONOFF_4CH_PRO_PISCINE",
    "Power": 0
  },
  "StatusPRM": {
    /* ... */
  },
  "StatusFWR": { "Version": "13.4.0" },
  "StatusSHT": {
    "SHT1": {
      "Relay1": 3, // first relay for shutter: POWER3
      "Relay2": 4, // second relay: POWER4
      "Position": 50,
      "Direction": 0
    }
  },
  "StatusSNS": {
    /* ... */
  }
}
```

The parser detects shutter-absorbed relays from `StatusSHT.SHTn.Relay1` and `Relay2`.

## Files to Create / Modify

### New repo: `sowel-plugin-tasmota`

| File                            | Content                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `package.json`                  | Plugin package with tsc build + mqtt dependency                 |
| `manifest.json`                 | Plugin id, settings (mqtt_url, etc.), `apiVersion: 2`           |
| `src/index.ts`                  | Exports `createPlugin(deps)`                                    |
| `src/tasmota-plugin.ts`         | `IntegrationPlugin` implementation: connect, discover, dispatch |
| `src/tasmota-parser.ts`         | Parse STATUS 0 / STATE messages into `DiscoveredDevice`         |
| `src/tasmota-parser.test.ts`    | Unit tests with sample messages                                 |
| `.github/workflows/release.yml` | Tag-triggered release workflow (builds tarball)                 |
| `README.md`                     | Setup / Tasmota MQTT config pointers                            |

### Sowel main repo

| File                    | Change                                   |
| ----------------------- | ---------------------------------------- |
| `plugins/registry.json` | Add Tasmota plugin entry (version 1.0.0) |

### No Sowel core changes

The plugin uses the existing `IntegrationPlugin` (apiVersion 2) interface. No changes to types, managers, or API.

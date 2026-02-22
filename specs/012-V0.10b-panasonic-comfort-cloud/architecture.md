# Architecture: V0.10b Panasonic Comfort Cloud Integration

## Design Decision: Python Bridge

Instead of porting the Panasonic auth/API logic to TypeScript, we use the community-maintained Python library `aio-panasonic-comfort-cloud` (used by Home Assistant) via a CLI bridge script. This gives us:

- **Community maintenance** — Auth flow, API headers, app version updates are handled by the HA community
- **Zero auth complexity** — No OAuth2/PKCE, no HTML parsing, no cookie management in TypeScript
- **Simple upgrade path** — `pip install --upgrade aio-panasonic-comfort-cloud` follows HA updates
- **Trade-off** — Requires Python 3.10+ runtime on the host

## File Structure

```
src/integrations/panasonic-cc/
├── index.ts              # PanasonicCCIntegration implements IntegrationPlugin
├── panasonic-bridge.ts   # Spawns Python bridge, parses JSON output
├── panasonic-poller.ts   # Polling scheduler (regular + on-demand)
├── panasonic-types.ts    # TypeScript types for bridge JSON responses + enum mappings
└── bridge.py             # Python CLI wrapper around aio-panasonic-comfort-cloud
```

## Python Bridge (`bridge.py`)

A thin CLI script that wraps `aio-panasonic-comfort-cloud`. Called via `child_process.execFile('python3', ['bridge.py', ...])`. All output is JSON to stdout.

### Commands

```bash
# Login + verify credentials (also discovers devices)
python3 bridge.py login --email X --password Y --token-file /path/tokens.json

# Get all devices (groups + status)
python3 bridge.py get_devices --email X --password Y --token-file /path/tokens.json

# Get single device status
python3 bridge.py get_device --id GUID --email X --password Y --token-file /path/tokens.json

# Send control command
python3 bridge.py control --id GUID --param power --value 1 --email X --password Y --token-file /path/tokens.json
```

### Token Persistence

The Python `Session` class handles token storage natively via `--token-file`. Tokens are persisted between calls, avoiding re-authentication on every command. The file is stored in `data/panasonic-tokens.json`.

### JSON Output Format

```json
// get_devices response
{
  "ok": true,
  "devices": [
    {
      "id": "CS-Z50VKEW_ABCDEF123",
      "guid": "actual-device-guid",
      "name": "Salon",
      "group": "Maison",
      "model": "CS-Z50VKEW",
      "parameters": {
        "power": true,
        "mode": "cool",
        "targetTemperature": 22.5,
        "insideTemperature": 24,
        "outsideTemperature": 32,
        "fanSpeed": "auto",
        "airSwingUD": "mid",
        "airSwingLR": "mid",
        "ecoMode": "auto",
        "nanoe": "on"
      },
      "features": {
        "nanoe": true,
        "autoMode": true,
        "heatMode": true,
        "dryMode": true,
        "coolMode": true,
        "fanMode": true,
        "airSwingLR": true
      }
    }
  ]
}

// control response
{
  "ok": true
}

// error response
{
  "ok": false,
  "error": "Invalid credentials"
}
```

The bridge script handles all enum conversions (numeric → string for output, string → numeric for control).

### Error Handling

- Wrong credentials → `{"ok": false, "error": "Login failed: ..."}`
- Network error → `{"ok": false, "error": "Connection error: ..."}`
- Invalid temperature (126) → exposed as `null`
- Script exits with code 0 even on errors (error in JSON), non-zero only for crashes

## TypeScript Integration

### PanasonicBridge (`panasonic-bridge.ts`)

Thin wrapper that spawns the Python script and parses JSON:

```ts
class PanasonicBridge {
  constructor(
    private pythonPath: string, // default: "python3"
    private bridgePath: string, // path to bridge.py
    private tokenFile: string, // data/panasonic-tokens.json
  ) {}

  async getDevices(email: string, password: string): Promise<BridgeDevicesResponse>;
  async getDevice(id: string, email: string, password: string): Promise<BridgeDeviceResponse>;
  async control(
    id: string,
    param: string,
    value: unknown,
    email: string,
    password: string,
  ): Promise<void>;
}
```

Each call spawns `python3 bridge.py <command> --args...`, reads stdout, parses JSON. Timeout: 30s per command.

### PanasonicPoller (`panasonic-poller.ts`)

Manages polling on the Node.js side:

```ts
class PanasonicPoller {
  private interval: NodeJS.Timeout | null = null;
  private pollIntervalMs: number; // default 300_000 (5 min)

  start(): void; // Immediate first poll + setInterval
  stop(): void; // clearInterval
  scheduleOnDemandPoll(deviceGuid: string, delayMs?: number): void; // setTimeout after order
}
```

On each poll cycle:

1. Call `bridge.getDevices()` (single Python invocation returns all devices + status)
2. For each device, map to Corbel `DiscoveredDevice` format
3. Call `deviceManager.upsertFromDiscovery()` to update/create devices + data

### PanasonicCCIntegration (`index.ts`)

```ts
class PanasonicCCIntegration implements IntegrationPlugin {
  readonly id = "panasonic_cc";
  readonly name = "Panasonic Comfort Cloud";
  readonly icon = "AirVent";

  // Settings schema (UI form)
  getSettingsSchema(): IntegrationSettingDef[] → email, password, polling_interval

  // Start: validate credentials, discover devices, start polling
  start(): Promise<void>

  // Stop: stop polling
  stop(): Promise<void>

  // Execute order: call bridge.control(), schedule on-demand poll
  executeOrder(device, dispatchConfig, value): Promise<void>
}
```

### Order Dispatch

`executeOrder(device, dispatchConfig, value)`:

1. Read `dispatchConfig.param` (e.g. `"operationMode"`)
2. Read `dispatchConfig.guid` (the Panasonic device GUID)
3. Call `bridge.control(guid, param, value, email, password)`
4. Schedule on-demand poll after 10s delay

## Data Model

### Panasonic Device → Corbel Device Mapping

Each AC unit becomes a Corbel Device:

| Corbel field     | Source                         |
| ---------------- | ------------------------------ |
| `integrationId`  | `"panasonic_cc"`               |
| `sourceDeviceId` | `device.id` from bridge output |
| `name`           | `device.name`                  |
| `manufacturer`   | `"Panasonic"`                  |
| `model`          | `device.model`                 |
| `source`         | `"panasonic_cc"`               |

### DeviceData exposed per AC unit

| key                  | type    | category    | unit | Bridge source                                     |
| -------------------- | ------- | ----------- | ---- | ------------------------------------------------- |
| `power`              | boolean | generic     | —    | `parameters.power`                                |
| `operationMode`      | enum    | generic     | —    | `parameters.mode`                                 |
| `targetTemperature`  | number  | temperature | °C   | `parameters.targetTemperature` (null if invalid)  |
| `insideTemperature`  | number  | temperature | °C   | `parameters.insideTemperature` (null if invalid)  |
| `outsideTemperature` | number  | temperature | °C   | `parameters.outsideTemperature` (null if invalid) |
| `fanSpeed`           | enum    | generic     | —    | `parameters.fanSpeed`                             |
| `airSwingUD`         | enum    | generic     | —    | `parameters.airSwingUD`                           |
| `airSwingLR`         | enum    | generic     | —    | `parameters.airSwingLR`                           |
| `ecoMode`            | enum    | generic     | —    | `parameters.ecoMode`                              |
| `nanoe`              | enum    | generic     | —    | `parameters.nanoe`                                |

### DeviceOrders exposed per AC unit

| key                 | type    | dispatchConfig                                                                                |
| ------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `power`             | boolean | `{ "param": "power", "guid": "<deviceGuid>" }`                                                |
| `operationMode`     | enum    | `{ "param": "mode", "guid": "<deviceGuid>", "enumValues": [...] }`                            |
| `targetTemperature` | number  | `{ "param": "targetTemperature", "guid": "<deviceGuid>", "min": 16, "max": 30, "step": 0.5 }` |
| `fanSpeed`          | enum    | `{ "param": "fanSpeed", "guid": "<deviceGuid>", "enumValues": [...] }`                        |
| `airSwingUD`        | enum    | `{ "param": "airSwingUD", "guid": "<deviceGuid>", "enumValues": [...] }`                      |
| `airSwingLR`        | enum    | `{ "param": "airSwingLR", "guid": "<deviceGuid>", "enumValues": [...] }`                      |
| `ecoMode`           | enum    | `{ "param": "ecoMode", "guid": "<deviceGuid>", "enumValues": [...] }`                         |
| `nanoe`             | enum    | `{ "param": "nanoe", "guid": "<deviceGuid>", "enumValues": [...] }`                           |

Available enum values are filtered per device based on `features` flags from the bridge.

## New EquipmentType: thermostat

### types.ts

```ts
export type EquipmentType =
  | "light_onoff"
  | "light_dimmable"
  | "light_color"
  | "shutter"
  | "switch"
  | "sensor"
  | "button"
  | "thermostat"; // NEW
```

### EquipmentManager

Add `"thermostat"` to `VALID_EQUIPMENT_TYPES` set.

### ZoneAggregatedData

No change needed — thermostat temperature data feeds into zone aggregation via the existing `temperature` category.

## UI Changes

### Thermostat Widget (Dashboard)

New component `ThermostatCard` in `ui/src/components/equipments/`:

- Large temperature display (inside temp, 28px font)
- Target temperature control (up/down buttons, +/- 0.5°C)
- Mode selector (auto/cool/heat/dry/fan) with icons
- Fan speed selector
- Power on/off toggle
- Outside temperature (small, secondary)
- Eco mode indicator

### IntegrationsPage

Rendered dynamically from integration registry (already working from V0.10a):

- Email/password fields (from settings schema)
- Polling interval (number input, seconds)
- Status indicator (connected/disconnected/error)
- Save / Start / Stop buttons

### EquipmentDetailPage

When `equipment.type === "thermostat"`, show a thermostat-specific detail view with:

- Current values (inside temp, outside temp, mode, fan, etc.)
- Control panel (same as widget but larger)
- Bound device info

## API Changes

No new REST endpoints beyond V0.10a's integration endpoints.

## Dependencies

### Python (runtime)

- `aio-panasonic-comfort-cloud` — Community-maintained Panasonic CC client (HA ecosystem)
- Python 3.10+ on the host

### npm

- No new npm dependencies (removed `node-html-parser`)

## File Changes

| File                                                | Change                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `src/integrations/panasonic-cc/bridge.py`           | **New** — Python CLI bridge                     |
| `src/integrations/panasonic-cc/index.ts`            | **New** — PanasonicCCIntegration                |
| `src/integrations/panasonic-cc/panasonic-bridge.ts` | **New** — TS wrapper for Python bridge          |
| `src/integrations/panasonic-cc/panasonic-poller.ts` | **New** — Polling scheduler                     |
| `src/integrations/panasonic-cc/panasonic-types.ts`  | **New** — Bridge response types + enum mappings |
| `src/shared/types.ts`                               | Add `"thermostat"` to EquipmentType             |
| `src/equipments/equipment-manager.ts`               | Add `"thermostat"` to VALID_EQUIPMENT_TYPES     |
| `src/index.ts`                                      | Register PanasonicCCIntegration                 |
| `ui/src/components/equipments/ThermostatCard.tsx`   | **New** — Thermostat widget                     |
| `ui/src/pages/EquipmentDetailPage.tsx`              | Add thermostat-specific detail view             |
| `ui/src/i18n/locales/fr.json`                       | Thermostat translations                         |
| `ui/src/i18n/locales/en.json`                       | Thermostat translations                         |
| `requirements.txt`                                  | **New** — `aio-panasonic-comfort-cloud`         |

## Pipeline

```
PanasonicCCIntegration (TypeScript)
  ├── PanasonicBridge (spawns Python bridge.py)
  │    └── aio-panasonic-comfort-cloud (Python, community-maintained)
  │         └── Panasonic Cloud API (OAuth2 + REST)
  ├── PanasonicPoller (Node.js setInterval)
  │    └── bridge.getDevices()
  │         └── DeviceManager.upsertFromDiscovery()
  │              └── EventBus: "device.data.updated"
  │                   └── EquipmentManager → ZoneAggregator → Scenarios → WebSocket
  └── executeOrder(device, dispatchConfig, value)
       ├── bridge.control(guid, param, value)
       └── scheduleOnDemandPoll(device, 10s)
```

# Architecture: V0.10b Panasonic Comfort Cloud Integration

## Panasonic CC Integration Plugin

```
src/integrations/panasonic-cc/
├── index.ts                  # PanasonicCCIntegration implements IntegrationPlugin
├── panasonic-client.ts       # HTTP client: auth, token management, API calls
├── panasonic-discovery.ts    # Device group parsing, device model mapping
├── panasonic-poller.ts       # Polling scheduler (regular + on-demand)
└── panasonic-types.ts        # Panasonic API response types, enums
```

## Authentication Flow

TypeScript port of the Auth0 PKCE flow from `aio-panasonic-comfort-cloud`:

1. Generate PKCE params (code_verifier, code_challenge, state)
2. GET `/authorize` → follow redirect chain
3. POST `/usernamepassword/login` with credentials
4. Parse HTML response for hidden form fields (wa, wresult, wctx)
5. POST `/login/callback` → follow redirect → extract `code`
6. POST `/oauth/token` → get `access_token` + `refresh_token`
7. POST `accsmart.panasonic.com/auth/v2/login` → get ACC `clientId`

### Token Storage

Stored in SettingsManager:

- `integration.panasonic-cc.access_token`
- `integration.panasonic-cc.refresh_token`
- `integration.panasonic-cc.token_expires` (ISO timestamp)
- `integration.panasonic-cc.acc_client_id`
- `integration.panasonic-cc.scope`

### Token Refresh

Before each API call, check if `access_token` is expired (decode JWT payload, compare `exp` field). If expired, call `POST /oauth/token` with `grant_type=refresh_token`. If refresh fails, re-authenticate with stored email/password.

### API Key Computation

Each request to `accsmart.panasonic.com` requires a computed `x-cfc-api-key` header:

```
timestamp = "YYYY-MM-DD HH:MM:SS"
timestamp_ms = Date.parse(timestamp + " UTC").toString()
input = "Comfort Cloud" + "521325fb2dd486bf4831b47644317fca" + timestamp_ms + "Bearer " + access_token
api_key = SHA256(input).hex()
result = api_key[0:9] + "cfc" + api_key[9:]
```

## Data Model

### Panasonic Device → Corbel Device Mapping

Each AC unit in `/device/group` becomes a Corbel Device:

| Corbel field     | Panasonic source                      |
| ---------------- | ------------------------------------- |
| `integrationId`  | `"panasonic_cc"`                      |
| `sourceDeviceId` | `deviceHashGuid` or `MD5(deviceGuid)` |
| `name`           | `deviceName`                          |
| `manufacturer`   | `"Panasonic"`                         |
| `model`          | `deviceModuleNumber`                  |
| `source`         | `"panasonic_cc"`                      |
| `ieeeAddress`    | _not applicable_                      |

### DeviceData exposed per AC unit

| key                  | type    | category    | unit | Panasonic source                                                       |
| -------------------- | ------- | ----------- | ---- | ---------------------------------------------------------------------- |
| `power`              | boolean | generic     | —    | `parameters.operate` (0→false, 1→true)                                 |
| `operationMode`      | enum    | generic     | —    | `parameters.operationMode` → "auto"/"dry"/"cool"/"heat"/"fan"          |
| `targetTemperature`  | number  | temperature | °C   | `parameters.temperatureSet` (126 → null)                               |
| `insideTemperature`  | number  | temperature | °C   | `parameters.insideTemperature` (126 → null)                            |
| `outsideTemperature` | number  | temperature | °C   | `parameters.outTemperature` (126 → null)                               |
| `fanSpeed`           | enum    | generic     | —    | `parameters.fanSpeed` → "auto"/"low"/"low_mid"/"mid"/"high_mid"/"high" |
| `airSwingUD`         | enum    | generic     | —    | `parameters.airSwingUD` → "auto"/"up"/"down"/"mid"/...                 |
| `airSwingLR`         | enum    | generic     | —    | `parameters.airSwingLR` → "auto"/"right"/"left"/"mid"/...              |
| `ecoMode`            | enum    | generic     | —    | `parameters.ecoMode` → "auto"/"powerful"/"quiet"                       |
| `nanoe`              | enum    | generic     | —    | `parameters.nanoe` → "unavailable"/"off"/"on"/"modeG"/"all"            |

### DeviceOrders exposed per AC unit

| key                 | type    | dispatchConfig                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `power`             | boolean | `{ "param": "operate" }`                                                                          |
| `operationMode`     | enum    | `{ "param": "operationMode", "enumValues": ["auto","dry","cool","heat","fan"] }`                  |
| `targetTemperature` | number  | `{ "param": "temperatureSet", "min": 16, "max": 30, "step": 0.5 }`                                |
| `fanSpeed`          | enum    | `{ "param": "fanSpeed", "enumValues": ["auto","low","low_mid","mid","high_mid","high"] }`         |
| `airSwingUD`        | enum    | `{ "param": "airSwingUD", "enumValues": ["auto","up","down","mid","up_mid","down_mid","swing"] }` |
| `airSwingLR`        | enum    | `{ "param": "airSwingLR", "enumValues": ["auto","right","left","mid","right_mid","left_mid"] }`   |
| `ecoMode`           | enum    | `{ "param": "ecoMode", "enumValues": ["auto","powerful","quiet"] }`                               |
| `nanoe`             | enum    | `{ "param": "nanoe", "enumValues": ["off","on","modeG","all"] }`                                  |

### Order Dispatch

`PanasonicCCIntegration.executeOrder(device, dispatchConfig, value)`:

1. Map string enum values back to Panasonic numeric codes
2. Handle swing mode coordination (fanAutoMode)
3. POST to `/deviceStatus/control` with `{ deviceGuid, parameters: { [param]: numericValue } }`
4. Schedule on-demand poll after delay (10s default)

## Polling Strategy

### Regular Polling

```ts
class PanasonicPoller {
  private interval: NodeJS.Timeout | null = null;
  private pollIntervalMs: number; // default 300_000 (5 min)

  start(): void {
    this.poll(); // Immediate first poll
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async poll(): Promise<void> {
    for (const device of devices) {
      await this.pollDevice(device);
      // Small delay between devices to avoid burst
    }
  }

  // Called after an order is executed
  scheduleOnDemandPoll(deviceGuid: string, delayMs: number = 10_000): void {
    setTimeout(() => this.pollDevice(deviceGuid), delayMs);
  }
}
```

### Request Serialization

A simple mutex (queue) ensures only one API request is in flight:

```ts
class RequestMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> { ... }
  release(): void { ... }
}
```

### Cached vs Live Fallback

On poll, use cached endpoint (`/deviceStatus/now/{guid}`). If it fails, log warning and retry on next cycle. Live endpoint (`/deviceStatus/{guid}`) is not used by default (slower, more rate-limit prone).

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

Add `PanasonicCCCard` (rendered dynamically from integration registry):

- Email/password fields
- Polling interval (number input, seconds)
- Status indicator (connected/disconnected/error)
- Device count after connection
- Save / Connect / Disconnect buttons

### EquipmentDetailPage

When `equipment.type === "thermostat"`, show a thermostat-specific detail view with:

- Current values (inside temp, outside temp, mode, fan, etc.)
- Control panel (same as widget but larger)
- Bound device info

## API Changes

No new REST endpoints beyond V0.10a's integration endpoints. The Panasonic integration uses the existing:

- `GET /api/v1/integrations` → includes panasonic-cc status
- `POST /api/v1/integrations/panasonic-cc/start`
- `POST /api/v1/integrations/panasonic-cc/stop`
- `PUT /api/v1/settings` → save panasonic-cc credentials + polling interval

## Dependencies (npm)

- `node-html-parser` — parse Auth0 HTML response for hidden form fields (lightweight, zero-dependency)
- No need for cookie jar library — manual cookie extraction from response headers

## File Changes

| File                                                   | Change                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/integrations/panasonic-cc/index.ts`               | **New** — PanasonicCCIntegration                                      |
| `src/integrations/panasonic-cc/panasonic-client.ts`    | **New** — Auth + API client                                           |
| `src/integrations/panasonic-cc/panasonic-discovery.ts` | **New** — Device mapping                                              |
| `src/integrations/panasonic-cc/panasonic-poller.ts`    | **New** — Polling scheduler                                           |
| `src/integrations/panasonic-cc/panasonic-types.ts`     | **New** — API types + enums                                           |
| `src/shared/types.ts`                                  | Add `"panasonic_cc"` to DeviceSource, `"thermostat"` to EquipmentType |
| `src/equipments/equipment-manager.ts`                  | Add `"thermostat"` to VALID_EQUIPMENT_TYPES                           |
| `src/index.ts`                                         | Register PanasonicCCIntegration in IntegrationRegistry                |
| `ui/src/components/equipments/ThermostatCard.tsx`      | **New** — Thermostat widget                                           |
| `ui/src/components/equipments/ThermostatControl.tsx`   | **New** — Temperature/mode/fan controls                               |
| `ui/src/pages/EquipmentDetailPage.tsx`                 | Add thermostat-specific detail view                                   |
| `ui/src/i18n/locales/fr.json`                          | Thermostat + Panasonic translations                                   |
| `ui/src/i18n/locales/en.json`                          | Thermostat + Panasonic translations                                   |
| `package.json`                                         | Add `node-html-parser` dependency                                     |

## Pipeline

```
PanasonicCCIntegration
  ├── PanasonicClient (auth + HTTP)
  ├── PanasonicPoller (scheduled polling)
  │    └── GET /deviceStatus/now/{guid}
  │         └── DeviceManager.updateDeviceData(integrationId, sourceDeviceId, payload)
  │              └── EventBus: "device.data.updated"
  │                   └── EquipmentManager → ZoneAggregator → Scenarios → WebSocket
  └── executeOrder(device, dispatchConfig, value)
       ├── POST /deviceStatus/control
       └── scheduleOnDemandPoll(device, 10s)
```

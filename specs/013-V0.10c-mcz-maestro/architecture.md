# Architecture: V0.10c MCZ Maestro Integration

## Communication Protocol

```
Winch Engine
  └─ MczMaestroIntegration (IntegrationPlugin)
       └─ MczPoller (periodic polling loop)
            └─ MczBridge (Socket.IO client)
                 ──[Socket.IO]──> app.mcz.it:9000
                    ├── emit("join", {serialNumber, macAddress, type: "Android-App"})
                    ├── emit("chiedo", "C|RecuperoInfo")        ← polling
                    ├── emit("chiedo", "C|WriteParametri|id|v") ← commands
                    └── on("rispondo", handler)                 ← responses
```

## Message Format

### Request (client → cloud)

- Polling: `C|RecuperoInfo`
- Command: `C|WriteParametri|<commandId>|<value>`

### Response (cloud → client)

- Pipe-delimited hex values: `<type>|<hex_0>|<hex_1>|...|<hex_60>`
- Type `01` = main status frame (61 registers)
- Each hex value → `parseInt(hex, 16)` → type-specific interpretation
- Temperatures: raw value ÷ 2

## Data Model Changes

### types.ts

- Add `"mcz_maestro"` to `DeviceSource` union

### constants.ts

- No changes needed (thermostat equipment type already exists)

## New Files

| File                                         | Purpose                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `src/integrations/mcz-maestro/index.ts`      | Main plugin class implementing IntegrationPlugin |
| `src/integrations/mcz-maestro/mcz-bridge.ts` | Socket.IO client wrapping MCZ cloud protocol     |
| `src/integrations/mcz-maestro/mcz-poller.ts` | Polling loop + device discovery + data updates   |
| `src/integrations/mcz-maestro/mcz-types.ts`  | Type definitions, register maps, command maps    |

## Modified Files

| File                  | Change                                |
| --------------------- | ------------------------------------- |
| `src/shared/types.ts` | Add `"mcz_maestro"` to DeviceSource   |
| `src/index.ts`        | Register MczMaestroIntegration plugin |

## MczBridge API

```typescript
class MczBridge {
  constructor(logger: Logger);

  // Connect to MCZ cloud and authenticate
  connect(serialNumber: string, macAddress: string): Promise<void>;

  // Disconnect from cloud
  disconnect(): void;

  // Request full status (returns parsed 61-register frame)
  getStatus(): Promise<MczStatusFrame>;

  // Send a control command
  sendCommand(commandId: number, value: number): Promise<void>;

  // Connection state
  isConnected(): boolean;
}
```

## MczPoller Pattern

Same pattern as PanasonicPoller:

- `start()` → immediate first poll (awaited) + setInterval
- `stop()` → clearInterval + clear pending timers
- `refresh()` → immediate poll
- `scheduleOnDemandPoll()` → delayed poll after order execution
- Concurrent poll prevention via `polling` flag

## Register Decoding

```typescript
// Status frame: 61 registers indexed 0-60
interface MczStatusFrame {
  stoveState: number; // [1] raw state code
  ambientTemperature: number; // [6] ÷2
  targetTemperature: number; // [26] ÷2
  smokeTemperature: number; // [5] raw
  activePower: number; // [29]
  fanAmbient: number; // [2]
  profile: number; // [18]
  regulationMode: number; // [22]
  ecoMode: number; // [23]
  silenceMode: number; // [24]
  pelletSensor: number; // [47]
  ignitionCount: number; // [45]
  sparkPlug: number; // [10]
  boardTemperature: number; // [28] ÷2
}
```

## Enum Mappings

### stoveState

| Raw   | Alias                    |
| ----- | ------------------------ |
| 0     | off                      |
| 1     | checking                 |
| 2-9   | ignition_phase_N         |
| 10    | stabilizing              |
| 11-15 | running_p1 to running_p5 |
| 30    | diagnostic               |
| 31    | running                  |
| 40-49 | shutdown_phase_N         |
| 50-69 | error_A01 to error_A23   |

### profile

| Raw | Alias     |
| --- | --------- |
| 0   | manual    |
| 1   | dynamic   |
| 2   | overnight |
| 3   | comfort   |

### pelletSensor

| Raw | Alias        |
| --- | ------------ |
| 0   | inactive     |
| 10  | sufficient   |
| 11  | almost_empty |

### sparkPlug

| Raw | Alias |
| --- | ----- |
| 0   | ok    |
| 1   | worn  |

## Command Encoding

| Alias             | ID  | Value encoding                         |
| ----------------- | --- | -------------------------------------- |
| targetTemperature | 42  | value × 2                              |
| profile           | 149 | 0-3 (manual/dynamic/overnight/comfort) |
| ecoMode ON        | 41  | 1                                      |
| ecoMode OFF       | 41  | 0                                      |
| resetAlarm        | 1   | 255                                    |

## Device Discovery Mapping

```typescript
function mapToDiscovered(serial: string, frame: MczStatusFrame): DiscoveredDevice {
  return {
    friendlyName: serial, // or user-configurable name
    manufacturer: "MCZ",
    model: "Maestro",
    data: [
      { key: "power", type: "boolean", category: "generic" },
      { key: "stoveState", type: "enum", category: "generic" },
      { key: "ambientTemperature", type: "number", category: "temperature", unit: "°C" },
      { key: "targetTemperature", type: "number", category: "temperature", unit: "°C" },
      { key: "profile", type: "enum", category: "generic" },
      { key: "ecoMode", type: "boolean", category: "generic" },
      { key: "pelletSensor", type: "enum", category: "generic" },
      { key: "ignitionCount", type: "number", category: "generic" },
      { key: "sparkPlug", type: "enum", category: "generic" },
    ],
    orders: [
      {
        key: "targetTemperature",
        type: "number",
        dispatchConfig: { commandId: 42 },
        min: 5,
        max: 40,
        unit: "°C",
      },
      {
        key: "profile",
        type: "enum",
        dispatchConfig: { commandId: 149 },
        enumValues: ["dynamic", "overnight", "comfort"],
      },
      { key: "ecoMode", type: "boolean", dispatchConfig: { commandId: 41 } },
      { key: "resetAlarm", type: "boolean", dispatchConfig: { commandId: 1 } },
    ],
  };
}
```

## Dependencies

- `socket.io-client` (npm package) — Socket.IO v2 compatible client for MCZ cloud

## Event Flow

```
MczPoller polls every 30s
  → MczBridge.getStatus() via Socket.IO
  → Parse hex frame → MczStatusFrame
  → deviceManager.upsertFromDiscovery("mcz_maestro", "mcz_maestro", discovered)
  → deviceManager.updateDeviceData("mcz_maestro", sourceDeviceId, payload)
  → EventBus: "device.data.updated"
  → Equipment bindings update
  → Zone aggregation
  → WebSocket push to UI
```

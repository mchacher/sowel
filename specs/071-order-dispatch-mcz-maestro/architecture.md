# Spec 071 — Architecture

## Current Flow

```
executeOrder(_device, dispatchConfig, value)
  → commandId = dispatchConfig.commandId (from DB)
  → switch(commandId) → rawValue conversion
  → bridge.sendCommand(commandId, rawValue)
```

## Target Flow

```
executeOrder(device, orderKey, value)
  → commandId = ORDER_KEY_TO_COMMAND[orderKey] (static map)
  → switch(commandId) → rawValue conversion
  → bridge.sendCommand(commandId, rawValue)
```

## File Changes

### sowel-plugin-mcz-maestro/src/index.ts

1. **Local interfaces**: update IntegrationPlugin (apiVersion, new executeOrder signature), DiscoveredDevice (dispatchConfig optional)
2. **Plugin class**: add `readonly apiVersion = 2`
3. **Static map**: add `ORDER_KEY_TO_COMMAND` constant mapping orderKey → commandId
4. **executeOrder**: change signature to `(device, orderKey, value)`, resolve commandId from static map
5. **Discovery** (`mapFrameToDiscovered`): remove `dispatchConfig` from orders
6. **Categories**: `power` → `"power"`, `targetTemperature` → `"setpoint"`

### Sowel core

No changes needed — core already supports apiVersion 2 (spec 067) and setpoint category (spec 070).

## Static Map

```typescript
const ORDER_KEY_TO_COMMAND: Record<string, number> = {
  power: COMMAND_ID.POWER,
  targetTemperature: COMMAND_ID.TARGET_TEMPERATURE,
  profile: COMMAND_ID.PROFILE,
  ecoMode: COMMAND_ID.ECO_MODE,
  resetAlarm: COMMAND_ID.RESET_ALARM,
};
```

No dynamic discovery needed — MCZ command IDs are protocol constants.

## Database

No schema change. dispatch_config column written as `'{}'` for v2 plugins.

## Events / API / UI

No changes.

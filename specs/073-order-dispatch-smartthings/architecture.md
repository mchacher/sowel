# Spec 073 — Architecture

## Current Flow

```
executeOrder(_device, dispatchConfig, value)
  → command = dispatchConfig.command (from DB)
  → switch(command) → SmartThings API call
```

## Target Flow

```
executeOrder(device, orderKey, value)
  → command = ORDER_KEY_TO_COMMAND[orderKey] (static map)
  → switch(command) → SmartThings API call
```

## File Changes

### sowel-plugin-smartthings/src/index.ts

1. **Local interfaces**: update IntegrationPlugin (apiVersion, new executeOrder signature), DiscoveredDevice (dispatchConfig optional)
2. **Plugin class**: add `readonly apiVersion = 2`
3. **Static map**: `ORDER_KEY_TO_COMMAND` — orderKey → SmartThings command name
4. **executeOrder**: change signature, resolve command from static map
5. **Discovery**: remove `dispatchConfig` from orders

### Static Map

```typescript
const ORDER_KEY_TO_COMMAND: Record<string, string> = {
  power: "switch",
  mute: "mute",
  input_source: "setInputSource",
};
```

### Sowel core

No changes needed.

## Database / Events / API / UI

No changes.

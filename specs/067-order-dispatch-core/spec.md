# Spec 067 — Order Dispatch: Core Refactoring + LoRa2MQTT Migration

## Summary

Refactor the order dispatch mechanism so that plugins receive `(device, orderKey, value)` instead of `(device, dispatchConfig, value)`. The core no longer stores or manipulates transport-specific metadata (MQTT topics, cloud API IDs). Each plugin is responsible for knowing how to translate a generic order into its own protocol.

This spec includes the first plugin migration (lora2mqtt) to validate the new architecture end-to-end.

## Problem

The current `dispatchConfig` is a JSON blob stored in `device_orders` that contains integration-specific transport details (MQTT topics, payload keys, cloud API IDs). The core stores it at discovery time and passes it blindly to plugins at execution time. This caused multiple bugs:

- **topicSuffix vs topic**: changing the dispatch format in the plugin broke all existing orders in DB
- **base_topic baked in DB**: MQTT topics were frozen at discovery time, breaking when settings changed
- **No validation**: the core can't validate or migrate a blob it doesn't understand

## Requirements

### R1 — New executeOrder signature

The `IntegrationPlugin.executeOrder` method signature changes from:

```typescript
executeOrder(device: Device, dispatchConfig: Record<string, unknown>, value: unknown): Promise<void>;
```

to:

```typescript
executeOrder(device: Device, orderKey: string, value: unknown): Promise<void>;
```

The plugin receives the device identity + order key + value. It handles transport internally.

### R2 — Backward compatibility

During the migration period (specs 067–073), the core must support both signatures:

- **New plugins** (v2 signature): receive `(device, orderKey, value)`
- **Old plugins** (v1 signature): receive `(device, dispatchConfig, value)` as before

Detection: the plugin can declare its API version in the manifest (`apiVersion: 2`), or the core can check the function signature length (2 params vs 3 params — unreliable). **Preferred: manifest field `apiVersion`.**

### R3 — DiscoveredDevice.orders without dispatchConfig

Plugins using the new API no longer provide `dispatchConfig` in `DiscoveredDevice.orders`. The field becomes optional:

```typescript
orders: {
  key: string;
  type: DataType;
  dispatchConfig?: Record<string, unknown>; // deprecated, ignored for apiVersion 2
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}[];
```

### R4 — Equipment manager passes orderKey

When dispatching to a v2 plugin, the equipment manager passes the `orderKey` (from `device_orders.key`) instead of the parsed `dispatch_config`.

### R5 — LoRa2MQTT migration

The lora2mqtt plugin is migrated to the new signature:

- Discovery: no more `dispatchConfig` in orders
- `executeOrder`: constructs the MQTT topic at runtime from `baseTopic + device.sourceDeviceId + /set` and the payload from `{ [orderKey]: value }`
- Manifest: `apiVersion: 2`

### R6 — dispatch_config column preserved

The `dispatch_config` column in `device_orders` is NOT removed. It continues to be written for v1 plugins (retro-compat) and ignored for v2 plugins. Removal happens in spec 074.

## Acceptance Criteria

- [ ] `IntegrationPlugin` interface supports both v1 and v2 signatures
- [ ] Equipment manager detects plugin API version and dispatches accordingly
- [ ] v1 plugins (all except lora2mqtt) continue to work unchanged
- [ ] lora2mqtt plugin uses new signature and works end-to-end (orders reach devices)
- [ ] Discovery from lora2mqtt no longer provides dispatchConfig
- [ ] All existing tests pass
- [ ] Manual test: send order to lora2mqtt device (gate, light) from UI — works

## Out of scope

- Migration of other plugins (specs 068–073)
- Removal of dispatch_config column (spec 074)
- UI changes (none needed — the UI doesn't display dispatchConfig for orders)

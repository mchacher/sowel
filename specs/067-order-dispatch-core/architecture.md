# Spec 067 — Architecture

## Current Flow

```
Equipment order (alias: "state", value: "OPEN")
  → EquipmentManager.executeOrder
    → Lookup OrderBinding by alias → get DeviceOrder
    → Parse dispatch_config JSON from device_orders table
    → integrationRegistry.dispatchOrder(device, dispatchConfig, value)
      → plugin.executeOrder(device, dispatchConfig, value)
```

## Target Flow

```
Equipment order (alias: "state", value: "OPEN")
  → EquipmentManager.executeOrder
    → Lookup OrderBinding by alias → get DeviceOrder
    → Check plugin apiVersion
    → If v2: integrationRegistry.dispatchOrder(device, orderKey, value)
      → plugin.executeOrder(device, orderKey, value)
    → If v1: integrationRegistry.dispatchOrder(device, dispatchConfig, value)  [retro-compat]
      → plugin.executeOrder(device, dispatchConfig, value)
```

## File Changes

### 1. `src/shared/plugin-api.ts`

Add `apiVersion` to plugin interface:

```typescript
interface IntegrationPlugin {
  readonly id: string;
  readonly name: string;
  readonly apiVersion?: number; // 1 (default) or 2
  // ...
  executeOrder(
    device: Device,
    orderKeyOrDispatchConfig: string | Record<string, unknown>,
    value: unknown,
  ): Promise<void>;
}
```

### 2. `src/integrations/integration-registry.ts`

Update `dispatchOrder` to check apiVersion:

```typescript
async dispatchOrder(
  integrationId: string,
  device: Device,
  orderKey: string,
  dispatchConfig: Record<string, unknown>,
  value: unknown,
): Promise<void> {
  const plugin = this.plugins.get(integrationId);
  if (!plugin) throw new Error(`Integration not found: ${integrationId}`);

  if ((plugin.apiVersion ?? 1) >= 2) {
    await plugin.executeOrder(device, orderKey, value);
  } else {
    await plugin.executeOrder(device, dispatchConfig as any, value);
  }
}
```

### 3. `src/equipments/equipment-manager.ts`

Pass both orderKey and dispatchConfig to the registry (it decides which to use):

```typescript
// In executeOrder method, after resolving the binding:
const orderKey = binding.key;
const dispatchConfig = binding.dispatch_config ? JSON.parse(binding.dispatch_config) : {};

await integration.dispatchOrder(
  device.integrationId,
  device,
  orderKey,
  dispatchConfig,
  resolvedValue,
);
```

### 4. `src/shared/types.ts`

Make `dispatchConfig` optional in `DiscoveredDevice.orders`:

```typescript
orders: {
  key: string;
  type: DataType;
  dispatchConfig?: Record<string, unknown>; // v1 only, deprecated
  min?: number;
  max?: number;
  enumValues?: string[];
  unit?: string;
}[];
```

### 5. `src/devices/device-manager.ts`

Handle optional dispatchConfig in upsertFromDiscovery:

```typescript
// In the order upsert loop:
const dispatchConfig = o.dispatchConfig ? JSON.stringify(o.dispatchConfig) : null;
```

### 6. LoRa2MQTT plugin (`sowel-plugin-lora2mqtt`)

```typescript
// manifest.json
{ "apiVersion": 2, ... }

// Discovery — no dispatchConfig
orders.push({
  key, type: dataType,
  enumValues: meta.values,
  // NO dispatchConfig
});

// executeOrder — new signature
async executeOrder(_device: Device, orderKey: string, value: unknown): Promise<void> {
  if (!this.mqttConnector?.isConnected()) throw new Error("MQTT not connected");
  const baseTopic = this.getSetting("base_topic") ?? "lora2mqtt";
  const topic = `${baseTopic}/${_device.sourceDeviceId}/set`;
  const payload = JSON.stringify({ [orderKey]: value });
  this.mqttConnector.publish(topic, payload);
}
```

## Database

No schema change. The `dispatch_config` column in `device_orders` remains. For v2 plugins, it will be written as `null` during discovery. Existing non-null values are preserved for v1 retro-compat.

## API

No API changes. The `dispatchConfig` field in API responses (`DeviceOrder`, `OrderBindingWithDetails`) becomes nullable. Frontend impact: minimal — only `DeviceDetailPage.tsx` displays it (shows "—" when null).

## Events

No new events.

## Risks

- **Plugin detection**: using manifest `apiVersion` is explicit and reliable
- **Mixed state during migration**: some plugins v1, some v2 — core handles both
- **DB null dispatch_config**: v1 plugins that haven't been re-discovered might have stale data — acceptable, they still work with old dispatchConfig

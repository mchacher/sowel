# Spec 074 — Order Dispatch: Final Cleanup

**Depends on**: specs 067-077 (all plugins migrated to apiVersion 2 + order categories)

## Summary

Remove all v1 retro-compatibility code, the `dispatchConfig` concept, the `apiVersion` routing, legacy DB columns, and the brute-force zone order fallback. The order dispatch system is now fully based on `(device, orderKey, value)` with order categories for zone order resolution.

## Changes

### Remove from types

- `dispatchConfig` from `DeviceOrder`, `OrderBindingWithDetails`, `DiscoveredDevice.orders`
- `apiVersion` from `PluginManifest` and `IntegrationPlugin`
- Same in `ui/src/types.ts`

### Remove from code

- `IntegrationRegistry.dispatchOrder()` — remove v1/v2 routing, always pass orderKey
- `EquipmentManager.executeOrder()` — remove dispatchConfig parsing
- `EquipmentManager.rowToOrderBindingWithDetails()` — remove dispatchConfig parsing
- `EquipmentManager.executeZoneOrder()` — remove brute-force fallback
- `DeviceManager.upsertFromDiscovery()` — remove dispatchConfig serialization
- `DeviceManager.rowToDeviceOrder()` — remove dispatchConfig parsing
- `DeviceDetailPage.tsx` — remove dispatchConfig.topic display

### Database migration

- Drop columns `dispatch_config`, `mqtt_set_topic`, `payload_key` from `device_orders`
- SQLite doesn't support DROP COLUMN directly — requires table rebuild

### Simplify IntegrationPlugin interface

```typescript
executeOrder(device: Device, orderKey: string, value: unknown): Promise<void>;
```

No more union type `string | Record<string, unknown>`.

## Acceptance Criteria

- [ ] No reference to `dispatchConfig` in codebase (src/ and ui/src/)
- [ ] No reference to `apiVersion` in plugin interface
- [ ] No brute-force fallback in executeZoneOrder
- [ ] DB columns `dispatch_config`, `mqtt_set_topic`, `payload_key` dropped
- [ ] TypeScript compiles, all tests pass
- [ ] Zone orders work via order category only
- [ ] Individual orders work via orderKey only

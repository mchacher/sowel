# Spec 069 — Order Dispatch: Legrand Control Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the legrand-control plugin to `executeOrder(device, orderKey, value)`. The plugin stores cloud API metadata (`homeId`, `moduleId`, `param`, `bridge`) in an in-memory Map during discovery, and looks it up by `sourceDeviceId + orderKey` at execution time.

## Problem

The current `dispatchConfig` stores Legrand cloud API identifiers:

```json
{ "homeId": "abc", "moduleId": "xyz", "param": "on", "bridge": "gw1" }
```

These are baked into `device_orders` at discovery time. The plugin should own this data internally.

## Changes

- `apiVersion: 2` on plugin class
- New `orderMeta` Map populated during discovery: `sourceDeviceId:orderKey → {homeId, moduleId, param, bridge?}`
- `executeOrder(device, orderKey, value)`: looks up metadata from Map
- Discovery: orders without `dispatchConfig`
- Local interfaces updated

## Acceptance Criteria

- [ ] Plugin declares `apiVersion: 2`
- [ ] Discovery no longer provides dispatchConfig
- [ ] `executeOrder` uses internal Map to resolve cloud API IDs
- [ ] Map is populated on every discovery poll
- [ ] Build succeeds
- [ ] Manual test: toggle Legrand light on/off
- [ ] Manual test: set Legrand shutter position
- [ ] Released as legrand-control v2.0.0
- [ ] Registry updated

## Out of scope

- legrand-energy (read-only, no executeOrder)

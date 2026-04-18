# Spec 071 — Order Dispatch: MCZ Maestro Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the MCZ Maestro plugin to `executeOrder(device, orderKey, value)`. The plugin resolves `commandId` from a static map (orderKey → commandId) since command IDs are constants defined in the MCZ protocol. Also standardize thermostat categories (`power` → `"power"`, `targetTemperature` → `"setpoint"`).

## Problem

The current `dispatchConfig` stores `{ commandId: 34 }` — a fixed MCZ protocol constant. Unlike cloud API plugins (Legrand, Panasonic) where metadata is discovered at runtime, MCZ command IDs are hardcoded constants. The dispatchConfig is unnecessary — the plugin can resolve commandId directly from the orderKey.

## Changes

- `apiVersion: 2` on plugin class
- Static map `ORDER_KEY_TO_COMMAND_ID` replacing dispatchConfig
- `executeOrder(device, orderKey, value)`: resolves commandId from static map
- Discovery: orders without `dispatchConfig`
- Category fixes: `power` → `"power"`, `targetTemperature` → `"setpoint"`
- Local interfaces updated

## Acceptance Criteria

- [x] Plugin declares `apiVersion: 2`
- [x] Discovery no longer provides dispatchConfig
- [x] `executeOrder` resolves commandId from static map
- [x] Categories standardized (power, setpoint)
- [x] Build succeeds
- [x] Manual test: power on/off poêle
- [x] Manual test: change setpoint
- [ ] Released as mcz-maestro v2.0.0
- [ ] Registry updated

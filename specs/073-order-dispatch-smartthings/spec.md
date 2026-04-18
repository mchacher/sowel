# Spec 073 — Order Dispatch: SmartThings Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the SmartThings plugin to `executeOrder(device, orderKey, value)`. The plugin uses a static map to resolve orderKey to SmartThings API command name (e.g. `"power"` → `"switch"`, `"input_source"` → `"setInputSource"`).

## Problem

The current `dispatchConfig` stores `{ command: "switch" }` — a static mapping between order key and SmartThings API command. The plugin can resolve this internally without DB storage.

## Changes

- `apiVersion: 2` on plugin class
- Static map `ORDER_KEY_TO_COMMAND` replacing dispatchConfig
- `executeOrder(device, orderKey, value)`: resolves command from static map
- Discovery: orders without `dispatchConfig`
- Local interfaces updated

## Acceptance Criteria

- [x] Plugin declares `apiVersion: 2`
- [x] Discovery no longer provides dispatchConfig
- [x] `executeOrder` resolves command from static map
- [x] Categories standardized (power, media_volume, media_mute, media_input, appliance_state)
- [x] New DataCategories added to core (setpoint, media\_\*, appliance_state)
- [x] Build succeeds
- [ ] Released as smartthings v2.0.0
- [ ] Registry updated

## Notes

- Washer devices are data-only (no orders) — not impacted
- TV orders: power (switch), mute, input_source (setInputSource)
- No category changes needed (no thermostat equipment in SmartThings)

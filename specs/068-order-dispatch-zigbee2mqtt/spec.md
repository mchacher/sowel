# Spec 068 — Order Dispatch: Zigbee2MQTT Migration

**Depends on**: spec 067 (core refactoring)

## Status: DONE (zigbee2mqtt v2.0.0)

## Summary

Migrate the zigbee2mqtt plugin to the new `executeOrder(device, orderKey, value)` signature. Remove dispatchConfig from discovery and executeOrder. The plugin constructs MQTT topics at runtime from `baseTopic + device.sourceDeviceId + /set`.

## Changes

- `apiVersion: 2` added to plugin class
- `executeOrder` rewritten: `(device, orderKey, value)` — topic from baseTopic + sourceDeviceId
- `dispatchConfig` removed from z2m-parser discovery (orders no longer include topicSuffix/payloadKey)
- Composite payload support preserved (objects published as-is for multi-key commands like on_time)
- Local interfaces updated (`IntegrationPlugin`, `DiscoveredDevice`)

## Acceptance Criteria

- [x] Plugin declares `apiVersion: 2`
- [x] Discovery no longer provides dispatchConfig
- [x] executeOrder uses `device.sourceDeviceId` + `orderKey`
- [x] Composite payload support works (object values published directly)
- [x] Build succeeds
- [x] Manual test: shutter open/close from zone commands — works
- [x] Manual test: individual light toggle — works
- [x] Released as zigbee2mqtt v2.0.0
- [x] Registry updated (`sowelVersion: >=1.2.8`)

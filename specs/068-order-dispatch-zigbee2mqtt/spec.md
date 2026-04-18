# Spec 068 — Order Dispatch: Zigbee2MQTT Migration

**Depends on**: spec 067 (core refactoring)

## Summary

Migrate the zigbee2mqtt plugin to the new `executeOrder(device, orderKey, value)` signature. Remove dispatchConfig from discovery and executeOrder. The plugin constructs MQTT topics at runtime from `baseTopic + device.sourceDeviceId + /set`.

## Status: Planned

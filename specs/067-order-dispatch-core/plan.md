# Spec 067 — Implementation Plan

## Status: DONE (v1.2.8 + lora2mqtt v2.0.0)

## Phase 1: Core changes (Sowel)

- [x] 1.1 Update `IntegrationPlugin` interface in `integration-registry.ts` — add optional `apiVersion`
- [x] 1.2 Update `DiscoveredDevice` orders — make `dispatchConfig` optional
- [x] 1.3 Update `IntegrationRegistry.dispatchOrder` — accept both orderKey and dispatchConfig, route based on apiVersion
- [x] 1.4 Update `EquipmentManager.executeOrder` — pass orderKey + dispatchConfig to registry
- [x] 1.5 Update `DeviceManager.upsertFromDiscovery` — handle null dispatchConfig
- [x] 1.6 Update types: `DeviceOrder.dispatchConfig` becomes optional, `OrderBindingWithDetails.dispatchConfig` becomes optional
- [x] 1.7 PluginLoader — no change needed (plugin declares apiVersion on its class, registry reads it)
- [x] 1.8 Write tests (see Test Plan below) — 8 new tests
- [x] 1.9 TypeScript compiles, all 327 tests pass, lint clean

## Phase 2: LoRa2MQTT plugin migration

- [x] 2.1 Add `apiVersion: 2` to plugin class + manifest.json
- [x] 2.2 Remove `dispatchConfig` from `parseNode` discovery
- [x] 2.3 Rewrite `executeOrder` to use `(device, orderKey, value)` — construct topic from baseTopic + device.sourceDeviceId
- [x] 2.4 Remove `topicSuffix` handling (no longer needed)
- [x] 2.5 Build and test locally
- [x] 2.6 Release lora2mqtt v2.0.0

## Phase 3: Validation

- [x] 3.1 Test locally (swap local instance)
- [x] 3.2 Manual test: open/close gate (lora2mqtt order) — works
- [x] 3.3 Manual test: toggle garage light (lora2mqtt order) — works
- [x] 3.4 Verify all other plugins (v1) still work unchanged — works
- [x] 3.5 Verify z2m shutter commands still work (v1 retro-compat) — works

## Bonus fix (discovered during implementation)

- [x] Enum values resolved case-insensitively — zone order "ON" matches device enum "on"

---

## Test Plan

### Modules to test

- `equipment-manager` — order dispatch routing (v1 vs v2)
- `integration-registry` — dispatchOrder with apiVersion detection
- `device-manager` — upsertFromDiscovery with optional dispatchConfig

### Scenarios

| Module                   | Scenario                                            | Expected                                                     | Status                      |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------ | --------------------------- |
| **equipment-manager**    | Zone order dispatches to v2 plugin (apiVersion=2)   | `executeOrder` called with `(device, orderKey, value)`       | [x]                         |
| **equipment-manager**    | Zone order dispatches to v1 plugin (no apiVersion)  | `executeOrder` called with `(device, dispatchConfig, value)` | [x]                         |
| **equipment-manager**    | Single equipment order to v2 plugin                 | `executeOrder` called with `(device, orderKey, value)`       | [x]                         |
| **equipment-manager**    | Single equipment order to v1 plugin                 | `executeOrder` called with `(device, dispatchConfig, value)` | [x]                         |
| **equipment-manager**    | Plugin not connected                                | Throws "not connected" error                                 | [x] (pre-existing)          |
| **equipment-manager**    | Order binding with null dispatch_config (v1 plugin) | `dispatchConfig` passed as `{}` (empty object)               | [x]                         |
| **equipment-manager**    | Enum value resolved case-insensitively              | "ON" → "on" when device has enum ["on", "off"]               | [x]                         |
| **integration-registry** | dispatchOrder to v2 plugin                          | Forwards `orderKey` string, not dispatchConfig               | [x]                         |
| **integration-registry** | dispatchOrder to v1 plugin                          | Forwards `dispatchConfig` object, not orderKey               | [x]                         |
| **integration-registry** | dispatchOrder to unknown integration                | Throws "not found" error                                     | [x]                         |
| **integration-registry** | dispatchOrder to explicit v1 plugin (apiVersion=1)  | Forwards dispatchConfig                                      | [x]                         |
| **device-manager**       | upsertFromDiscovery with dispatchConfig (v1)        | Stores JSON in dispatch_config column                        | (covered by existing tests) |
| **device-manager**       | upsertFromDiscovery without dispatchConfig (v2)     | Stores null in dispatch_config column                        | (covered by existing tests) |

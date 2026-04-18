# Spec 067 — Implementation Plan

## Phase 1: Core changes (Sowel)

- [ ] 1.1 Update `IntegrationPlugin` interface in `plugin-api.ts` — add optional `apiVersion`
- [ ] 1.2 Update `DiscoveredDevice` orders — make `dispatchConfig` optional
- [ ] 1.3 Update `IntegrationRegistry.dispatchOrder` — accept both orderKey and dispatchConfig, route based on apiVersion
- [ ] 1.4 Update `EquipmentManager.executeOrder` — pass orderKey + dispatchConfig to registry
- [ ] 1.5 Update `DeviceManager.upsertFromDiscovery` — handle null dispatchConfig
- [ ] 1.6 Update types: `DeviceOrder.dispatchConfig` becomes optional, `OrderBindingWithDetails.dispatchConfig` becomes optional
- [ ] 1.7 Update `PluginLoader` — read `apiVersion` from manifest and pass to plugin
- [ ] 1.8 Write tests (see Test Plan below)
- [ ] 1.9 TypeScript compiles, all tests pass, lint clean

## Phase 2: LoRa2MQTT plugin migration

- [ ] 2.1 Add `apiVersion: 2` to manifest.json
- [ ] 2.2 Remove `dispatchConfig` from `parseNode` discovery
- [ ] 2.3 Rewrite `executeOrder` to use `(device, orderKey, value)` — construct topic from baseTopic + device.sourceDeviceId
- [ ] 2.4 Remove `topicSuffix` handling (no longer needed)
- [ ] 2.5 Build and test locally
- [ ] 2.6 Release lora2mqtt v2.0.0

## Phase 3: Validation

- [ ] 3.1 Deploy Sowel + lora2mqtt v2.0.0 to prod
- [ ] 3.2 Manual test: open/close gate (lora2mqtt order)
- [ ] 3.3 Manual test: toggle garage light (lora2mqtt order)
- [ ] 3.4 Verify all other plugins (v1) still work unchanged
- [ ] 3.5 Verify z2m shutter commands still work (v1 retro-compat)

---

## Test Plan

### Modules to test

- `equipment-manager` — order dispatch routing (v1 vs v2)
- `integration-registry` — dispatchOrder with apiVersion detection
- `device-manager` — upsertFromDiscovery with optional dispatchConfig

### Scenarios

| Module                   | Scenario                                                | Expected                                                     |
| ------------------------ | ------------------------------------------------------- | ------------------------------------------------------------ |
| **equipment-manager**    | Zone order dispatches to v2 plugin (apiVersion=2)       | `executeOrder` called with `(device, orderKey, value)`       |
| **equipment-manager**    | Zone order dispatches to v1 plugin (no apiVersion)      | `executeOrder` called with `(device, dispatchConfig, value)` |
| **equipment-manager**    | Single equipment order to v2 plugin                     | `executeOrder` called with `(device, orderKey, value)`       |
| **equipment-manager**    | Single equipment order to v1 plugin                     | `executeOrder` called with `(device, dispatchConfig, value)` |
| **equipment-manager**    | Plugin not connected                                    | Throws "not connected" error                                 |
| **equipment-manager**    | Order binding with null dispatch_config (v1 plugin)     | `dispatchConfig` passed as `{}` (empty object)               |
| **integration-registry** | dispatchOrder to v2 plugin                              | Forwards `orderKey` string, not dispatchConfig               |
| **integration-registry** | dispatchOrder to v1 plugin                              | Forwards `dispatchConfig` object, not orderKey               |
| **integration-registry** | dispatchOrder to unknown integration                    | Throws "not found" error                                     |
| **device-manager**       | upsertFromDiscovery with dispatchConfig (v1)            | Stores JSON in dispatch_config column                        |
| **device-manager**       | upsertFromDiscovery without dispatchConfig (v2)         | Stores null in dispatch_config column                        |
| **device-manager**       | upsertFromDiscovery updates existing order (v2 over v1) | dispatch_config set to null, other fields preserved          |
| **device-manager**       | upsertFromDiscovery updates existing order (v1 over v2) | dispatch_config restored from v1 discovery                   |

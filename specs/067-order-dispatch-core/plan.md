# Spec 067 — Implementation Plan

## Phase 1: Core changes (Sowel)

- [ ] 1.1 Update `IntegrationPlugin` interface in `plugin-api.ts` — add optional `apiVersion`
- [ ] 1.2 Update `DiscoveredDevice` orders — make `dispatchConfig` optional
- [ ] 1.3 Update `IntegrationRegistry.dispatchOrder` — accept both orderKey and dispatchConfig, route based on apiVersion
- [ ] 1.4 Update `EquipmentManager.executeOrder` — pass orderKey + dispatchConfig to registry
- [ ] 1.5 Update `DeviceManager.upsertFromDiscovery` — handle null dispatchConfig
- [ ] 1.6 Update types: `DeviceOrder.dispatchConfig` becomes optional, `OrderBindingWithDetails.dispatchConfig` becomes optional
- [ ] 1.7 Update `PluginLoader` — read `apiVersion` from manifest and pass to plugin
- [ ] 1.8 Update tests — adjust existing equipment-manager tests for new dispatch flow
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

## Testing Strategy

- Existing equipment-manager tests cover the dispatch flow — update them to test both v1 and v2 paths
- No new test files needed — this is a refactoring of existing behavior
- Manual validation on prod is critical (lora2mqtt + z2m retro-compat)

# Spec 074 — Implementation Plan

## Tasks

- [ ] 1. Migration 004 — rebuild device_orders without dispatch_config, mqtt_set_topic, payload_key
- [ ] 2. Remove dispatchConfig + apiVersion from types.ts (backend + frontend)
- [ ] 3. Simplify IntegrationPlugin.executeOrder to `(device, orderKey, value)`
- [ ] 4. Simplify IntegrationRegistry.dispatchOrder — remove v1 routing
- [ ] 5. Clean EquipmentManager.executeOrder — remove dispatchConfig parsing
- [ ] 6. Clean EquipmentManager.executeZoneOrder — remove brute-force fallback
- [ ] 7. Clean EquipmentManager.rowToOrderBindingWithDetails — remove dispatchConfig
- [ ] 8. Clean DeviceManager — remove dispatchConfig from DiscoveredDevice + upsert
- [ ] 9. Clean DeviceDetailPage.tsx — remove topic column
- [ ] 10. Update all test files — remove dispatchConfig from seedDevice + test data
- [ ] 11. Update test for IntegrationRegistry — remove v1 tests
- [ ] 12. Validate: typecheck, tests, lint
- [ ] 13. Mark spec done

---

## Test Plan

### Modules to test

- `equipment-manager` — order dispatch without dispatchConfig
- `integration-registry` — dispatchOrder always passes orderKey
- `device-manager` — upsert without dispatchConfig

### Scenarios

| Module                   | Scenario                                    | Expected                                   |
| ------------------------ | ------------------------------------------- | ------------------------------------------ |
| **equipment-manager**    | executeOrder dispatches with orderKey only  | No dispatchConfig parsing, direct orderKey |
| **equipment-manager**    | Zone order finds by order category          | Category-based lookup, no fallback         |
| **equipment-manager**    | Zone order skips equipment without category | Skipped, no brute-force                    |
| **integration-registry** | dispatchOrder always passes orderKey        | No v1/v2 routing                           |
| **integration-registry** | dispatchOrder to unknown integration        | Throws error                               |
| **device-manager**       | upsertFromDiscovery without dispatchConfig  | No dispatch_config column                  |
| **device-manager**       | upsertFromDiscovery with category           | category stored correctly                  |

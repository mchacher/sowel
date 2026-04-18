# Spec 077 — Implementation Plan

## Phase 1: Core (Sowel)

- [ ] 1.1 Add `OrderCategory` type to `src/shared/types.ts`
- [ ] 1.2 Add `category?: OrderCategory` to `DeviceOrder` and `OrderBindingWithDetails`
- [ ] 1.3 Mirror types in `ui/src/types.ts`
- [ ] 1.4 Create migration `003_device_order_category.sql`
- [ ] 1.5 Update `device-manager.ts` — DiscoveredDevice, upsert SQL
- [ ] 1.6 Update `equipment-manager.ts` — OrderBindingJoinRow, SQL queries, row mapper
- [ ] 1.7 Update `equipment-manager.ts` — ZONE_ORDERS with `orderCategory`, category-based resolution
- [ ] 1.8 Write tests
- [ ] 1.9 TypeScript compiles, all tests pass, lint clean

## Phase 2: Plugins

- [ ] 2.1 zigbee2mqtt — add order categories in z2m-parser discovery
- [ ] 2.2 lora2mqtt — add order categories in parseNode
- [ ] 2.3 legrand-control — add order categories in mapModuleToDiscovered
- [ ] 2.4 panasonic-cc — add order categories in mapDeviceToDiscovered
- [ ] 2.5 mcz-maestro — add order categories in mapFrameToDiscovered
- [ ] 2.6 smartthings — add order categories in buildDiscoveredDevice
- [ ] 2.7 Build all plugins

## Phase 3: Validation

- [ ] 3.1 Test local: zone allLightsOn/Off (z2m + Legrand + lora)
- [ ] 3.2 Test local: zone allShuttersOpen/Close (z2m + Legrand)
- [ ] 3.3 Test local: zone allThermostatsPowerOn/Off (Panasonic + MCZ)
- [ ] 3.4 Test local: individual orders still work
- [ ] 3.5 Release core + all plugins

---

## Test Plan

### Modules to test

- `equipment-manager` — zone order dispatch via order category
- `device-manager` — upsert with order category
- `integration-registry` — unchanged (apiVersion routing already tested)

### Scenarios

| Module                | Scenario                                                              | Expected                                             |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| **equipment-manager** | Zone allLightsOn — light with category `light_toggle`                 | Finds order by category, executes with ON            |
| **equipment-manager** | Zone allLightsOff — light with category `light_toggle`                | Finds order by category, executes with OFF           |
| **equipment-manager** | Zone allShuttersOpen — shutter with category `shutter_move`           | Finds order by category, executes with OPEN          |
| **equipment-manager** | Zone allShuttersClose — shutter with category `shutter_move`          | Finds order by category, executes with CLOSE         |
| **equipment-manager** | Zone allThermostatsPowerOn — thermostat with category `toggle_power`  | Finds order by category, executes with true          |
| **equipment-manager** | Zone allThermostatsSetpoint — thermostat with category `set_setpoint` | Finds order by category, executes with numeric value |
| **equipment-manager** | Zone order on equipment without matching order category               | Skipped with debug log                               |
| **equipment-manager** | Zone order with brute-force fallback (no category on old orders)      | Falls back to trying each binding                    |
| **equipment-manager** | Enum case-insensitive resolution still works                          | ON → on when device has enum ["on","off"]            |
| **device-manager**    | upsertFromDiscovery with order category                               | category stored in device_orders                     |
| **device-manager**    | upsertFromDiscovery without order category                            | category stored as null                              |
| **device-manager**    | upsertFromDiscovery updates existing order category                   | category updated                                     |

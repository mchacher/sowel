# Spec 079 — Implementation Plan

## Task Breakdown

### Phase 1: Types + Migration

- [ ] 1.1 Add `enum_values` column to `device_data` via migration 005
- [ ] 1.2 Add `enumValues` to `DiscoveredDevice.data` entries in `src/shared/types.ts`
- [ ] 1.3 Add `enumValues` to `DataBindingWithValue` in `src/shared/types.ts`
- [ ] 1.4 Mirror in `ui/src/types.ts`

### Phase 2: Backend

- [ ] 2.1 Device Manager: store `enum_values` on INSERT/UPDATE of device_data
- [ ] 2.2 Device Manager: read `enum_values` in DeviceDataRow + mapper
- [ ] 2.3 Equipment Manager: include `dd.enum_values` in data binding SQL query
- [ ] 2.4 Equipment Manager: parse `enum_values` in data binding mapper
- [ ] 2.5 Write tests

### Phase 3: Z2M Plugin

- [ ] 3.1 z2m-parser: add `enumValues: expose.values` to data entries for enum-type properties

### Phase 4: Frontend

- [ ] 4.1 ButtonActionsSection: read action enum values from equipment data bindings
- [ ] 4.2 Replace hardcoded BUTTON_ACTIONS with dynamic values (fallback to defaults)

### Phase 5: Validate

- [ ] 5.1 `npx tsc --noEmit` (backend)
- [ ] 5.2 `cd ui && npx tsc -b --noEmit` (frontend)
- [ ] 5.3 `npx vitest run` (all tests pass)
- [ ] 5.4 `npx eslint src/ --ext .ts` (zero errors)

## Test Plan

### Modules to test

- `device-manager` — enum values stored and read for device data
- `equipment-manager` — enum values included in data binding response

### Scenarios

| Module            | Scenario                                             | Expected                                 |
| ----------------- | ---------------------------------------------------- | ---------------------------------------- |
| device-manager    | Discover device with enum data (action)              | enum_values stored in device_data        |
| device-manager    | Discover device without enum data (temperature)      | enum_values is null                      |
| device-manager    | Re-discover updates enum_values                      | enum_values updated                      |
| equipment-manager | Data binding for enum device data                    | DataBindingWithValue includes enumValues |
| equipment-manager | Data binding for non-enum device data                | enumValues is undefined                  |
| equipment-manager | Existing bindings without enum_values (retro-compat) | enumValues is undefined, no crash        |

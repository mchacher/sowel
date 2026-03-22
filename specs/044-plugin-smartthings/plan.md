# Implementation Plan: Plugin SmartThings

## Tasks

### Phase 1: Sowel core — new equipment types

1. [ ] Add `media_player` and `appliance` to `EquipmentType` in `types.ts`
2. [ ] Add to `VALID_EQUIPMENT_TYPES` in `equipment-manager.ts`
3. [ ] Add device compatibility categories in `DeviceSelector.tsx`
4. [ ] Update documentation (`docs/user/equipments.md`)
5. [ ] Type-check, commit on main

### Phase 2: Plugin — sowel-plugin-smartthings

6. [ ] Create repo `sowel-plugin-smartthings`
7. [ ] Implement plugin: manifest, createPlugin, SmartThings poller
8. [ ] Device discovery from `GET /v1/devices`
9. [ ] Data polling: washer capabilities → device data
10. [ ] Data polling: TV capabilities → device data
11. [ ] Order execution: TV commands (power, volume, mute, input source)
12. [ ] Create GitHub release with tarball
13. [ ] Add to `plugins/registry.json` in Sowel repo

### Phase 3: Test & validate

14. [ ] Install plugin from store
15. [ ] Verify washer device discovered with correct data
16. [ ] Verify TV device discovered with correct data
17. [ ] Create media_player equipment, verify auto-binding
18. [ ] Create appliance equipment, verify auto-binding
19. [ ] Test TV orders (power, volume, input source)
20. [ ] Test state-watch recipe on washer state change

## Testing

- Requires real SmartThings account with PAT
- Washer WW90T684DLH and Neo QLED QE65QN97A confirmed working via API

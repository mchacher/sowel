# V0.8: Presence Heater Recipe + Heater Equipment Type

## Summary

Add a `"heater"` equipment type for electric radiators controlled via Zigbee relay modules (fil pilote). Create a `presence-heater` recipe that switches heaters to comfort on motion and eco on absence timeout, with an optional night window that forces eco regardless of motion.

## Reference

- Recipe system: §12 of sowel-spec.md
- Motion-light base recipe: `src/recipes/engine/motion-light-base.ts`
- Presence-thermostat recipe: `src/recipes/presence-thermostat.ts` (night window pattern)

## Acceptance Criteria

- [ ] New `"heater"` equipment type in `EquipmentType` union
- [ ] `presence-heater` recipe registered and instantiable
- [ ] Motion detected → heaters set to comfort (relay state depends on `invertRelay`)
- [ ] No motion for `timeout` → heaters set to eco
- [ ] Night window (optional): forces eco regardless of motion between nightStart and nightEnd
- [ ] Night window end with motion present → resume comfort
- [ ] `invertRelay` parameter: when true, comfort = OFF / eco = ON (fil pilote wiring)
- [ ] `maxOnDuration` (optional): force eco after this duration even with continued motion
- [ ] Manual relay change → override mode (recipe suspended until eco timer clears)
- [ ] Without night window, recipe works as simple motion-on / timeout-off
- [ ] Backward compatible: no impact on existing recipes or equipment types

## Scope

### In Scope

- `"heater"` equipment type (types.ts, constants.ts, equipment-manager validation)
- `presence-heater` recipe with slots, validation, start/stop
- Night window periodic check (same pattern as presence-thermostat)
- Override detection on manual relay state change
- i18n fr/en for recipe and slots
- Tests for all scenarios

### Out of Scope

- Zone aggregation for heaters (no `heatersOn` count — deferred)
- UI heater-specific components (uses standard equipment UI)
- Temperature feedback from heaters (no thermostat integration)
- Button toggle support (not requested)

## Edge Cases

- Night window overlaps midnight (e.g., 22:00 → 06:00): handled by `isInTimeWindow()` existing helper
- Recipe restart during night window: sync checks night window on start, forces eco if applicable
- Manual relay change during night: enters override, eco timer will clear override after timeout
- All heaters offline: executeOrder will log error, recipe continues

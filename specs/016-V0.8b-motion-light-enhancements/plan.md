# Implementation Plan: V0.8b Motion-Light Enhancements

## Tasks

1. [ ] Update `RecipeSlotDef` in `types.ts`: add `list?: boolean`, allow `EquipmentType[]` in constraints
2. [ ] Rewrite `motion-light.ts` slots definition (lights list, luxThreshold, maxOnDuration)
3. [ ] Rewrite `validate()`: validate all lights in zone, have state order, lux threshold range, maxOnDuration
4. [ ] Rewrite `start()`: normalize params (backward compat light→lights), wire event handlers
5. [ ] Update `onZoneChanged()`: lux threshold check, impulse timer reset on motion=true
6. [ ] Update `onLightChanged()`: multi-light awareness
7. [ ] Add failsafe timer logic (start on turn-on, cancel on turn-off, force off on expiry)
8. [ ] Update `turnOn()`/`turnOff()` to iterate over lights list
9. [ ] Update `isLightOn()` to check any light in list
10. [ ] Update existing tests for multi-light params
11. [ ] Add tests: lux threshold blocks turn-on, lux ignored when no sensor
12. [ ] Add tests: motion impulse resets timer
13. [ ] Add tests: failsafe forces off after maxOnDuration
14. [ ] Add tests: backward compatibility (light → lights migration)
15. [ ] TypeScript compilation (backend)
16. [ ] All tests pass

## Testing

- Run `npm test` to verify all 276+ tests pass
- Run `npx tsc --noEmit` for type checking

# Architecture: V0.8b Motion-Light Enhancements

## Type Changes

### RecipeSlotDef (types.ts)

Add support for list-type slots:

```typescript
export interface RecipeSlotDef {
  // ... existing fields
  list?: boolean; // When true, param value is an array of the slot type
  constraints?: {
    equipmentType?: EquipmentType | EquipmentType[]; // Allow multiple types
    min?: number;
    max?: number;
  };
}
```

## Recipe Slot Changes

| Slot            | Before                                                    | After                                                                                                           |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `light`         | Single equipment ID, type `equipment`, `light_onoff` only | **Removed**                                                                                                     |
| `lights`        | N/A                                                       | List of equipment IDs, type `equipment`, `list: true`, accepts `light_onoff` / `light_dimmable` / `light_color` |
| `luxThreshold`  | N/A                                                       | Optional, type `number`, min 0                                                                                  |
| `maxOnDuration` | N/A                                                       | Optional, type `duration`                                                                                       |

## Logic Changes

### Turn-on condition

```
Before: motion=true AND lightOff
After:  motion=true AND lightOff AND (luxThreshold not set OR zone.luminosity <= luxThreshold OR zone.luminosity is null)
```

### Timer behavior

```
Before: timer starts when motion=false + light=on
After:  timer restarts on EVERY zone.data.changed where motion=true (impulse reset)
         timer starts when motion=false + light=on (same as before)
```

### Failsafe

```
On light turn-on: start failsafe timer (maxOnDuration)
On light turn-off (any cause): cancel failsafe timer
On failsafe expiry: force all lights off, log warning
```

### Multi-light execution

```
turnOn():  for each lightId in lights → executeOrder(lightId, "state", "ON")
turnOff(): for each lightId in lights → executeOrder(lightId, "state", "OFF")
isLightOn(): return true if ANY light in the list is ON
```

## Backward Compatibility

Existing recipe instances stored in DB may have `{ light: "uuid" }` instead of `{ lights: ["uuid"] }`. The `start()` method normalizes: if `params.light` exists and `params.lights` does not, convert to `lights: [params.light]`.

## File Changes

| File                               | Change                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `src/shared/types.ts`              | Add `list?: boolean` to RecipeSlotDef, allow array in constraints.equipmentType |
| `src/recipes/motion-light.ts`      | Rewrite slots, validation, start, event handlers, timer logic                   |
| `src/recipes/motion-light.test.ts` | Update all tests, add new tests for lux, impulse reset, failsafe, multi-light   |

# Architecture — Spec 155 (Invert Direction for Boolean Gate Triggers)

## Data model

None. Reuses `equipments.invert_direction` (spec 154, migration `024_equipment_invert_direction.sql`). No new column, no new migration.

## Resolution flow

```
executeOrder(equipmentId, alias, value)
  semanticValue = invertDirection && !isDeliveryRetry
    ? invertShutterCommand(binding.category, value)   // unchanged, shutter-family only
    : value
  -> resolveOrderValue(binding, semanticValue, invertDirection && !isDeliveryRetry)
       enum binding: unchanged (spec 150)
       boolean binding, empty value: resolvedValue = !invertDirection
       else: unchanged
  -> resolveWireValue(resolvedValue, valueOn, valueOff)
  -> dispatchToBinding(...) -> integration.executeOrder(...)
```

`resolveOrderValue` gained a third optional parameter, `invertDirection: boolean`, computed the same way (and with the same delivery-retry guard, spec 141) as the existing `semanticValue` inversion just above it in `executeOrder`. The enum branch and the shutter-family `invertShutterCommand` path are both untouched — this only changes the boolean-empty-value default.

## Files changed

| File                                                    | Change                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/equipments/equipment-manager.ts`                   | `resolveOrderValue` gains `invertDirection` param, boolean-empty branch flips to `!invertDirection`; `executeOrder` call site passes `equipment.invertDirection && !isDeliveryRetry` |
| `ui/src/components/equipments/InvertDirectionPanel.tsx` | Type-aware copy key (`equipments.invertDirectionGate.*` for `gate`, existing `equipments.invertDirection.*` otherwise)                                                               |
| `ui/src/pages/EquipmentDetailPage.tsx`                  | Mounts `InvertDirectionPanel` for `isGate` too, alongside the existing shutter-family/pool_cover condition                                                                           |
| `ui/src/i18n/locales/{en,fr}.json`                      | New `equipments.invertDirectionGate.*` strings                                                                                                                                       |

No changes to `src/shared/types.ts`, `ui/src/types.ts`, `src/api/routes/equipments.ts`, `ui/src/api/equipments.ts`, or `src/devices/device-manager.ts` — every one of those already had everything this needs, from spec 154.

## Why this supersedes the dynamic "read last known state" iteration

The dropped iteration (`gateTriggerMode: "toggle"`, see git history on this branch) added a `DeviceManager.getDeviceDataValueById()` lookup and a new column to compute the inverse of whatever the integration last reported. It was validated on real hardware and worked (3/3 consecutive presses). But the resolved value was `false` on every single press, never alternating — meaning the "dynamic" read was, in practice, always converging on the same static answer a plain `invertDirection` flip would have given directly, with none of the added complexity (extra DB column, extra lookup at order-execution time, a dependency on the integration's cache staying in the state the logic assumes). Marc's read of the underlying hardware behavior (the relay auto-reverts to `ON` on its own between presses) explains why: the "last known state" the dynamic version was reading was, itself, deterministic in practice, so reading it added a moving part without adding real coverage for the one confirmed use case.

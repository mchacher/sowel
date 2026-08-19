# Architecture — Spec 155 (Toggle-Based Gate Trigger Resolution)

## Data model

`equipments.gate_trigger_mode TEXT NOT NULL DEFAULT 'fixed'` (migration `025_equipment_gate_trigger_mode.sql`). Mirrors `invert_direction`'s column pattern (spec 154) but as a string enum instead of a boolean, since a third mode is plausible later (e.g. a static-OFF mode per issue #627's original proposal).

## Resolution flow

```
executeOrder(equipmentId, alias, value)
  -> resolveOrderValue(binding, semanticValue, equipment.gateTriggerMode)
       boolean binding, empty value, gateTriggerMode === "toggle"
         -> DeviceManager.getDeviceDataValueById(binding.device_id, binding.key)
              boolean -> logical inverse
              null/other -> true (same as "fixed" default)
       else: existing spec 150 behavior unchanged
  -> resolveWireValue(resolvedValue, valueOn, valueOff)
  -> dispatchToBinding(...) -> integration.executeOrder(...)
```

`resolveOrderValue` gained a third optional parameter (`gateTriggerMode`) rather than a new method — it's the same value-shaping step, just one more input to it. The enum/passthrough branches are untouched.

## Files changed

| File                                                    | Change                                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `migrations/025_equipment_gate_trigger_mode.sql`        | New column, default `'fixed'`                                                                                                                                                  |
| `src/shared/types.ts`                                   | `Equipment.gateTriggerMode?: "fixed" \| "toggle"`                                                                                                                              |
| `src/devices/device-manager.ts`                         | New `getDeviceDataValueById(deviceId, key)`, extracted from `getDeviceDataValue`'s decode logic                                                                                |
| `src/equipments/equipment-manager.ts`                   | `EquipmentRow.gate_trigger_mode`, `rowToEquipment`, `UpdateEquipmentInput.gateTriggerMode`, `updateEquipment` SQL, `resolveOrderValue` toggle branch, `executeOrder` call site |
| `src/api/routes/equipments.ts`                          | Schema + body type + pass-through on `PUT /equipments/:id`                                                                                                                     |
| `ui/src/types.ts`, `ui/src/api/equipments.ts`           | Mirror the field                                                                                                                                                               |
| `ui/src/components/equipments/GateTriggerModePanel.tsx` | New admin toggle panel, mirrors `InvertDirectionPanel`                                                                                                                         |
| `ui/src/pages/EquipmentDetailPage.tsx`                  | Mounts the panel for `isGate && isAdmin`                                                                                                                                       |
| `ui/src/i18n/locales/{en,fr}.json`                      | `equipments.gateTriggerMode.*` strings                                                                                                                                         |

## Why a `DeviceManager` lookup instead of tracking "last sent" in `EquipmentManager`

`DeviceManager` already has the device's live reported state (`device_data`), updated independently of what Sowel itself last sent — which is exactly what "did the device actually change" needs to reflect (the integration's own belief about current state, the same thing Z2M's dedup would check), not "what did Sowel's own executeOrder last resolve to". Tracking a separate "last sent" value in `EquipmentManager` would drift from the integration's actual cache and reintroduce the same bug in a different place.

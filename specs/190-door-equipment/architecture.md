# Architecture — Spec 190

## Flow

```
device (shutter_move order, optional shutter_position, optional end-state enum)
  → equipment type "door" (candidate-based, shutter grouping)
    → src/shared/door-state.ts  doorState(bindings) → open | closed | moving | fault | unknown
        ├─ zone-aggregator  accumulateDoor → doorsOpen / doorsTotal → zone.data.changed
        └─ UI (useEquipmentState, ShutterControl, tiles, sheet) → pill, icon, colour
edit form type selector → typesOfferedOnEdit(type)  (src/shared/equipment-type-change.ts) → PUT /equipments/:id { type }
```

## Components

### New: `src/shared/door-state.ts`

`doorState(bindings)` implements FR3 over `{ alias, category, value }[]`, so the backend's
`DataBindingWithValue` and the UI's bindings both fit. `isDoorOpenForCount(state)` = open, moving
or fault. One implementation for the aggregator and every UI surface.

### New: `src/shared/equipment-type-change.ts`

`COVER_FAMILY_TYPES = ["shutter", "awning", "door"]` and `typesOfferedOnEdit(current)`: the three
for a cover, the current type alone otherwise. Used by the edit form. The manager is not narrowed
(specs 081 and 183 change types through the API).

### Zone aggregation

`accumulateDoor(acc, bindings)` beside `accumulateWaterValve`, called for `equipmentType === "door"`.
`doorsOpen` / `doorsTotal` added to `Accumulator`, the merge, `accumulatorToPublic`,
`aggregatedDataEqual` and `ZoneAggregatedData`. The existing `shutter_position` branch already
counts only `shutter`, so a door's position never reaches the shutter counts.

### UI

- `useEquipmentState`: `isDoor`; `isShutterFamily` includes it (same controls everywhere);
  `shutterIsOpen` follows `doorState` for a door; icon `DoorOpen` / `DoorClosed`.
- `ShutterControl`, `ShutterEquipmentWidget` (EquipmentWidget), `MobileWidgetCard`,
  `WidgetDetailSheet`: door branch for the pill (FR4) and the picto (`GarageDoorIcon`, or the
  custom gate picto chosen in the widget).
- `ZoneEquipmentsView`: « Portes » group. `ZoneAggregationPills`: doors pill.
- `EquipmentForm`: type selector enabled on edit for the cover family, limited to it.

## Files changed

| Domain     | File                                                                                      | Change                                   |
| ---------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| Shared     | `src/shared/types.ts`, `ui/src/types.ts`                                                  | `door`; `doorsOpen`, `doorsTotal`        |
| Shared     | `src/shared/door-state.ts` (+ test)                                                       | new                                      |
| Shared     | `src/shared/equipment-type-change.ts` (+ test)                                            | new                                      |
| Shared     | `src/shared/binding-candidates.ts`                                                        | `door` candidate-based, shutter grouping |
| Equipments | `src/equipments/equipment-manager.ts`                                                     | valid type                               |
| API        | `src/api/routes/equipments.ts`                                                            | `type` declared in the update schema     |
| Zones      | `src/zones/zone-aggregator.ts`                                                            | `accumulateDoor`, new counters           |
| UI         | `bindingUtils.ts`, `EquipmentForm.tsx`, `equipment-type-meta.tsx`                         | bindings, type option, icon/label        |
| UI         | `useEquipmentState.ts`, `ShutterControl.tsx`                                              | door state, pill, icon                   |
| UI         | `EquipmentWidget.tsx`, `MobileWidgetCard.tsx`, `WidgetDetailSheet.tsx`, `widget-icons.ts` | tile and sheet                           |
| UI         | `ZoneEquipmentsView.tsx`, `ZoneAggregationPills.tsx`, `mapping-source.ts`                 | zone group, pill, publisher source       |
| UI         | `i18n/locales/{en,fr}.json`                                                               | wording                                  |
| Docs       | user equipments/zones, technical data-model/api-reference (EN + FR)                       | docs delta                               |

No migration: `equipments.type` is free text validated by the manager.

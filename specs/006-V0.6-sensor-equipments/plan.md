# Implementation Plan: V0.6 Sensor Equipment Support

## Tasks

1. [ ] Create `sensorUtils.tsx` — shared sensor icon/label/format helpers
2. [ ] Add "Capteur" to `EquipmentForm.tsx` EQUIPMENT_TYPES dropdown
3. [ ] Update `DeviceSelector.tsx` — merge all sensor categories into `sensor` entry
4. [ ] Update `EquipmentsPage.tsx` — add `sensor` to `isRelevantData()`
5. [ ] Create `SensorDataPanel.tsx` — sensor widgets for detail page
6. [ ] Update `EquipmentDetailPage.tsx` — render SensorDataPanel for sensor type
7. [ ] Update `CompactEquipmentCard.tsx` — sensor-specific multi-value display + dynamic icon
8. [ ] Update `EquipmentCard.tsx` — dynamic sensor icon based on data categories
9. [ ] TypeScript compilation check (backend + frontend)
10. [ ] Run all tests

## Dependencies

- Requires V0.5 (UI Restructuring) to be completed — DONE

## Testing

- Create a sensor equipment via UI, select a temperature device → verify auto-binding
- Create a sensor equipment, bind a PIR device → verify motion icon display
- Check CompactEquipmentCard shows multi-values (temp + humidity)
- Check EquipmentDetailPage shows SensorDataPanel with dedicated widgets
- Verify existing light equipments are not affected

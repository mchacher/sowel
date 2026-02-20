# V0.6: Sensor Equipment Support

## Summary

Add the ability to create sensor-type equipments from the UI, auto-bind sensor device data (temperature, humidity, motion, contact, pressure, luminosity, CO2, VOC, water_leak, smoke), and provide dedicated UI widgets for sensor display in both compact cards (Maison view) and equipment detail page.

## Reference

- Spec sections: §4 (Equipments), §5 (DataCategory), §6 (Zone Aggregation), §15 (UI Design)

## Key Design Decisions

1. **Single "Capteur" type in creation form**: The user selects "Capteur" — the UI auto-adapts its icon and display based on which data categories are bound (motion, temperature, contact, etc.).
2. **Multi-values on compact cards**: When a sensor exposes multiple values (e.g. temperature + humidity), all are shown on the card.
3. **Dedicated widgets on detail page**: Each data category gets a purpose-built readout widget (thermometer for temp, motion indicator for PIR, open/closed for contact, etc.).
4. **PIR motion display**: `PersonStanding` icon (orange) when motion is detected, same icon (gray) when no detection.
5. **No battery auto-binding**: Battery data is excluded from auto-binding.
6. **Backend type remains `sensor`**: The existing `motion_sensor` and `contact_sensor` types stay in the TypeScript union for backward compatibility but are not exposed in the creation form.

## Acceptance Criteria

- [ ] "Capteur" appears as a type in the equipment creation form
- [ ] DeviceSelector filters to show devices exposing sensor data categories (temperature, humidity, motion, contact, pressure, luminosity, co2, voc, water_leak, smoke)
- [ ] Auto-binding creates DataBindings for all relevant sensor data (excluding battery)
- [ ] CompactEquipmentCard (Maison) displays sensor-specific content:
  - [ ] Dynamic icon based on primary data category (Thermometer, PersonStanding, DoorOpen, Gauge, etc.)
  - [ ] Multi-value display (e.g. "21.5°C  45%")
  - [ ] Motion: PersonStanding icon in orange when detected, gray when not
  - [ ] Contact: "Ouvert" / "Fermé" badge
- [ ] EquipmentDetailPage has a "Sensor Data" panel with dedicated widgets per category:
  - [ ] Temperature: large value readout with unit
  - [ ] Humidity: large value readout with unit
  - [ ] Motion: PersonStanding icon + "Mouvement détecté" / "Aucun mouvement" status
  - [ ] Contact: DoorOpen/DoorClosed icon + "Ouvert" / "Fermé" status
  - [ ] Other (pressure, luminosity, CO2, VOC, etc.): value + unit readout
- [ ] EquipmentCard (Settings Equipments list) also adapts icon for sensor type based on data
- [ ] TypeScript compiles with zero errors (backend + frontend)
- [ ] All existing tests pass

## Scope

### In Scope

- Add "Capteur" to EquipmentForm type dropdown
- Merge all sensor data categories into DeviceSelector filter for `sensor` type
- Add sensor entries to `isRelevantData` in auto-binding logic
- Dynamic icon selection based on data categories (for CompactEquipmentCard and EquipmentCard)
- Multi-value display on CompactEquipmentCard
- Sensor data widgets on EquipmentDetailPage
- Motion indicator with PersonStanding icon

### Out of Scope

- Computed Data engine (OR of multiple PIRs, AVG of multiple temperature sensors) — deferred
- Zone auto-aggregation (motion OR, temperature AVG at zone level) — deferred
- Adding other equipment types to creation form (shutter, thermostat, lock, etc.) — separate feature
- History / InfluxDB integration — deferred

## Edge Cases

- Sensor with no data bindings yet → show placeholder "No data" in widgets
- Sensor data value is `null` → show "—" dash
- Device goes offline → last known value remains displayed (existing behavior)
- Multiple data of same category (e.g. 2 temperature bindings) → show all values
- Sensor with mixed categories (temp + humidity + motion) → show all, icon based on "primary" category (first non-null binding)

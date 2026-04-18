# Spec 078 — Button Zone Orders & Zone-First Equipment Selection

## Summary

Enhance the button action configuration UI to support zone-level group orders (lights, shutters, thermostats) and improve the equipment order selection with a zone-first approach.

## Requirements

### R1 — Zone-first equipment selection for `equipment_order`

When configuring a button action of type `equipment_order`, the user selects a **zone first**, then picks an equipment from that zone (instead of a flat list of all equipments).

- Step 1: Zone selector (all zones)
- Step 2: Equipment selector (filtered by selected zone, only equipments with order bindings)
- Step 3: Order alias + value (unchanged)

### R2 — New `zone_order` effect type

A new button effect type `zone_order` allows triggering zone-level group orders from a button press.

- Step 1: Zone selector
- Step 2: Group action selector — maps to existing zone order keys:
  - Lights: `allLightsOn`, `allLightsOff`, `allLightsBrightness`
  - Shutters: `allShuttersOpen`, `allShuttersStop`, `allShuttersClose`
  - Thermostats: `allThermostatsPowerOn`, `allThermostatsPowerOff`, `allThermostatsSetpoint`
- Step 3: Value input (only for parametric orders: brightness, setpoint)

Backend execution calls `equipmentManager.executeZoneOrder()` with the selected zone (including descendants).

## Acceptance Criteria

- [x] AC1: `equipment_order` form shows zone selector first, then equipments filtered by zone
- [x] AC2: New `zone_order` effect type appears in the effect type dropdown
- [x] AC3: `zone_order` form shows zone selector → group action → optional value
- [x] AC4: Button press with `zone_order` binding executes `executeZoneOrder()` on the selected zone + descendants
- [x] AC5: Parametric zone orders (brightness, setpoint) accept a value
- [x] AC6: Existing `equipment_order` bindings continue to work (retro-compatible)
- [x] AC7: Backend validates `zone_order` effect type and config

## Scope

### In scope

- New `zone_order` ButtonEffectType
- Zone-first equipment selector for `equipment_order`
- Backend execution of zone orders from button actions
- Validation of zone_order config
- UI labels/translations for zone order groups

### Out of scope

- Custom groups (only predefined zone order keys)
- Recipe actions from buttons (future spec)
- Zone order keys beyond what already exists in `ZONE_ORDERS`

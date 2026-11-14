# Implementation Plan — Spec 208

## Slices

### Slice A — Backend

- [x] A.1 — `EquipmentFamily`, `EQUIPMENT_FAMILIES`, `Equipment.family`
- [x] A.2 — Migration 045, manager update and row mapping
- [x] A.3 — `PUT /equipments/:id` accepts `family` (enum, switch only, `null` clears)

### Slice B — Families in the UI

- [x] B.1 — Tokens (light, dark) and `@theme` aliases; old sensor and media tints removed
- [x] B.2 — `lib/equipment-family.ts` and `equipment-running.ts`
- [x] B.3 — Maison sections and coloured headers; tiles in Maison, Equipments page, equipment page header
- [x] B.4 — FamilyPanel on a switch's page
- [x] B.5 — i18n FR and EN

### Slice C — Bottom tab bar

- [x] C.1 — MobileNav / MobileNavLink per FR7

### Slice D — Design system and docs

- [x] D.1 — `tokens.md`, `cat-head.md`, `eq-row.md`, `mobile-tabbar.md`, `components.md`, `activity-item.md`
- [x] D.2 — User and technical docs, EN and FR (spec Docs Delta)

## Test Plan

| Module                        | Scenario                                                  | Expected                                                                  |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `lib/equipment-family`        | every `EquipmentType`                                     | exactly one section; matches the FR1 table                                |
| `lib/equipment-family`        | switch with `family: "climate"`                           | family `climate`, section Climat                                          |
| `lib/equipment-family`        | switch without family / `null`                            | no family, section Prises                                                 |
| `lib/equipment-family`        | `family` set on a non-switch                              | ignored: the type's family                                                |
| `lib/equipment-family`        | unknown type                                              | section `other`, no family                                                |
| `lib/equipment-family`        | section order                                             | FR1 order, `other` last                                                   |
| `equipment-running`           | light on / off                                            | true / false                                                              |
| `equipment-running`           | heater relay off (comfort) / on                           | true / false                                                              |
| `equipment-running`           | thermostat power on, pool heat pump mode OFF / HEAT       | true; false / true                                                        |
| `equipment-running`           | water valve open, water heater on, pool pump on           | true                                                                      |
| `equipment-running`           | VMC speed off / V1                                        | false / true                                                              |
| `equipment-running`           | charger charging, vehicle charging / plugged not charging | true; true / false                                                        |
| `equipment-running`           | shutter open, sensor motion, meter                        | false                                                                     |
| `color-roles.test`            | each family, both themes                                  | ink ≥ 4.5 on surface and pale; on ≥ 3 on fill; dark pale ≥ 1.1 on surface |
| `ZoneEquipmentsView` (render) | lights, shutter, sensor, switch with climate, button      | sections Éclairages, Ouvrants, Climat, Capteurs, Commandes                |
| `FamilyPanel` (render)        | pick « Climat » / « None »                                | `updateEquipment` called with `climate` / `null`                          |
| `api/routes/equipments`       | PUT `family: "climate"` on a switch                       | 200, returned and stored                                                  |
| `api/routes/equipments`       | PUT `family: "climate"` on a light                        | 400                                                                       |
| `api/routes/equipments`       | PUT `family: "bogus"`                                     | 400 (schema)                                                              |
| `api/routes/equipments`       | PUT `family: null` on a switch with a family              | 200, family cleared                                                       |

## Validation Plan

- `npm run validate`
- `check-specs-complete`, `check-specs-index folders`, `check-docs-parity`, `check-docs-impact`
- Manual: local instance, Maison zone with lights, shutters, sensors, a switch set to Climat; light and dark;
  phone width for the bottom bar.

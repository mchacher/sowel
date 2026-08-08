# Architecture — Spec 135 Water heater

Pure additive equipment type, modelled on `heater` / `switch`. No DB,
event, or API change. Touch points (mirroring how spec 133 `camera` and
`heater` thread through the layers):

## Backend

| File                                   | Change                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/shared/types.ts`                  | Add `"water_heater"` to the `EquipmentType` union                                                            |
| `src/equipments/equipment-manager.ts`  | Add `"water_heater"` to `VALID_EQUIPMENT_TYPES`                                                              |
| `src/equipments/binding-candidates.ts` | Add `case "water_heater"` to the on/off relay branch (isOnOffOrder + metering attach), identical to `switch` |

The `water_heater` candidate case reuses the exact `switch` logic: one
on/off candidate per `isOnOffOrder` order; when a single candidate, attach
metering data (`METERING_CATEGORIES`). Temperature is NOT a candidate
discriminator (it's an optional extra binding), so it is not required for
compatibility.

## Frontend

| File                                                                                                          | Change                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/src/types.ts`                                                                                             | Mirror `EquipmentType`                                                                                                                                                                                                                                |
| `ui/src/lib/binding-candidates.ts`                                                                            | Mirror the backend `water_heater` case (isOnOffOrder + metering)                                                                                                                                                                                      |
| `ui/src/components/equipments/DeviceSelector.tsx`                                                             | `EQUIPMENT_TYPE_CATEGORIES.water_heater = ["light_state"]`; add to `CANDIDATE_BASED_TYPES`                                                                                                                                                            |
| `ui/src/components/equipments/bindingUtils.ts`                                                                | `RELEVANT_DATA.water_heater = ["light_state","temperature","power","energy"]`; `RELEVANT_ORDERS.water_heater = ["state","on"]`; temperature aliased `water_temperature` via `DATA_CATEGORY_ALIASES` override for this type (or a per-type alias rule) |
| `ui/src/components/equipments/EquipmentForm.tsx`                                                              | Add `{ value: "water_heater", labelKey: "equipments.type.water_heater" }`                                                                                                                                                                             |
| `ui/src/components/dashboard/WidgetIcons.tsx`                                                                 | New `WaterHeaterIcon({ on })` — custom SVG, viewBox 56, 120px, `on ? text-active : text-primary`                                                                                                                                                      |
| `ui/src/components/dashboard/widget-icons.ts`                                                                 | Register `water_heater` in `CUSTOM_ICON_REGISTRY`                                                                                                                                                                                                     |
| `ui/src/components/dashboard/EquipmentWidget.tsx`                                                             | `WaterHeaterEquipmentWidget` (desktop): icon + on/off toggle + temp + power                                                                                                                                                                           |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`                                                            | Mobile branch: icon + on/off + temp summary                                                                                                                                                                                                           |
| `ui/src/components/dashboard/widget-utils.ts` / `WidgetGrid.tsx` / `WidgetDetailSheet.tsx` / `ZoneWidget.tsx` | Route `water_heater` like `heater`/`switch` where these switch on type                                                                                                                                                                                |
| `ui/src/components/equipments/EquipmentCard.tsx`, `useEquipmentState.ts`                                      | on/off state + label + icon for the zone list card                                                                                                                                                                                                    |
| `ui/src/components/home/CompactEquipmentCard.tsx`, `ZoneEquipmentsView.tsx`                                   | zone view rendering                                                                                                                                                                                                                                   |
| `ui/src/i18n/locales/{fr,en}.json`                                                                            | `equipments.type.water_heater`, widget labels (temp/power)                                                                                                                                                                                            |

## The temperature-alias rule (key design point)

The zone aggregator (`src/zones/zone-aggregator.ts`) only folds a
`temperature`-category binding into the room average when its alias is
exactly `"temperature"`. To keep a water heater's water temperature out of
the room average, auto-binding (and the manual add) must alias it
`water_temperature`. Implementation: in `bindingUtils.ts`, add a per-type
alias override so that for `water_heater`, a `temperature`-category data
binds as `water_temperature` (not `temperature`). The widget/card read the
`water_temperature` alias for display.

## Icon

`WaterHeaterIcon` — a wall tank (cumulus): rounded rectangle body, top
water pipe, a small heat/indicator glyph. `on` → amber/active fill +
"heating" tint; `off` → neutral primary stroke. Mirrors the
`LightBulbIcon` state convention (`text-active` vs `text-primary`).

## Event flow

Unchanged: `equipment.data.changed` (state / water_temperature / power)
→ WS push → widget re-render. On/off order via the existing order
dispatcher on the `state` alias (light_toggle), identical to `switch`.

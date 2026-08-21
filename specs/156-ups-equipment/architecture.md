# Spec 156 — Architecture

## Shape of the change

`ups` is a **read-only, polymorphic** equipment type. That makes it the
cheapest shape in the codebase to add: no controller, no order decomposition,
no dispatch path, no state machine. It follows `display` (spec 120) rather than
`vmc` (spec 153) — bind whatever the plugin exposes, render what is bound.

The only genuinely new engineering is three data categories and the rendering
of two value shapes the UI has never had: a severity-coloured status enum, and
a duration in seconds.

## Data model

No SQL migration. `equipments.type` and `device_data.category` are free-text
columns; the unions in `src/shared/types.ts` are the contract, enforced at the
API boundary by `VALID_EQUIPMENT_TYPES`.

### New categories

```ts
// src/shared/types.ts — DataCategory
| "ups_status"       // enum, closed set, severity-ordered
| "battery_runtime"  // number, seconds
| "ups_load"         // number, percent
```

`CATEGORY_EXPECTED_TYPE` gains `battery_runtime: "number"` and
`ups_load: "number"`. `ups_status` is deliberately **absent** from that map:
plugins may legitimately declare it as `enum` or as `text`, and the map exists
to flag contract violations, not to force a wire type.

### Status enum

```ts
// src/shared/constants.ts
export const UPS_STATUS_VALUES = [
  "online",
  "on_battery",
  "low_battery",
  "bypass",
  "overload",
  "offline",
] as const;
```

Severity ordering lives with the UI (it is a rendering concern), but the array
order is the severity order, ascending, so both sides can rely on it.

## Backend touchpoints

| File                                  | Change                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/shared/types.ts`                 | `EquipmentType` += `ups`; `DataCategory` += 3; `WidgetFamily` += `power`                                     |
| `src/shared/constants.ts`             | `UPS_STATUS_VALUES`; `CATEGORY_EXPECTED_TYPE`; `WIDGET_FAMILY_TYPES.power`; `STREAMING_CATEGORIES` + windows |
| `src/equipments/equipment-manager.ts` | `VALID_EQUIPMENT_TYPES` += `ups`                                                                             |
| `src/shared/binding-candidates.ts`    | `ups` joins the multi-value "all data" branch                                                                |

`METERING_EQUIPMENT_TYPES` and `NON_SUBMETER_TYPES` are deliberately left
untouched — see the reasoning below.

## Why `ups` is not added to NON_SUBMETER_TYPES

It would be the wrong fix for FR3. That list means "this type carries a real
power channel that must not be counted"; the grid total and the production
surfaces are on it. A UPS has no business carrying a `power` channel in the
first place, so the fix belongs at the category level (`ups_load` in percent),
not at the enrolment level. Adding it to the blocklist would legitimise the
`power` binding and leave the precision problem in place.

The consequence is a rule a plugin must respect rather than one the core
enforces. That is the same contract every other category already relies on, and
the acceptance criteria cover it.

## Frontend touchpoints

| File                                                                    | Change                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ui/src/types.ts`                                                       | Mirror the three unions                                    |
| `ui/src/components/equipments/upsStatus.ts`                             | **New** — status → severity + i18n key, seconds → duration |
| `ui/src/components/equipments/UpsPanel.tsx`                             | **New** — read-only detail panel                           |
| `ui/src/components/equipments/EquipmentForm.tsx`                        | Type picker entry                                          |
| `ui/src/components/equipments/EquipmentCard.tsx`                        | `TYPE_ICONS` + `TYPE_LABELS`                               |
| `ui/src/components/equipments/bindingUtils.ts`                          | `RELEVANT_DATA.ups`, empty `RELEVANT_ORDERS.ups`           |
| `ui/src/components/equipments/useEquipmentState.ts`                     | `isUps` flag                                               |
| `ui/src/components/home/ZoneEquipmentsView.tsx`                         | New "Power" group                                          |
| `ui/src/components/home/CompactEquipmentCard.tsx`                       | Compact rendering                                          |
| `ui/src/components/dashboard/EquipmentWidget.tsx`                       | Desktop widget                                             |
| `ui/src/components/dashboard/MobileWidgetCard.tsx`                      | Mobile card                                                |
| `ui/src/components/dashboard/WidgetDetailSheet.tsx` / `widget-utils.ts` | Detail sheet on tap                                        |
| `ui/src/components/dashboard/widget-icons.ts`                           | `BatteryCharging`                                          |
| `ui/src/pages/EquipmentDetailPage.tsx`                                  | Panel dispatch                                             |
| `ui/src/i18n/locales/{en,fr}.json`                                      | Type label, 6 status labels, row labels                    |

A dedicated `upsStatus.ts` module (rather than inline helpers) keeps
react-refresh happy — the same reason `vmcSpeed.ts` exists (spec 153).

## Reading the status from bindings

The widget and cards resolve values by **category first, alias as fallback** —
the existing `findBinding(categories, aliasFallbacks)` helper in `bindingUtils`.
Category-first matters here: a plugin is free to name its keys `status` or
`ups_status` or `etat`, and only the category is contractual.

## Test plan

| Test                         | Asserts                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `equipment-manager.test.ts`  | `ups` is creatable; unknown type still rejected                                                        |
| `binding-candidates.test.ts` | `ups` yields one "all" candidate; empty device → none                                                  |
| `metering.test.ts`           | `ups_load` is not a metering channel, so a UPS reporting its load per FR3 stays out of the energy path |
| `ui/.../upsStatus.test.ts`   | Severity mapping, unknown → neutral, duration formatting incl. 0 s and > 1 h                           |

# Spec 183 — Architecture

Same shape as spec 182: no migration, no new event, no new API route. A new `EquipmentType`, eleven categories, a contract module, binding rules, surfaces.

## Contract module

`src/shared/electric-vehicle-contract.ts` (pure TS, re-exported by `ui/src/lib/electric-vehicle-contract.ts`):

```ts
export const EV_CHARGING_STATE_VALUES = [
  "unplugged",
  "idle",
  "scheduled",
  "waiting",
  "charging",
  "completed",
  "error",
] as const;
export const ELECTRIC_VEHICLE_ALIASES = {
  batteryLevel: "battery_level",
  range: "range",
  plugged: "plugged",
  chargingState: "charging_state",
  reportedAt: "reported_at",
  atHome: "at_home",
  mileage: "mileage",
  wake: "wake",
  chargeStart: "charge_start",
} as const;
export const ELECTRIC_VEHICLE_CATEGORY_ALIASES: Readonly<Record<string, string>>; // category → alias, data and orders
export const ELECTRIC_VEHICLE_CORE: readonly { alias: string; data: boolean; order: boolean }[];
export const ELECTRIC_VEHICLE_IDENTITY_DATA_CATEGORY = "ev_battery_level";
export function isElectricVehicleDevice(data, orders): boolean;
export function isEvChargingState(v: unknown): v is EvChargingState;
export function splitElectricVehicleExtras(dataBindings, orderBindings);
/** Age beyond which the surfaces show how old the car's report is (FR7). */
export const EV_REPORT_STALE_MS = 15 * 60_000;
```

## Types and constants

| File                                                   | Change                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/types.ts`, `ui/src/types.ts`               | `EquipmentType` += `electric_vehicle`; `DataCategory` += `ev_battery_level`, `ev_range`, `ev_plugged`, `ev_charging_state`, `ev_reported_at`, `ev_at_home`, `ev_mileage`, `ev_charge_limit`; `OrderCategory` += `ev_wake`, `ev_charge_start`, `set_ev_charge_limit` |
| `src/shared/constants.ts`                              | `CATEGORY_EXPECTED_TYPE` (numbers, booleans; the enum and the string left out like `ups_status`)                                                                                                                                                                    |
| `src/equipments/equipment-manager.ts`                  | `VALID_EQUIPMENT_TYPES`; `createWithAutoBindings` contract-first aliasing generalised from the `ev_charger` case to a per-type contract map (`ev_charger`, `electric_vehicle`)                                                                                      |
| `src/equipments/metering.ts`, `ui/src/lib/metering.ts` | `NON_SUBMETER_TYPES` += `electric_vehicle` (FR5: never a submeter even if a plugin publishes power)                                                                                                                                                                 |
| `src/shared/timed-command.ts`                          | `TIMED_EXCLUDED_TYPES` += `electric_vehicle`                                                                                                                                                                                                                        |
| `defaultEnergyClassFor` (both copies)                  | unchanged: `null` → the energy panel cannot be enabled, and `EnergyManagementPanel` is not mounted for this type (FR5)                                                                                                                                              |

## Binding (UI)

- `bindingUtils.ts`: `RELEVANT_DATA.electric_vehicle` = the eight data categories + `generic`; `RELEVANT_ORDER_CATEGORIES.electric_vehicle` = `ev_wake`, `ev_charge_start`; `TYPE_CATEGORY_ALIASES.electric_vehicle` = the contract map; the contract-first ordering generalised from `ev_charger` to any type with a contract map.
- `DeviceSelector`: `isElectricVehicleDevice` identity filter, like the charger.

## UI

| Surface                                                                                                      | Change                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `equipment-type-meta.tsx`                                                                                    | Icon `Car` (Lucide), label                                                                                                                  |
| `EquipmentForm.tsx`                                                                                          | Type entry                                                                                                                                  |
| `components/equipments/electricVehicleState.ts` (new)                                                        | One reader: battery, range, plugged, charging state, report age (from `reported_at`, else the binding's `lastUpdated`), the two orders      |
| `components/equipments/ElectricVehicleControl.tsx` (new)                                                     | Detail page + mobile sheet: battery bar with the limit mark, range, state, age, Wake / Start charging buttons, charge-limit stepper, extras |
| `CompactEquipmentCard.tsx`                                                                                   | Tint, `CompactElectricVehicle` row: battery %, range, plug/charge icon, age when old                                                        |
| `ZoneEquipmentsView.tsx`                                                                                     | New group `equipments.group.vehicles` (Car icon)                                                                                            |
| `EquipmentWidget.tsx`, `MobileWidgetCard.tsx`, `widget-utils.ts`, `WidgetDetailSheet.tsx`, `widget-icons.ts` | Desktop tile, mobile lines, sheet routing, icon                                                                                             |
| `EquipmentDetailPage.tsx`                                                                                    | Mount the control; no energy-management panel for this type                                                                                 |
| i18n EN/FR                                                                                                   | type, group, states, labels, buttons, categories                                                                                            |

The wake and start-charging buttons send momentary orders (no value); the outcome is the order's own result (success, or the plugin's error text such as "charging start is not allowed for this vehicle").

## Documentation

`docs/user/equipments.md` / `.fr.md` (Vehicles section), `docs/technical/data-model/equipments.md` (contract), specs index EN/FR.

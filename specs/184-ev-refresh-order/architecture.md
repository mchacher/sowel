# Spec 184 — Architecture

A one-point amendment of the spec 183 contract; every path already exists for `wake`.

| File                                                      | Change                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/shared/types.ts`, `ui/src/types.ts`                  | `OrderCategory` += `ev_refresh`                                                       |
| `src/shared/electric-vehicle-contract.ts`                 | `EV_REFRESH_CATEGORY`, alias `refresh`, category → alias map, `ELECTRIC_VEHICLE_CORE` |
| `ui/src/components/equipments/bindingUtils.ts`            | `RELEVANT_ORDER_CATEGORIES.electric_vehicle` += `ev_refresh`                          |
| `ui/src/components/equipments/electricVehicleState.ts`    | `refreshAlias`                                                                        |
| `ui/src/components/equipments/ElectricVehicleControl.tsx` | Refresh icon button (Lucide `RefreshCw`) after the report age                         |
| `ui/src/i18n/locales/{en,fr}.json`                        | `equipments.electricVehicle.refresh`, `refreshSent`                                   |
| Docs                                                      | data-model contract table; user equipments page EN/FR                                 |

No migration, no event, no API change. The server-side auto-bind reads `ELECTRIC_VEHICLE_CATEGORY_ALIASES` through `CONTRACT_CATEGORY_ALIASES`, so it follows the contract with no edit.

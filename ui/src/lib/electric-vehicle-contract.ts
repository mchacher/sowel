/**
 * Electric vehicle contract — re-export of the single shared declaration
 * (spec 183). The implementation lives in src/shared/electric-vehicle-contract.ts,
 * pure TS with no backend dependency, so the UI bundles it directly.
 */

export {
  ELECTRIC_VEHICLE_ALIASES,
  ELECTRIC_VEHICLE_CATEGORY_ALIASES,
  ELECTRIC_VEHICLE_CORE,
  EV_BATTERY_LEVEL_CATEGORY,
  EV_CHARGE_LIMIT_CATEGORY,
  EV_CHARGE_LIMIT_FALLBACK,
  EV_CHARGE_START_CATEGORY,
  EV_CHARGING_STATE_CATEGORY,
  EV_CHARGING_STATE_VALUES,
  EV_MILEAGE_CATEGORY,
  EV_PLUGGED_CATEGORY,
  EV_RANGE_CATEGORY,
  EV_REPORTED_AT_CATEGORY,
  EV_REPORT_STALE_MS,
  EV_AT_HOME_CATEGORY,
  EV_WAKE_CATEGORY,
  EV_REFRESH_CATEGORY,
  SET_EV_CHARGE_LIMIT_CATEGORY,
  isElectricVehicleDevice,
  isEvChargingState,
  splitElectricVehicleExtras,
  type ElectricVehicleCoreEntry,
  type EvChargingState,
} from "../../../src/shared/electric-vehicle-contract";

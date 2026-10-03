/**
 * EV charger contract — re-export of the single shared declaration (spec 182).
 * The implementation lives in src/shared/ev-charger-contract.ts, pure TS with
 * no backend dependency, so the UI bundles it directly (the spec 150 / 177
 * pattern).
 */

export {
  EV_CHARGER_ALIASES,
  EV_CHARGER_CATEGORY_ALIASES,
  EV_CHARGER_CORE,
  EV_CHARGE_CURRENT_CATEGORY,
  EV_CHARGE_CURRENT_FALLBACK,
  EV_SESSION_ENERGY_CATEGORY,
  EV_VEHICLE_STATE_CATEGORY,
  EV_VEHICLE_STATE_VALUES,
  SET_EV_CHARGE_CURRENT_CATEGORY,
  isEvChargerDevice,
  isEvVehicleState,
  splitEvChargerExtras,
  type EvChargerCoreEntry,
  type EvVehicleState,
} from "../../../src/shared/ev-charger-contract";

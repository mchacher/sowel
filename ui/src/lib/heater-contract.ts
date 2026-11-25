/**
 * Heater contract — re-export of the single shared declaration (spec 216).
 * The implementation lives in src/shared/heater-contract.ts, pure TS the UI
 * bundles directly (the spec 150 / 177 pattern).
 */

export {
  HEATER_CATEGORY_ALIASES,
  PILOT_WIRE_DATA_CATEGORY,
  PILOT_WIRE_MODES,
  PILOT_WIRE_ORDER_CATEGORY,
  isHeaterRunning,
  pilotWireBindingKeys,
  resolveHeaterState,
  type HeaterState,
  type PilotWireMode,
} from "../../../src/shared/heater-contract";

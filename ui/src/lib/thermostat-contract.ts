/**
 * Thermostat contract — re-export of the single shared declaration (spec 177).
 * The implementation lives in src/shared/thermostat-contract.ts, pure TS with
 * no backend dependency, so the UI bundles it directly (the spec 150 pattern
 * for binding-candidates).
 */

export {
  OPERATION_MODE_VALUES,
  THERMOSTAT_CORE,
  THERMOSTAT_CORE_DATA_ALIASES,
  THERMOSTAT_CORE_ORDER_ALIASES,
  THERMOSTAT_STATE_ALIAS,
  isThermostatCoreAlias,
  isThermostatDevice,
  splitThermostatExtras,
  type OperationMode,
  type ThermostatCoreEntry,
} from "../../../src/shared/thermostat-contract";

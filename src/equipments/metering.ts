// ============================================================
// Metering-aware switch helpers (spec 129)
// ============================================================
//
// A smart plug (e.g. SONOFF S60ZBTPF) is both an on/off `switch` and an energy
// meter: it reports power/energy alongside its `state` order. The `switch` type
// is polymorphic — a bare relay has no metering bindings and behaves as before,
// while a metering plug additionally surfaces power/energy. These pure helpers
// centralise "is this switch a metering plug?" and "does this equipment count
// as a consumption submeter?" so the binding, energy, and UI layers agree.

import type { DataCategory, EquipmentType } from "../shared/types.js";

/** Device-data categories that make a plug a meter (bound in addition to on/off). */
export const METERING_CATEGORIES: ReadonlySet<DataCategory> = new Set<DataCategory>([
  "power",
  "energy",
  "voltage",
  "current",
]);

/**
 * On/off relay equipment types that carry the same candidate shape as a
 * `switch` (spec 129) and can therefore double as a consumption submeter when
 * they report power/energy. A `water_heater` (spec 135) is a relay with an
 * optional metering attach, exactly like a metering plug (#521). Extend this
 * set to enroll further pilotable loads (`heater`, `pool_pump`, `appliance`).
 */
export const METERING_RELAY_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "switch",
  "water_heater",
]);

interface BindingLike {
  alias?: string | null;
  category?: string | null;
}

/** True when the bindings carry a meaningful metering channel (power or energy). */
export function hasMeteringBinding(bindings: readonly BindingLike[]): boolean {
  return bindings.some(
    (b) =>
      b.category === "power" ||
      b.category === "energy" ||
      b.alias === "power" ||
      b.alias === "energy",
  );
}

/** A metering relay (`switch`, `water_heater`, ...) that also reports power/energy. */
export function isMeteringSwitch(type: EquipmentType, bindings: readonly BindingLike[]): boolean {
  return METERING_RELAY_TYPES.has(type) && hasMeteringBinding(bindings);
}

/**
 * Equipments that count as per-equipment consumption submeters: dedicated
 * `energy_meter`s and metering switches. (Not `main_energy_meter` /
 * `energy_production_meter`, which are the house total and production.)
 */
export function isSubmeterEquipment(
  type: EquipmentType,
  bindings: readonly BindingLike[],
): boolean {
  return type === "energy_meter" || isMeteringSwitch(type, bindings);
}

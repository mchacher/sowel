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

import type { EquipmentType } from "../shared/types.js";
import { METERING_CATEGORIES } from "../shared/constants.js";

// Moved to shared/constants.ts (spec 150) so the shared binding-candidates
// module can use it; re-exported here for existing importers.
export { METERING_CATEGORIES };

/**
 * On/off relay equipment types that carry the same candidate shape as a
 * `switch` (spec 129). Kept ONLY for the card-display concern (`isMeteringSwitch`
 * — a plug/relay that shows live power on its own card, spec 129/#521). Since
 * #523, submeter ENROLMENT no longer keys off this whitelist: it is a blocklist
 * (`isSubmeterEquipment` below). Extend this only for card rendering.
 */
export const METERING_RELAY_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "switch",
  "water_heater",
]);

/**
 * The only types that carry a power/energy channel yet must NEVER count as a
 * consumption submeter (#523): the grid total and the two production surfaces.
 * Counting them would double-count the house balance and fold production into
 * consumption. This is the sole exclusion list for submeter enrolment.
 */
export const NON_SUBMETER_TYPES: ReadonlySet<EquipmentType> = new Set<EquipmentType>([
  "main_energy_meter",
  "energy_production_meter",
  "solar_panel",
]);

interface BindingLike {
  alias?: string | null;
  category?: string | null;
  type?: string | null;
}

/**
 * True when the bindings carry a meaningful, NUMERIC metering channel (power or
 * energy). The numeric gate (#523) rejects an on/off reading mis-categorised as
 * `power` — a `media_player`, or a thermostat's own boolean power switch — which
 * is a STATE, not a measurement, and would otherwise enrol as a 0 W submeter.
 * `type` is absent on the bare BindingLike shape used by some callers/tests;
 * absent is treated as numeric to preserve their behaviour (production callers
 * always pass the resolved `DataType`).
 */
export function hasMeteringBinding(bindings: readonly BindingLike[]): boolean {
  return bindings.some((b) => {
    const isPowerOrEnergy =
      b.category === "power" ||
      b.category === "energy" ||
      b.alias === "power" ||
      b.alias === "energy";
    return isPowerOrEnergy && (b.type === undefined || b.type === null || b.type === "number");
  });
}

/** A metering relay (`switch`, `water_heater`, ...) that also reports power/energy. */
export function isMeteringSwitch(type: EquipmentType, bindings: readonly BindingLike[]): boolean {
  return METERING_RELAY_TYPES.has(type) && hasMeteringBinding(bindings);
}

/**
 * Equipments that count as per-equipment consumption submeters (#523): ANY
 * equipment carrying a numeric power/energy channel, EXCEPT the house total and
 * the production meters (`NON_SUBMETER_TYPES`). A blocklist, not a whitelist —
 * a new metered load (a metering thermostat, `pool_pump`, `appliance`, ...) is
 * enrolled automatically, no per-type list to extend.
 *
 * A dedicated `energy_meter` qualifies on its type alone: it is a declared
 * meter, so its card renders at 0 before it has reported any binding (#527).
 */
export function isSubmeterEquipment(
  type: EquipmentType,
  bindings: readonly BindingLike[],
): boolean {
  if (NON_SUBMETER_TYPES.has(type)) return false;
  return type === "energy_meter" || hasMeteringBinding(bindings);
}

// Metering-aware switch helpers (spec 129) — UI mirror of
// src/equipments/metering.ts. A `switch` with a power/energy binding is a
// metering smart plug (e.g. SONOFF S60ZBTPF): it shows live power and counts
// as a consumption submeter, while a bare relay stays a plain on/off switch.
import type { EquipmentWithDetails } from "../types";

/** Device-data categories bound on a switch in addition to on/off (spec 129). */
export const METERING_CATEGORIES: ReadonlySet<string> = new Set([
  "power",
  "energy",
  "voltage",
  "current",
]);

/**
 * On/off relay types kept ONLY for the card-display concern (`isMeteringSwitch`,
 * spec 129/#521). Mirror of METERING_RELAY_TYPES in src/equipments/metering.ts.
 * Since #523, submeter enrolment keys off NON_SUBMETER_TYPES below, not this list.
 */
export const METERING_RELAY_TYPES: ReadonlySet<string> = new Set(["switch", "water_heater"]);

/**
 * Types that carry a power/energy channel but must never count as a consumption
 * submeter (#523): the grid total and the two production surfaces. Mirror of
 * NON_SUBMETER_TYPES in src/equipments/metering.ts.
 */
export const NON_SUBMETER_TYPES: ReadonlySet<string> = new Set([
  "main_energy_meter",
  "energy_production_meter",
  "solar_panel",
]);

/** A meaningful, NUMERIC power/energy channel (#523): a boolean on/off reading
 *  mis-categorised as `power` (a media_player, a thermostat's own switch) is a
 *  STATE, not a measurement, and must not enrol as a submeter. */
function hasMeteringBinding(eq: EquipmentWithDetails): boolean {
  return eq.dataBindings.some(
    (b) =>
      (b.category === "power" ||
        b.category === "energy" ||
        b.alias === "power" ||
        b.alias === "energy") &&
      b.type === "number",
  );
}

export function isMeteringSwitch(eq: EquipmentWithDetails): boolean {
  return METERING_RELAY_TYPES.has(eq.type) && hasMeteringBinding(eq);
}

export function isSubmeterEquipment(eq: EquipmentWithDetails): boolean {
  if (NON_SUBMETER_TYPES.has(eq.type)) return false;
  // A declared energy_meter qualifies on type alone (card renders at 0, #527).
  return eq.type === "energy_meter" || hasMeteringBinding(eq);
}

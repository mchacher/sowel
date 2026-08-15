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
 * On/off relay types that can double as a consumption submeter when they
 * report power/energy: a metering plug (spec 129) and a water_heater relay
 * (spec 135 / #521). Mirror of METERING_RELAY_TYPES in src/equipments/metering.ts.
 */
export const METERING_RELAY_TYPES: ReadonlySet<string> = new Set(["switch", "water_heater"]);

export function isMeteringSwitch(eq: EquipmentWithDetails): boolean {
  return (
    METERING_RELAY_TYPES.has(eq.type) &&
    eq.dataBindings.some(
      (b) =>
        b.category === "power" ||
        b.category === "energy" ||
        b.alias === "power" ||
        b.alias === "energy",
    )
  );
}

export function isSubmeterEquipment(eq: EquipmentWithDetails): boolean {
  return eq.type === "energy_meter" || isMeteringSwitch(eq);
}

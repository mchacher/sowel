// Metering-aware switch helpers (spec 129) — UI mirror of
// src/equipments/metering.ts. A `switch` with a power/energy binding is a
// metering smart plug (e.g. SONOFF S60ZBTPF): it shows live power and counts
// as a consumption submeter, while a bare relay stays a plain on/off switch.
import type { EquipmentWithDetails } from "../types";

export function isMeteringSwitch(eq: EquipmentWithDetails): boolean {
  return (
    eq.type === "switch" &&
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

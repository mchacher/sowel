import type { EquipmentWithDetails } from "../../types";
import { findOrderByCategory } from "../equipments/bindingUtils";

/**
 * Spec 146 — decide whether a gate action must be confirmed on the mobile
 * dashboard before it actuates.
 *
 * True only when ALL hold:
 *  - the equipment is a `gate` (covers portail battant/coulissant and porte de
 *    garage — same type, different icon);
 *  - the admin opted in (`requireConfirmation`);
 *  - it exposes a single-action command. Multi-action gates already open the
 *    detail sheet on mobile (two taps, not a one-tap accident), so they are not
 *    guarded in v1.
 *
 * Pure and side-effect free so it can be unit-tested without React.
 */
export function gateNeedsConfirm(equipment: EquipmentWithDetails): boolean {
  if (equipment.type !== "gate" || !equipment.requireConfirmation) return false;
  const command = findOrderByCategory(
    equipment.orderBindings,
    ["gate_trigger"],
    ["command"],
  );
  if (!command) return false;
  return (command.enumValues?.length ?? 0) <= 1;
}

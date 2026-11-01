// ============================================================
// Spec 188 O10 — are this equipment's orders followed to their outcome?
// ============================================================
//
// On by default where a lost command matters and the state proves it: a gate
// and a door. Off by default everywhere else, where the admin may switch it on
// for a cover that reports its end state. Asked by the tracker before it
// follows an order, and by the equipment page to draw the switch.

import type { Equipment, EquipmentType } from "./types.js";

/** Types whose orders the outcome tracking can follow at all. */
export const ORDER_OUTCOME_TYPES: readonly EquipmentType[] = ["gate", "door", "shutter", "awning"];

/** Types followed unless the admin switched it off. */
export const ORDER_OUTCOME_DEFAULT_ON: readonly EquipmentType[] = ["gate", "door"];

export function isOrderOutcomeTracked(
  equipment: Pick<Equipment, "type" | "trackOrderOutcome">,
): boolean {
  if (!ORDER_OUTCOME_TYPES.includes(equipment.type)) return false;
  if (typeof equipment.trackOrderOutcome === "boolean") return equipment.trackOrderOutcome;
  return ORDER_OUTCOME_DEFAULT_ON.includes(equipment.type);
}

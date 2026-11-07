import type { TFunction } from "i18next";
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

/** What `gate_state` can read (equipment-manager): no sensor, or no report yet, is `unknown`. */
export type GateState = "open" | "closed" | "unknown";

/** The gate's state as the confirmation reads it, by category whatever the alias. */
export function gateStateOf(equipment: EquipmentWithDetails): GateState {
  const value = equipment.dataBindings.find((db) => db.category === "gate_state")?.value;
  return value === "open" || value === "closed" ? value : "unknown";
}

/**
 * Spec 196 — the confirmation names what the tap is about to do: an open gate is about
 * to close, a closed one to open. Without a state the tap only "operates" it: an impulse
 * on a gate Sowel cannot see may do either.
 */
export function gateConfirmTexts(
  gateState: GateState,
  name: string,
  t: TFunction,
): { title: string; slideLabel: string } {
  return {
    title: t(`controls.gate.confirmTitle.${gateState}`, { name }),
    slideLabel: t(`controls.gate.slideTo.${gateState}`),
  };
}

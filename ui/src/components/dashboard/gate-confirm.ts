import type { TFunction } from "i18next";
import type { EquipmentWithDetails } from "../../types";
import { findOrderByCategory } from "../equipments/bindingUtils";

/**
 * Spec 146, extended by spec 196 (slice P) — does actuating this gate ask first?
 *
 * True when ALL hold:
 *  - the equipment is a `gate` (covers portail battant/coulissant and porte de
 *    garage — same type, different icon);
 *  - the admin opted in (`requireConfirmation`);
 *  - it exposes a command to actuate.
 *
 * Spec 146 v1 left multi-action gates out, because on the mobile dashboard they
 * open a detail sheet first. Spec 196 guards every UI path where one tap or click
 * actuates the gate, and the buttons of that sheet are such a path, so the answer
 * no longer depends on the shape of the command.
 *
 * Pure and side-effect free so it can be unit-tested without React.
 */
export function gateNeedsConfirm(equipment: EquipmentWithDetails): boolean {
  if (equipment.type !== "gate" || !equipment.requireConfirmation) return false;
  return !!findOrderByCategory(equipment.orderBindings, ["gate_trigger"], ["command"]);
}

/** What `gate_state` can read (equipment-manager): no sensor, or no report yet, is `unknown`. */
export type GateState = "open" | "closed" | "unknown";

/** The gate's state as the confirmation reads it, by category whatever the alias. */
export function gateStateOf(equipment: EquipmentWithDetails): GateState {
  const value = equipment.dataBindings.find((db) => db.category === "gate_state")?.value;
  return value === "open" || value === "closed" ? value : "unknown";
}

/** What a press is about to do, in the words the confirmation and the buttons use. */
export type GateAction = "open" | "close" | "stop" | "operate";

/**
 * Spec 196 — the action a press asks for.
 *
 * A multi-action gate names it in the enum value it sends (OPEN, CLOSE, STOP);
 * an impulse sends nothing, and then the state says what it will do: an open
 * gate is about to close, a closed one to open. Without a state, or with a value
 * Sowel has no word for, the press only "operates" the gate: an impulse on a gate
 * Sowel cannot see may do either.
 */
export function gateActionOf(value: string | null | undefined, gateState: GateState): GateAction {
  if (value === null || value === undefined || value === "") {
    return gateState === "open" ? "close" : gateState === "closed" ? "open" : "operate";
  }
  if (/^open$/i.test(value)) return "open";
  if (/^close$/i.test(value)) return "close";
  if (/^stop$/i.test(value)) return "stop";
  return "operate";
}

/** The label of a multi-action button: the translated verb, or the raw value when Sowel has no word for it. */
export function gateValueLabel(value: string, t: TFunction): string {
  const action = gateActionOf(value, "unknown");
  return action === "operate" ? value : t(`controls.gate.action.${action}`);
}

/** The words of a confirmation for one action: title, slide (touch) and button (pointer). */
export function gateConfirmTexts(
  action: GateAction,
  name: string,
  t: TFunction,
): { title: string; slideLabel: string; confirmLabel: string } {
  return {
    title: t(`controls.gate.confirmTitle.${action}`, { name }),
    slideLabel: t(`controls.gate.slideTo.${action}`),
    confirmLabel: t(`controls.gate.action.${action}`),
  };
}

/** Everything a confirmation shows, whichever form it takes (slide on touch, dialog with a pointer). */
export interface ConfirmPrompt {
  title: string;
  subtitle?: string;
  slideLabel: string;
  confirmLabel: string;
  confirmedLabel: string;
}

/**
 * The confirmation for one press on a gate: the action it asks for, the gate's
 * name, then its zone and the state it reads now. A value Sowel has no word for
 * is titled « Actionner » and named as is in the subtitle, so the confirmation
 * still says which of the buttons was pressed.
 */
export function gatePrompt(
  equipment: EquipmentWithDetails,
  value: string | null,
  t: TFunction,
  zoneName?: string,
): ConfirmPrompt {
  const gateState = gateStateOf(equipment);
  const action = gateActionOf(value, gateState);
  const rawValue = value && action === "operate" ? value : undefined;
  const subtitle = [zoneName, rawValue, t(`controls.gate.${gateState}`)].filter(Boolean).join(" · ");
  return {
    ...gateConfirmTexts(action, equipment.name, t),
    subtitle: subtitle || undefined,
    confirmedLabel: t("controls.gate.actuated"),
  };
}

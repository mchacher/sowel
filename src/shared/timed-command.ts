// ============================================================
// Spec 174 phase 2 — may this equipment carry a timed command?
// ============================================================
//
// Asked in three places: the API before it arms, the equipment page before it
// mounts the configuration panel, and the widget picker before it offers the
// timed tile. One implementation, three callers, so the surfaces cannot come to
// disagree about which equipments can be armed — the failure #832 documents.
//
// The rule has two halves, and the second is the one that matters.
//
// The equipment must carry the order being armed: obvious, and cheap to check
// where the configuration is written rather than where it is fired.
//
// It must also carry a STATE READING tied to that order. Without one, FR-4
// (a revert done by hand disarms the window) can never fire: nothing tells the
// engine the user already closed the gate, so the deadline runs to its end and
// acts on an equipment that is no longer where it was left. On a sequential
// impulse that means re-opening it. A blind relay is therefore refused, not
// because the timer would not work, but because nobody could end it early.
//
// Accepted, and written down rather than hidden: a reed contact only certifies
// `closed`. A manual close the contact does not see leaves the deadline
// standing, and it will re-open the gate.

import type { DataCategory } from "./types.js";

/**
 * Reading categories that describe the state of an ACTUATOR, i.e. the thing a
 * timed command moves. A sensor category (temperature, motion) says nothing
 * about whether the command took effect and does not qualify.
 */
export const TIMED_STATE_CATEGORIES: ReadonlySet<string> = new Set<DataCategory>([
  "light_state",
  "gate_state",
  "cover_state",
  "lock_state",
  "appliance_state",
]);

interface BindingLike {
  alias?: string | null;
  category?: string | null;
}

interface EquipmentLike {
  orderBindings: readonly BindingLike[];
  dataBindings: readonly BindingLike[];
  timedCommand?: { alias: string } | null;
}

/**
 * True when `alias` can be armed on this equipment.
 *
 * `alias` defaults to the configured command's, so a caller holding only the
 * equipment asks the same question the API will ask when the control is pressed.
 * With neither an argument nor a configuration there is nothing to judge, and
 * the answer is false.
 */
export function isTimedCommandEligible(equipment: EquipmentLike, alias?: string): boolean {
  const target = alias ?? equipment.timedCommand?.alias;
  if (!target) return false;
  if (!equipment.orderBindings.some((b) => b.alias === target)) return false;
  return equipment.dataBindings.some(
    (b) => b.alias === target || (b.category != null && TIMED_STATE_CATEGORIES.has(b.category)),
  );
}

/**
 * True when SOME order on this equipment could be armed.
 *
 * The question a surface asks before there is any configuration to judge: the
 * equipment page mounts its panel on this, and the widget picker offers the
 * timed tile on it. `isTimedCommandEligible` answers about one named order and
 * would say no on an equipment that simply has not been configured yet.
 */
export function hasTimedCommandCandidate(equipment: EquipmentLike): boolean {
  return equipment.orderBindings.some(
    (b) => typeof b.alias === "string" && isTimedCommandEligible(equipment, b.alias),
  );
}

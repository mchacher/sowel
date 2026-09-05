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

// ============================================================
// Spec 178 — the ladder of window lengths
// ============================================================
//
// Kept beside the eligibility rule, and pure, because three callers need the
// same answers: the manager when a press lands, the write validation, and the
// UI when it names what the next press will do. A ladder resolved twice is a
// ladder that will disagree with itself.

/** Fewest rungs worth calling a ladder. One rung is `durationMs`, and a press
 *  past it would give the deadline up instantly — a foot-gun on a gate. */
export const MIN_DURATION_STEPS = 2;
/** Most rungs. Past this, a press is a lottery rather than a choice. */
export const MAX_DURATION_STEPS = 6;

/**
 * The FR-1 rules, as named errors rather than a boolean, so the API can say
 * which one was broken instead of "invalid".
 */
export function validateDurationSteps(
  steps: readonly number[],
  minMs: number,
  maxMs: number,
): string[] {
  const errors: string[] = [];
  if (steps.length < MIN_DURATION_STEPS || steps.length > MAX_DURATION_STEPS) {
    errors.push(
      `A ladder has between ${MIN_DURATION_STEPS} and ${MAX_DURATION_STEPS} steps, got ${steps.length}`,
    );
  }
  for (const [i, ms] of steps.entries()) {
    if (!Number.isFinite(ms) || ms < minMs || ms > maxMs) {
      errors.push(`Step ${i + 1} is outside the allowed window length`);
    }
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] <= steps[i - 1]) {
      errors.push(`Step ${i + 1} must be longer than step ${i}`);
      break;
    }
  }
  return errors;
}

/**
 * Which rung a standing window is on, given what was stored and how long the
 * window actually is (FR-6).
 *
 * The stored index is trusted only while it still describes the same length:
 * a configuration edited under a running window would otherwise make the next
 * press jump to a rung nobody asked for. Failing that, the window is placed on
 * the shortest rung that is not shorter than itself — the honest reading of
 * "you are at least here". A window longer than every rung lands past the end,
 * where the next press gives up.
 *
 * Returns an index that may equal `steps.length`, meaning past-the-top.
 */
export function resolveStep(
  steps: readonly number[],
  storedIndex: number,
  currentDurationMs: number,
): number {
  if (steps.length === 0) return 0;
  if (
    Number.isInteger(storedIndex) &&
    storedIndex >= 0 &&
    storedIndex < steps.length &&
    steps[storedIndex] === currentDurationMs
  ) {
    return storedIndex;
  }
  const found = steps.findIndex((ms) => ms >= currentDurationMs);
  return found === -1 ? steps.length : found;
}

/** The length of the next press, or null when it would give the deadline up. */
export function nextStep(steps: readonly number[], index: number): number | null {
  const next = index + 1;
  return next < steps.length ? steps[next] : null;
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

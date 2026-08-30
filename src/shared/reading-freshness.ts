// ============================================================
// Reading freshness — is this measurement current, or a leftover?
//
// A `power` binding can carry a value of unbounded age while its equipment is
// nominally online, and nothing in the payload says so. Issue #744 measured
// what that looks like in production: a water heater drawing 560 W displayed
// as 0 W, because its clamp had last reported sixteen minutes earlier, and a
// wood stove contributing a reading 124 days old. The failure is quiet, since
// a stale `0 W` reads as "this appliance is off", which is a perfectly
// plausible thing for a water heater to be.
//
// The binding's own `stale` flag cannot answer this. `equipment-status.ts`
// applies the electrical window only to METERING_EQUIPMENT_TYPES, on purpose:
// a steady load stops producing updates, and a tight window would flag a
// perfectly healthy appliance as degraded on every reporting cycle. That
// exemption is right for equipment STATUS and leaves DISPLAY with no answer,
// which is what this module supplies.
//
// It lives in shared/ because the question is asked on at least three
// surfaces: the Live breakdown, the `?role=submeter` feed the energy display
// consumes, and the equipment cards (issue #832). A rule restated per surface
// is how the breakdown and the arbitration card came to describe one appliance
// two contradictory ways in the first place.
// ============================================================

import {
  DEFAULT_STREAMING_TIMEOUT_MS,
  METERING_EQUIPMENT_TYPES,
  STREAMING_TIMEOUT_MS,
} from "./constants.js";

/**
 * How old a reading may be, on an equipment the engine itself treats as a
 * meter, and still count as a live measurement.
 *
 * Taken from the engine's own per-category window rather than a number picked
 * here, so these age out at the same moment everything else does. Two minutes
 * for `power`.
 */
export const SUBMETER_FRESHNESS_MS = STREAMING_TIMEOUT_MS.power ?? DEFAULT_STREAMING_TIMEOUT_MS;

/**
 * The same budget for every other equipment type, and it has to be looser.
 *
 * Four official integrations (SmartThings, Legrand, Panasonic Comfort Cloud,
 * MCZ Maestro) poll on a 300 s default, and the #744 production snapshot shows
 * two such rows at an age of 270 s with nothing wrong. A two-minute budget
 * would have made them read "outdated" for three minutes out of every five,
 * their watts jumping in and out of the residual roughly once a second.
 *
 * Ten minutes is twice the slowest supported default cadence, so no supported
 * source oscillates, and it is still far below both cases #744 is about: a
 * water heater 13.5 minutes behind while drawing 560 W, and a wood stove 124
 * days behind. It also buys margin against a viewer's browser clock running
 * ahead of the Sowel host, which is the other thing this comparison is exposed
 * to on the UI side.
 */
export const SUBMETER_FRESHNESS_SLOW_MS = 10 * 60 * 1000;

/** The freshness budget that applies to an equipment of this type. */
export function freshnessBudgetFor(equipmentType: string): number {
  return METERING_EQUIPMENT_TYPES.has(equipmentType)
    ? SUBMETER_FRESHNESS_MS
    : SUBMETER_FRESHNESS_SLOW_MS;
}

/**
 * Parse a binding timestamp. The API emits both `2026-05-27T08:00:00Z` and the
 * SQLite-flavoured `2026-05-27 08:00:00Z`; treat them alike.
 *
 * Returns null when there is nothing parseable, which callers must read as "no
 * information about age", never as "old".
 */
export function parseReadingTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T").replace("Z", "") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a reading may be presented as a current measurement.
 *
 * A timestamp that is absent or unparseable counts as current: there is no
 * evidence the value is old, and that is how the backend reads it too (a
 * binding with `lastUpdated === null` has never reported and is not stale).
 */
export function isReadingCurrent(
  lastUpdated: string | null | undefined,
  equipmentType: string,
  now: number = Date.now(),
): boolean {
  const at = parseReadingTime(lastUpdated);
  if (at === null) return true;
  return now - at <= freshnessBudgetFor(equipmentType);
}

/** Why a power reading may or may not be drawn as a live measurement. */
export type ReadingVerdict = "current" | "offline" | "stale" | "missing";

/**
 * The one classification both surfaces ask for (#832).
 *
 * Order matters and is not arbitrary. `offline` outranks `stale` because it is
 * the more specific fact: an equipment whose device dropped off the network
 * has no live reading whatever the age of the last one, and saying "outdated"
 * there would send the reader looking at a reporting interval instead of at a
 * dead radio. Age is only asked once the equipment is nominally present.
 *
 * Splitting this decision between the surfaces is what the first draft of #832
 * did, and it immediately reproduced the defect it was fixing: the web
 * breakdown reported `offline` while the submeter feed said the very same
 * reading was current, for one appliance, at one instant.
 */
export function classifyPowerReading(opts: {
  status: string;
  /** The `power` binding's value, or undefined when there is no such binding. */
  value: unknown;
  lastUpdated: string | null | undefined;
  equipmentType: string;
  now?: number;
}): ReadingVerdict {
  if (opts.status === "offline") return "offline";
  if (typeof opts.value !== "number") return "missing";
  return isReadingCurrent(opts.lastUpdated, opts.equipmentType, opts.now ?? Date.now())
    ? "current"
    : "stale";
}

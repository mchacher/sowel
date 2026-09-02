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

/**
 * The aliases that can carry a live power reading, in the order a surface
 * should prefer them.
 *
 * `demand_5min` is not a second-class `power`: a Legrand NLPC meter has no
 * `power` channel at all, so a surface that looks up `power` alone does not
 * read a stale value, it reads nothing and silently omits the meter. That is
 * why `pickLivePowerW` falls back on it, and why anything summing meters must
 * do the same or under-report a supported meter shape (#866 review).
 */
export const LIVE_POWER_ALIASES = ["power", "demand_5min"] as const;

/** The freshness budget that applies to an equipment of this type. */
export function freshnessBudgetFor(equipmentType: string): number {
  return METERING_EQUIPMENT_TYPES.has(equipmentType)
    ? SUBMETER_FRESHNESS_MS
    : SUBMETER_FRESHNESS_SLOW_MS;
}

/**
 * The freshness budget for one power reading, when the binding's own cadence
 * outranks the window its equipment type implies (#839).
 *
 * `METERING_EQUIPMENT_TYPES` earns the tight two-minute window because the
 * engine expects a declared meter to report continuously. Two sources in that
 * set do not, and applying it to them calls a healthy device outdated for most
 * of every reporting cycle:
 *
 * - `demand_5min`: a Legrand NLPC reports a power already averaged over five
 *   minutes, so the reading cannot be fresher than five minutes by
 *   construction.
 * - `solar_panel`: the one solar integration in the registry (apsystems)
 *   delivers on a Tasmota `tele/<root>/SENSOR` topic, whose default
 *   `TelePeriod` is 300 s.
 *
 * The ten-minute slow budget is twice the slowest of those cadences, so neither
 * oscillates, and it still catches what #744 is about (a reading 124 days old).
 *
 * This lives here rather than on one surface because both the equipment tiles
 * (#839) and the zone power total (spec 170) have to ask it, and a rule
 * restated per surface is how two surfaces came to describe one appliance two
 * contradictory ways in the first place.
 */
export function powerBudgetFor(equipmentType: string, bindingAlias?: string | null): number {
  if (bindingAlias === "demand_5min") return SUBMETER_FRESHNESS_SLOW_MS;
  if (equipmentType === "solar_panel") return SUBMETER_FRESHNESS_SLOW_MS;
  return freshnessBudgetFor(equipmentType);
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
  budgetMs: number = freshnessBudgetFor(equipmentType),
): boolean {
  const at = parseReadingTime(lastUpdated);
  if (at === null) return true;
  return now - at <= budgetMs;
}

/**
 * How long a power reading may keep ARRIVING with an unchanged full-precision
 * value before it stops being a measurement and becomes a stuck source.
 *
 * This is the other half of the question, and until #881 nothing asked it. A
 * source that republishes a cached value forever satisfies every timestamp
 * check ever written: `lastUpdated` is a second old, the equipment is online,
 * and the figure on screen is fiction. The only witness is the value itself,
 * and it has to be read at full precision — the Live page rounds watts to the
 * nearest 5 W below 1 kW and to 0.1 kW above, so a reader watching the screen
 * cannot tell a stuck 2.4 kW from a live one swinging by 49 W.
 *
 * Ten minutes because a real electrical measurement, compared as stored rather
 * than as displayed, essentially never repeats exactly: mains voltage drifts,
 * loads breathe, an inverter's MPPT hunts. Two identical full-precision
 * readings ten minutes apart is not a quiet house, it is a source that stopped
 * measuring.
 */
export const FROZEN_READING_MS = 10 * 60 * 1000;

/**
 * Why a power reading may or may not be drawn as a live measurement.
 *
 * `stale` and `frozen` are two different failures and read as two different
 * sentences: `stale` is silence (nothing arrived), `frozen` is a source still
 * talking but no longer measuring. Only callers that pass `lastChanged` can
 * receive `frozen`, so a surface that has not been taught the difference never
 * sees a verdict it would mishandle.
 */
export type ReadingVerdict = "current" | "offline" | "stale" | "frozen" | "missing";

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
  /**
   * Budget override, for a binding whose own nature outranks its equipment's
   * type. The only current case is `demand_5min`: a Legrand NLPC meter reports
   * a power already averaged over five minutes, so it cannot be fresher than
   * five minutes and the two-minute meter window would call a healthy meter
   * outdated most of the time (#839). Defaults to `freshnessBudgetFor(type)`.
   */
  budgetMs?: number;
  /**
   * When the binding's value last actually MOVED, compared at full precision
   * (`last_changed` in SQLite, `lastChanged` on the API payload — both written
   * from the serialized value, never from a rounded or formatted one).
   *
   * Opt-in: omit it and the classifier behaves exactly as before. Pass it and
   * a source that keeps talking without measuring earns `frozen` (#881).
   */
  lastChanged?: string | null;
  /** Budget for the `frozen` check. Defaults to `FROZEN_READING_MS`. */
  frozenAfterMs?: number;
}): ReadingVerdict {
  if (opts.status === "offline") return "offline";
  if (typeof opts.value !== "number") return "missing";
  const now = opts.now ?? Date.now();
  if (
    !isReadingCurrent(
      opts.lastUpdated,
      opts.equipmentType,
      now,
      opts.budgetMs ?? freshnessBudgetFor(opts.equipmentType),
    )
  ) {
    // Silence outranks a stuck value: when nothing has arrived, the value not
    // moving is a consequence, not a second fact to report.
    return "stale";
  }
  if (
    opts.lastChanged !== undefined &&
    isFrozenReading(opts.value, opts.lastChanged, now, opts.frozenAfterMs)
  ) {
    return "frozen";
  }
  return "current";
}

/**
 * A reading still arriving, whose full-precision value has not moved for long
 * enough that the source cannot credibly still be measuring.
 *
 * Exactly zero is exempt, and that exemption is the whole reason this is a
 * separate function rather than a subtraction. Zero is the one value a healthy
 * meter genuinely holds for hours: a production meter at night, a submeter on
 * an appliance nobody switched on. A stuck zero and a true zero are
 * indistinguishable from the value alone, so they are left to the silence
 * check, which is what caught the #744 water heater anyway (its readings had
 * stopped arriving thirteen minutes earlier — that was silence, not a stuck
 * value).
 */
function isFrozenReading(
  value: number,
  lastChanged: string | null | undefined,
  now: number,
  frozenAfterMs: number = FROZEN_READING_MS,
): boolean {
  if (value === 0) return false;
  const at = parseReadingTime(lastChanged);
  // No parseable timestamp is no evidence, same reading as `isReadingCurrent`.
  if (at === null) return false;
  return now - at > frozenAfterMs;
}

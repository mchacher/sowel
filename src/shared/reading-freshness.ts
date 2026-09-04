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
 * It used to hold `demand_5min` as a fallback, on the premise that a Legrand
 * NLPC meter has no `power` channel. Both halves were wrong (#883): the plugin
 * declares `power`, `energy`, `autoconso`, `injection` and `demand_30min`, and
 * has never declared `demand_5min` in any commit. No plugin in the registry
 * produces that alias; its only declaration in this repository's history was a
 * test fixture. A fallback that fires for no device is not a fallback, so it is
 * gone rather than carried into the cadence rule (spec 175).
 */
export const LIVE_POWER_ALIASES = ["power"] as const;

/** The freshness budget that applies to an equipment of this type. */
export function freshnessBudgetFor(equipmentType: string): number {
  return METERING_EQUIPMENT_TYPES.has(equipmentType)
    ? SUBMETER_FRESHNESS_MS
    : SUBMETER_FRESHNESS_SLOW_MS;
}

/** A source reporting every T is given 2.5 T of silence before it is doubted. */
export const CADENCE_MULTIPLIER = 2.5;

/**
 * The tightest budget any source earns, whatever its cadence.
 *
 * A Shelly at 1 Hz would otherwise be doubted after 2.5 seconds, and a single
 * dropped MQTT message would paint the whole page stale. Two minutes is what
 * the engine already calls a live electrical read.
 */
export const BUDGET_FLOOR_MS = SUBMETER_FRESHNESS_MS;

/**
 * The loosest, whatever the cadence says.
 *
 * A poll configured above 720 s therefore reads "outdated" between two of its
 * own relevés, and that is a decision rather than an oversight: past half an
 * hour of silence, a dead source is the likelier reading of the evidence, and a
 * genuinely slow integration is covered by its device going offline, not by
 * this window.
 */
export const BUDGET_CEILING_MS = 30 * 60 * 1000;

/**
 * The budget before anything is known about a source: after a restart, or for a
 * binding whose device has yet to report three times.
 *
 * Deliberately the loose window rather than the tight one. Reading "outdated"
 * across every meter for the first minutes after a restart would be a defect
 * introduced by the fix, and an estimator with no samples has no standing to
 * claim a tight window.
 */
export const BUDGET_LEARNING_MS = SUBMETER_FRESHNESS_SLOW_MS;

/**
 * How old a power reading may be, derived from what its source actually does
 * (spec 175).
 *
 * This replaces `powerBudgetFor`, which answered from the equipment's type and
 * from an alias no plugin has ever produced. A type says nothing about how
 * often a device speaks: `main_energy_meter` covers both a Shelly streaming at
 * 1 Hz and a cloud integration polling every 300 s, and one constant has to be
 * wrong for one of them. #881 is what being wrong for the slow one looks like;
 * a 1 Hz meter taking ten minutes to be declared dead is what being wrong for
 * the fast one costs.
 *
 * Observed outranks declared: a plugin polling every 300 s whose upstream API
 * only refreshes hourly is described by its arrivals, not by its timer.
 *
 * The multiplier is 2.5 rather than 2 because a "300 s" poll arrives at 305 to
 * 320 s routinely (timer drift, the round trip, the engine's own write), and at
 * exactly twice the cadence a healthy source sits on the boundary and
 * oscillates — the same failure as #881, one factor smaller.
 */
export function resolveFreshnessBudget(cadence: {
  observedMs?: number | null;
  declaredMs?: number | null;
}): number {
  const base = cadence.observedMs ?? cadence.declaredMs ?? null;
  if (base === null || !Number.isFinite(base) || base <= 0) return BUDGET_LEARNING_MS;
  return Math.min(Math.max(base * CADENCE_MULTIPLIER, BUDGET_FLOOR_MS), BUDGET_CEILING_MS);
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
 * An hour, and deliberately far longer than the silence budget, because the
 * premise that a live measurement never repeats exactly has exceptions and
 * they are not rare. A string inverter clipping at its AC cap publishes the
 * same figure for as long as the sun holds; a meter quantising to whole watts
 * on a flat load can do the same. Ten minutes would have put a permanent
 * banner over exactly those installations, which is the failure this whole
 * issue is about, only pointed the other way. An hour of an identical
 * full-precision reading survives clipping plateaus and still catches a source
 * that stopped measuring long before anyone reads the figure as a day's
 * production.
 *
 * A known and accepted gap: `last_changed` only advances on a distinct value,
 * so a meter coming back from an outage LONGER than this window, whose first
 * recovered reading happens to be byte-identical to its last one, is called
 * stuck for one cycle. Closing that needs a count of arrivals since the last
 * change, which no payload carries today; the conjunction is rare enough to
 * live with (review of the first draft).
 */
export const FROZEN_READING_MS = 60 * 60 * 1000;

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
   * The budget this reading answers to, normally `binding.freshnessBudgetMs`
   * (spec 175): resolved once by the engine from the source's own cadence and
   * carried on the payload, so the four surfaces that ask this question cannot
   * answer it differently. Defaults to `freshnessBudgetFor(type)` for a caller
   * holding no binding.
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

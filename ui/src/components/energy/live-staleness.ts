/**
 * Is the live flow diagram showing current readings, and if not, whose?
 *
 * Co-located with `LiveEnergyPage.tsx` and exported separately so the page
 * stays focused on rendering and the rule is unit-testable, same split as
 * `submeter-helpers.ts`.
 *
 * The rule this replaces asked the spec 116 equipment `status`, which is a
 * verdict on the whole equipment: it turns `degraded` when ANY streaming
 * binding ages out, `voltage` and `current` at 5 min and `energy` at 10 min
 * included. The diagram draws none of those. On the reference install the
 * production meter alone flipped twelve times in twenty minutes, and the page
 * answered each time with one anonymous "live data stale" sentence, over a
 * grid figure that was updating once a second (#854).
 *
 * So the question is asked of the readings the diagram actually draws, through
 * `classifyPowerReading` — the classifier the backend feed and the submeter
 * breakdown already share (#832) — and the answer is one entry per affected
 * source, because "something here is frozen" is not a thing a reader can act
 * on.
 *
 * One entry per source rather than one verdict for the page: a grid meter off
 * the network for 20 minutes beside a production reading 3 minutes old is two
 * different sentences, and folding them into one lends the older age to the
 * fresher figure (review of the first draft).
 */

import {
  classifyPowerReading,
  parseReadingTime,
  SUBMETER_FRESHNESS_SLOW_MS,
} from "../../../../src/shared/reading-freshness";
import type { EquipmentWithDetails } from "../../types";

/**
 * How long this page lets a meter go quiet before saying so.
 *
 * The two-minute meter window it used to apply is calibrated for a source that
 * streams — a Shelly at 1 Hz — and every polled source in the registry reports
 * far slower than that: `legrand_energy` polls on a 300 s default, and the
 * APsystems bridge publishes on a Tasmota `tele/<root>/SENSOR` topic whose
 * default `TelePeriod` is also 300 s. Two minutes against a five-minute
 * cadence does not detect anything; it puts the banner on screen for three
 * minutes out of every five, permanently, over a healthy meter. That is the
 * report behind #881, and "frozen for 3 min" is just the arithmetic of it.
 *
 * Ten minutes is twice the slowest supported cadence, so no supported source
 * oscillates. The cost is stated plainly: a genuinely dead 1 Hz meter now
 * surfaces in ten minutes instead of two. For a banner whose job is to stop a
 * reader trusting a stale figure, ten minutes of delay is worth incomparably
 * less than an alert that is wrong most of the time and learned to be ignored.
 *
 * The window is fixed rather than derived from each meter's observed cadence,
 * which is what it should eventually be (Sowel already has the arrival times
 * in `device_data`); doing that needs the cadence carried on the payload, and
 * it is not needed to make this banner honest.
 */
const SILENCE_BUDGET_MS = SUBMETER_FRESHNESS_SLOW_MS;

/** Which side of the diagram a flagged reading belongs to. */
export type LiveSource = "grid" | "solar";

export interface LiveStalenessEntry {
  source: LiveSource;
  /**
   * `offline` when the meter's device dropped, `stale` when nothing has
   * arrived for a while, `frozen` when readings keep arriving but the value
   * itself stopped moving.
   */
  mode: "stale" | "offline" | "frozen";
  /**
   * Timestamp this entry dates from. Null only for a meter offline since we
   * never knew when — the caller then drops the duration from the sentence.
   */
  since: string | null;
}

/**
 * Judge one meter, or return null when its reading may be presented as current.
 *
 * An equipment with no `power` binding is never judged at all: it contributes
 * no figure to the diagram in the first place (`sumPower` skips it), so there
 * is nothing frozen to warn about. Asking `classifyPowerReading` would answer
 * `offline` for it whenever its device is down, which is true, useless here,
 * and dated from nothing (review of the first draft).
 */
function judgeMeter(
  eq: EquipmentWithDetails,
  source: LiveSource,
  now: number,
): LiveStalenessEntry | null {
  const binding = eq.dataBindings.find((b) => b.alias === "power");
  if (!binding) return null;
  const verdict = classifyPowerReading({
    status: eq.status,
    value: binding.value,
    lastUpdated: binding.lastUpdated,
    equipmentType: eq.type,
    now,
    budgetMs: SILENCE_BUDGET_MS,
    // The liveness proof this page was missing: the value as stored, at full
    // precision, never the rounded figure the diagram draws (#881).
    lastChanged: binding.lastChanged,
  });
  if (verdict === "offline") {
    // A disconnected meter dates from when its device dropped, which is older
    // than its last reading and is what the reader wants to hear about.
    return {
      source,
      mode: "offline",
      since: eq.statusReason?.offlineSince ?? binding.lastUpdated ?? null,
    };
  }
  if (verdict === "stale") {
    // `stale` is only ever returned for a timestamp that parsed, so this one
    // is never null.
    return { source, mode: "stale", since: binding.lastUpdated };
  }
  if (verdict === "frozen") {
    // Dated from the last time the value actually moved, not from the last
    // message: the messages are exactly what is not the problem here.
    return { source, mode: "frozen", since: binding.lastChanged };
  }
  return null;
}

/**
 * The entry to keep when several meters feed one side of the diagram.
 *
 * Offline outranks the rest, the same precedence `classifyPowerReading` applies
 * within one meter: a dead radio is the more specific fact, and describing it
 * as a late reading sends the reader looking at a reporting interval instead.
 * Frozen then outranks stale, because a source still publishing a value that
 * stopped moving is actively misleading, where a late one is merely late.
 * Within one mode, the oldest wins.
 */
const RANK: Record<LiveStalenessEntry["mode"], number> = { offline: 2, frozen: 1, stale: 0 };

function worse(a: LiveStalenessEntry, b: LiveStalenessEntry): LiveStalenessEntry {
  if (a.mode !== b.mode) return RANK[a.mode] > RANK[b.mode] ? a : b;
  const aMs = parseReadingTime(a.since);
  const bMs = parseReadingTime(b.since);
  if (aMs === null) return b;
  if (bMs === null) return a;
  return aMs <= bMs ? a : b;
}

/**
 * One entry per affected source, in diagram order (grid first). Empty when
 * every reading the diagram draws is current — the caller renders no banner.
 *
 * @param gridEqs  Equipments of type `main_energy_meter` feeding the grid tile.
 * @param solarEqs Equipments of type `energy_production_meter` feeding the
 *                 production tile.
 * @param now      Injection point for tests; defaults to Date.now().
 */
export function detectLiveStaleness(
  gridEqs: EquipmentWithDetails[],
  solarEqs: EquipmentWithDetails[],
  now: number = Date.now(),
): LiveStalenessEntry[] {
  const entries: LiveStalenessEntry[] = [];
  for (const [source, equipments] of [
    ["grid", gridEqs],
    ["solar", solarEqs],
  ] as const) {
    let worst: LiveStalenessEntry | null = null;
    for (const eq of equipments) {
      const entry = judgeMeter(eq, source, now);
      if (entry) worst = worst === null ? entry : worse(worst, entry);
    }
    if (worst) entries.push(worst);
  }
  return entries;
}

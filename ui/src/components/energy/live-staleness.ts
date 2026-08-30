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
 * breakdown already share (#832) — and the answer carries which source is
 * affected, because "something here is frozen" is not a thing a reader can act
 * on.
 */

import { classifyPowerReading, parseReadingTime } from "../../../../src/shared/reading-freshness";
import type { EquipmentWithDetails } from "../../types";

/** Which side of the diagram a flagged reading belongs to. */
export type LiveSource = "grid" | "solar";

export interface LiveStaleness {
  /** `offline` only when every flagged meter is disconnected. */
  mode: "stale" | "offline";
  /** Affected sources, in diagram order (grid first). Never empty. */
  sources: LiveSource[];
  /** Oldest offending timestamp across the flagged meters, for "for {when}". */
  since: string | null;
}

interface Flag {
  source: LiveSource;
  offline: boolean;
  since: string | null;
}

/**
 * Flag one meter, or return null when its reading may be presented as current.
 *
 * A `missing` verdict is not a flag: an equipment with no `power` binding
 * never contributed a figure to the diagram in the first place (`sumPower`
 * skips it), so there is nothing frozen to warn about.
 */
function flagMeter(eq: EquipmentWithDetails, source: LiveSource, now: number): Flag | null {
  const binding = eq.dataBindings.find((b) => b.alias === "power");
  const verdict = classifyPowerReading({
    status: eq.status,
    value: binding?.value,
    lastUpdated: binding?.lastUpdated,
    equipmentType: eq.type,
    now,
  });
  if (verdict === "offline") {
    // A disconnected meter dates from when its device dropped, which is older
    // than its last reading and is what the reader wants to hear about.
    return { source, offline: true, since: eq.statusReason?.offlineSince ?? binding?.lastUpdated ?? null };
  }
  if (verdict === "stale") {
    return { source, offline: false, since: binding?.lastUpdated ?? null };
  }
  return null;
}

/** The oldest of a set of timestamps, parsed rather than compared as strings:
 *  the API emits both `2026-08-30T15:49:01Z` and the SQLite-flavoured
 *  `2026-08-30 15:49:01Z`, and a lexicographic `<` sorts the space before the
 *  `T` regardless of the instants they carry. */
function oldest(values: (string | null)[]): string | null {
  let best: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const ms = parseReadingTime(value);
    if (ms === null || ms >= bestMs) continue;
    best = value;
    bestMs = ms;
  }
  return best;
}

/**
 * Returns null when every reading the diagram draws is current — the caller
 * renders no banner.
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
): LiveStaleness | null {
  const flags: Flag[] = [];
  for (const eq of gridEqs) {
    const flag = flagMeter(eq, "grid", now);
    if (flag) flags.push(flag);
  }
  for (const eq of solarEqs) {
    const flag = flagMeter(eq, "solar", now);
    if (flag) flags.push(flag);
  }
  if (flags.length === 0) return null;

  // Offline wording is kept for the case where nothing is merely late: a
  // disconnected meter and a frozen one side by side is a page whose readings
  // are all frozen, and the softer sentence is the true one for both.
  const mode = flags.every((f) => f.offline) ? "offline" : "stale";
  const sources: LiveSource[] = [];
  for (const source of ["grid", "solar"] as const) {
    if (flags.some((f) => f.source === source)) sources.push(source);
  }
  return { mode, sources, since: oldest(flags.map((f) => f.since)) };
}

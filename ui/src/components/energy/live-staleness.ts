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

import { classifyPowerReading, parseReadingTime } from "../../../../src/shared/reading-freshness";
import type { EquipmentWithDetails } from "../../types";

/** Which side of the diagram a flagged reading belongs to. */
export type LiveSource = "grid" | "solar";

export interface LiveStalenessEntry {
  source: LiveSource;
  /** `offline` when the meter's device dropped, `stale` when it is merely late. */
  mode: "stale" | "offline";
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
  return null;
}

/**
 * The entry to keep when several meters feed one side of the diagram.
 *
 * Offline outranks stale, the same precedence `classifyPowerReading` applies
 * within one meter: a dead radio is the more specific fact, and describing it
 * as a late reading sends the reader looking at a reporting interval instead.
 * Within one mode, the oldest wins.
 */
function worse(a: LiveStalenessEntry, b: LiveStalenessEntry): LiveStalenessEntry {
  if (a.mode !== b.mode) return a.mode === "offline" ? a : b;
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

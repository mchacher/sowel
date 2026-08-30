/**
 * Pure helpers for the Live submeter breakdown (spec 117).
 * Co-located with `LiveSubmeterBreakdown.tsx` and exported separately
 * so the component stays focused on rendering and the logic is unit-testable.
 */

import type { EquipmentStatus, EquipmentWithDetails } from "../../types";
import { pickSubmeterColor } from "./submeterPalette";
import { isSubmeterEquipment } from "../../lib/metering";
import {
  freshnessBudgetFor,
  isReadingCurrent,
  parseReadingTime,
  SUBMETER_FRESHNESS_MS,
  SUBMETER_FRESHNESS_SLOW_MS,
} from "../../../../src/shared/reading-freshness";

// The freshness rule is the backend's own, imported rather than restated
// (issue #832). It is asked on three surfaces now, and a rule restated per
// surface is how the breakdown and the arbitration card came to describe one
// appliance two contradictory ways in the first place (#744).
export {
  freshnessBudgetFor,
  isReadingCurrent,
  parseReadingTime,
  SUBMETER_FRESHNESS_MS,
  SUBMETER_FRESHNESS_SLOW_MS,
};

/** Why a submeter contributes no number to the breakdown. */
export type SubmeterUnknown = "offline" | "stale" | "missing";

export interface SubmeterRow {
  id: string;
  name: string;
  /** Instantaneous power in W. Null when there is no current measurement. */
  power: number | null;
  /** Set when `power` is null: what is missing, so the row can say so. */
  unknown: SubmeterUnknown | null;
  status: EquipmentStatus;
  /** ISO timestamp from spec 116 statusReason, if available. */
  offlineSince: string | null;
  /** ISO timestamp of the reading that aged out, when `unknown === "stale"`. */
  staleSince: string | null;
  color: string;
}

export interface SubmeterReading {
  power: number | null;
  unknown: SubmeterUnknown | null;
  /** `lastUpdated` of the reading, whether or not it aged out. */
  lastUpdated: string | null;
}

/**
 * Read the `power` alias from a submeter equipment.
 *
 * A reading past its freshness budget is NOT returned as a number (issue
 * #744). Before this rule, the only thing that could drop a reading was
 * `status === "offline"`, so an equipment considered online contributed its
 * last known power at full weight however old it was. Measured on production:
 * a water heater drawing 560 W was displayed as 0 W because its clamp had last
 * reported sixteen minutes earlier, and a wood stove was contributing a value
 * 124 days old. The failure is quiet, since a stale `0 W` reads as "this
 * appliance is off", which is a perfectly plausible thing for it to be.
 *
 * The binding's own `stale` flag cannot stand in for this. The backend applies
 * the electrical window only to METERING_EQUIPMENT_TYPES, on purpose, so a
 * `thermostat` or `water_heater` carrying a power channel reports
 * `stale: false` however old the value is. That exemption is right for
 * equipment status, where flagging a quiet appliance as degraded would be
 * wrong; it just leaves the display with no answer to "is this number
 * current", which is what freshnessBudgetFor supplies.
 *
 * Negative values are returned as their absolute value (clamp wired backwards,
 * same convention as the spec 091 backend integration).
 */
export function readSubmeterReading(
  eq: EquipmentWithDetails,
  now: number = Date.now(),
): SubmeterReading {
  if (eq.status === "offline") return { power: null, unknown: "offline", lastUpdated: null };
  const binding = eq.dataBindings.find((b) => b.alias === "power");
  if (!binding || typeof binding.value !== "number") {
    return { power: null, unknown: "missing", lastUpdated: null };
  }
  if (!isReadingCurrent(binding.lastUpdated, eq.type, now)) {
    return { power: null, unknown: "stale", lastUpdated: binding.lastUpdated };
  }
  return { power: Math.abs(binding.value), unknown: null, lastUpdated: binding.lastUpdated };
}

/**
 * Build the legend rows for the donut.
 * Steps:
 *   1. Filter to submeters: `energy_meter`s + metering switches (spec 129).
 *   2. Sort by `id` ascending and assign a palette color by index — this is
 *      the SAME indexing rule the backend uses for the historical By-usage
 *      chart, so a given equipment gets the same color in both views.
 *   3. Drop rows that carry no power measurement at all: a declared submeter
 *      with no `power` binding contributes nothing and is pure noise in the
 *      legend (#560). Offline rows and rows whose reading aged out both stay:
 *      "we do not know" is information, and hiding a stale row would put the
 *      household back where #744 found it, reading a plausible number that
 *      happens to be wrong.
 *   4. Re-sort the rows for display: by power descending, then the rows with
 *      no number (offline, stale) last.
 *
 * `labels` optionally overrides display names by equipment id (spec 139 —
 * `name — zone` for homonym submeters); sorting uses the displayed name.
 */
export function buildSubmeterRows(
  equipments: EquipmentWithDetails[],
  labels?: Map<string, string>,
  now: number = Date.now(),
): SubmeterRow[] {
  const byId = [...equipments]
    .filter((eq) => isSubmeterEquipment(eq))
    .sort((a, b) => a.id.localeCompare(b.id));

  const rows: SubmeterRow[] = byId
    .map((eq, idx) => {
      const reading = readSubmeterReading(eq, now);
      return {
        id: eq.id,
        name: labels?.get(eq.id) ?? eq.name,
        power: reading.power,
        unknown: reading.unknown,
        status: eq.status,
        offlineSince: eq.statusReason?.offlineSince ?? null,
        staleSince: reading.unknown === "stale" ? reading.lastUpdated : null,
        color: pickSubmeterColor(idx),
      };
    })
    // Never bound, so nothing to say about it (#560).
    .filter((row) => row.unknown !== "missing");

  rows.sort((a, b) => {
    const aNull = a.power === null;
    const bNull = b.power === null;
    if (aNull && !bNull) return 1;
    if (!aNull && bNull) return -1;
    if (aNull && bNull) return a.name.localeCompare(b.name);
    return (b.power as number) - (a.power as number);
  });

  return rows;
}

/**
 * The numeric value `formatPower` actually puts on screen: watts rounded to
 * the nearest 5 below a kilowatt, and to one decimal of a kilowatt above.
 *
 * Shares are computed from this rather than from the raw reading so that the
 * figures on screen agree with each other. Dividing raw values while
 * displaying rounded ones is how a PAC at 10 W of a 32.4 W house came to read
 * "31 % of 35 W" (#744): both numbers were defensible and they contradicted
 * each other, which is worse than either being slightly off.
 */
export function displayedPower(value: number): number {
  if (value < 1000) return Math.round(value / 5) * 5;
  // NOT Math.round(value / 100) * 100: toFixed(1) rounds 1.15 down, because
  // the binary double nearest 1.15 is below the half. The two disagreed on
  // every X50 W step, so a 575 W part in a 1150 W house printed 48 % under a
  // label reading 1.1 kW.
  return Number((value / 1000).toFixed(1)) * 1000;
}

/**
 * A part's share of the whole, in whole percent, as the reader sees both.
 *
 * Clamped to 100. A breakdown cannot have a part larger than the whole, so
 * when the arithmetic says otherwise the honest output is the boundary, not
 * "776 %" (#744). The clamp is a guard, not the fix: it is the freshness rule
 * in `readSubmeterReading` that stops the two sides being measured at
 * different moments in the first place.
 */
export function sharePercent(part: number, whole: number): number | null {
  const w = displayedPower(whole);
  if (w <= 0) return null;
  return Math.min(100, Math.round((displayedPower(part) / w) * 100));
}

/**
 * Residual consumption not captured by any submeter.
 * Clamped to ≥ 0 — when `Σ submeters > house` (noise, clamp inaccuracy),
 * we report 0 rather than a negative value.
 */
export function computeOther(house: number, submeters: SubmeterRow[]): number {
  const sum = submeters.reduce(
    (acc, r) => acc + (r.power ?? 0),
    0,
  );
  return Math.max(0, house - sum);
}

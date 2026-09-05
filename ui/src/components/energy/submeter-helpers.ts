/**
 * Pure helpers for the Live submeter breakdown (spec 117).
 * Co-located with `LiveSubmeterBreakdown.tsx` and exported separately
 * so the component stays focused on rendering and the logic is unit-testable.
 */

import type { EquipmentStatus, EquipmentWithDetails } from "../../types";
import { pickSubmeterColor } from "./submeterPalette";
import { isSubmeterEquipment } from "../../lib/metering";
import {
  BUDGET_LEARNING_MS,
  classifyPowerReading,
  type ReadingVerdict,
} from "../../../../src/shared/reading-freshness";

/** Why a submeter contributes no number to the breakdown. */
export type SubmeterUnknown = Exclude<ReadingVerdict, "current">;

export interface SubmeterRow {
  id: string;
  name: string;
  /** Instantaneous power in W. Null when there is no current measurement. */
  power: number | null;
  /** Set when `power` is null: what is missing, so the row can say so. */
  unknown: SubmeterUnknown | null;
  status: EquipmentStatus;
  /** Spec 173 — power shown net of the submeters declared inside this one. */
  netOfChildren?: boolean;
  /** Spec 177 — fed by a separate supply: rendered apart, never in the donut,
   *  the residual or the shares. */
  separateSupply?: boolean;
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
 * The verdict comes from `classifyPowerReading` in shared/, which the
 * `?role=submeter` API feed calls too (#832). Splitting that decision between
 * the surfaces is how this defect keeps coming back: #744 was the breakdown
 * and the arbitration card describing one appliance two ways, and the first
 * draft of #832 immediately reproduced it, with the feed calling an offline
 * equipment's last reading current while this function called it offline.
 *
 * What the reading itself means, once classified: a value past its freshness
 * budget is NOT returned as a number. Before that rule, the only thing that
 * could drop a reading was `status === "offline"`, so an equipment considered
 * online contributed its last known power at full weight however old it was. A
 * water heater drawing 560 W was displayed as 0 W because its clamp had last
 * reported sixteen minutes earlier, and a wood stove was contributing a value
 * 124 days old. The failure is quiet, since a stale `0 W` reads as "this
 * appliance is off", which is a perfectly plausible thing for it to be.
 *
 * Negative values are returned as their absolute value (clamp wired backwards,
 * same convention as the spec 091 backend integration).
 */
export function readSubmeterReading(
  eq: EquipmentWithDetails,
  now: number = Date.now(),
): SubmeterReading {
  const binding = eq.dataBindings.find((b) => b.alias === "power");
  const verdict = classifyPowerReading({
    status: eq.status,
    value: binding?.value,
    lastUpdated: binding?.lastUpdated,
    equipmentType: eq.type,
    now,
    // The budget the engine resolved from this meter's own cadence (spec 175),
    // the same number the donut's neighbours on the page are judged against.
    budgetMs: binding?.freshnessBudgetMs ?? BUDGET_LEARNING_MS,
  });
  if (verdict === "current") {
    return { power: Math.abs(binding!.value as number), unknown: null, lastUpdated: binding!.lastUpdated };
  }
  return {
    power: null,
    unknown: verdict,
    // Only a stale row has an age worth showing; an offline one shows its own
    // offlineSince, and a missing one has nothing to date.
    lastUpdated: verdict === "stale" ? (binding?.lastUpdated ?? null) : null,
  };
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
  const enrolled = [...equipments]
    .filter((eq) => isSubmeterEquipment(eq))
    .sort((a, b) => a.id.localeCompare(b.id));
  // Spec 177 — partition meters first, separate-supply meters after: the SAME
  // indexing rule the by-usage backend uses, so a given equipment keeps one
  // color across both views even once the flag splits them into two groups.
  const byId = [
    ...enrolled.filter((eq) => !eq.separateSupply),
    ...enrolled.filter((eq) => eq.separateSupply),
  ];

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
        ...(eq.separateSupply ? { separateSupply: true } : {}),
      };
    })
    // Never bound, so nothing to say about it (#560).
    .filter((row) => row.unknown !== "missing");

  // Spec 173 — a submeter fed from another one is already inside its parent's
  // reading, so without this the pair is counted twice here and the residual is
  // short by the child's watts, exactly as it was on the by-usage breakdown.
  // Only DIRECT children are subtracted, which is what makes a chain add back
  // up. A child with no live reading subtracts nothing: "we do not know" must
  // not be spent as a number.
  const rawPower = new Map(rows.map((r) => [r.id, r.power] as const));
  for (const row of rows) {
    if (row.power === null) continue;
    // Spec 177 — containment is a partition concern: a separate-supply parent
    // renders raw in its own group, and a separate-supply child cannot be
    // "inside" a meter on another supply, so its declaration is stored unused.
    if (row.separateSupply) continue;
    let subtracted = 0;
    for (const eq of byId) {
      if (eq.meteringParentId !== row.id || eq.separateSupply) continue;
      subtracted += rawPower.get(eq.id) ?? 0;
    }
    if (subtracted <= 0) continue;
    // Clamped at 0: two clamps sample at different instants and a child can
    // read more than its parent, the same trade-off `subtractChildren` makes.
    row.power = Math.max(0, row.power - subtracted);
    row.netOfChildren = true;
  }

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

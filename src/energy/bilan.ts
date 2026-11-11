import type {
  BilanArbiter,
  BilanComparison,
  BilanPeriod,
  BilanPoint,
  BilanUsageRow,
  EnergyBilanResponse,
  EnergyByUsagePoint,
  EnergyPoint,
  EnergyTotals,
  TariffPrices,
} from "../shared/types.js";
import { localDateStr } from "../shared/local-date.js";
import type { ArbiterGainRow } from "./arbiter-gain-store.js";
import { computeCost } from "./cost-calculator.js";

// Spec 200 — the Energy Bilan, computed from what /energy/history and
// /energy/by-usage already read. Pure: the route does the queries.
//
// A history point prices the WHOLE consumption of its bucket (spec 123), solar
// included, while the totals price only the grid side. So one point splits
// exactly into what was paid (its cost times the grid share) and what solar
// avoided (its cost times the self-consumed share): bill + avoided is the sum
// of the points' costs, by construction.

const DAY_MS = 86_400_000;
/** A month compares only with this many days at most without data, in both
 *  years: a meter installed on April 28 must not make "April" comparable. */
const MAX_MISSING_DAYS = 2;
/** The month projection waits for two complete days of data (spec 200 FR3). */
const PROJECTION_MIN_ELAPSED_MS = 2 * DAY_MS;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function consumptionOf(p: EnergyPoint): number {
  return p.hp + p.hc;
}

export interface PointSplit {
  paidHp: number;
  paidHc: number;
  avoided: number;
  /** Self-consumed share of the point's consumption, in [0, 1]. */
  share: number;
  /** The point's blended price, € per kWh. */
  rate: number;
}

/** Split one history point into paid (grid) and avoided (solar) €. */
export function splitPoint(p: EnergyPoint): PointSplit {
  const conso = consumptionOf(p);
  if (conso <= 0) return { paidHp: 0, paidHc: 0, avoided: 0, share: 0, rate: 0 };
  // A meter skew can report more self-consumption than consumption: clamp.
  const share = Math.min(1, Math.max(0, p.autoconso / conso));
  const rate = (p.cost_total * 1000) / conso;
  return {
    paidHp: p.cost_hp * (1 - share),
    paidHc: p.cost_hc * (1 - share),
    avoided: p.cost_total * share,
    share,
    rate,
  };
}

/** What the grid cost over these points, €. */
export function billOf(points: EnergyPoint[]): number {
  return points.reduce((s, p) => {
    const sp = splitPoint(p);
    return s + sp.paidHp + sp.paidHc;
  }, 0);
}

function hasData(points: EnergyPoint[]): boolean {
  return points.some((p) => consumptionOf(p) > 0);
}

/** Day view: the average bill of the reference days that have consumption. */
export function dayComparison(previousDays: EnergyPoint[]): BilanComparison | null {
  const days = previousDays.filter((p) => consumptionOf(p) > 0);
  if (days.length === 0) return null;
  return {
    kind: "days",
    days: days.length,
    averageBill: round4(billOf(days) / days.length),
  };
}

/** Month view: the pace projection (current month) and the same month a year earlier. */
export function monthComparison(
  bill: number,
  points: EnergyPoint[],
  from: Date,
  to: Date,
  now: number,
  previousYear: EnergyPoint[],
): BilanComparison {
  const start = from.getTime();
  const end = to.getTime();
  // The daily bucket is written once a day, so the bill holds the days up to
  // the last one with data, not today's hours: measure the pace over those.
  let covered = start;
  for (const p of points) {
    if (consumptionOf(p) <= 0) continue;
    const next = new Date(p.time);
    next.setDate(next.getDate() + 1);
    covered = Math.max(covered, next.getTime());
  }
  const elapsed = Math.min(covered, now) - start;
  const projectedBill =
    now < end && elapsed >= PROJECTION_MIN_ELAPSED_MS
      ? round4((bill * (end - start)) / elapsed)
      : null;
  return {
    kind: "month",
    projectedBill,
    previousYearBill: hasData(previousYear) ? round4(billOf(previousYear)) : null,
  };
}

/** The local "YYYY-MM" of a bucket start. */
function monthKey(time: string): string {
  return localDateStr(new Date(time)).slice(0, 7);
}

/** The local end of the month a bucket starts. */
function monthEnd(time: string): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** Days with consumption per local month ("MM", the year left out). */
function daysWithData(daily: EnergyPoint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of daily) {
    if (consumptionOf(p) <= 0) continue;
    const key = monthKey(p.time).slice(5);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Is this monthly bucket covered by daily data, but for MAX_MISSING_DAYS? */
function covered(month: EnergyPoint, counts: Map<string, number>): boolean {
  const d = new Date(month.time);
  const length = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return (counts.get(monthKey(month.time).slice(5)) ?? 0) >= length - MAX_MISSING_DAYS;
}

/** Daily data of both years, to tell a complete month from a partial one. */
export interface YearCoverage {
  current: EnergyPoint[];
  previous: EnergyPoint[];
}

/**
 * Year view: the months fully elapsed that are covered by data in both years.
 * `points` and `previousYear` are the 12 monthly buckets of their year.
 */
export function yearComparison(
  points: EnergyPoint[],
  previousYear: EnergyPoint[],
  coverage: YearCoverage,
  now: number,
): BilanComparison | null {
  const current = daysWithData(coverage.current);
  const previous = daysWithData(coverage.previous);
  const months: string[] = [];
  let bill = 0;
  let previousYearBill = 0;
  points.forEach((p, i) => {
    const prev = previousYear[i];
    if (!prev || monthEnd(p.time) > now) return;
    if (!covered(p, current) || !covered(prev, previous)) return;
    months.push(monthKey(p.time));
    bill += billOf([p]);
    previousYearBill += billOf([prev]);
  });
  if (months.length === 0) return null;
  return { kind: "year", months, bill: round4(bill), previousYearBill: round4(previousYearBill) };
}

export interface UsageSeries {
  /** Null for "other". */
  id: string | null;
  name: string;
  colorIndex: number | null;
  /** Aligned on the history points (same buckets, same order). */
  points: EnergyByUsagePoint[];
}

/** Each meter's Wh priced and split per point, sorted by paid € (spec 200 FR7). */
export function usageRows(series: UsageSeries[], points: EnergyPoint[]): BilanUsageRow[] {
  const splits = points.map(splitPoint);
  const rows = series.map((s) => {
    let wh = 0;
    let paid = 0;
    let avoided = 0;
    s.points.forEach((pt, i) => {
      const sp = splits[i];
      if (!sp) return;
      wh += pt.wh;
      paid += (pt.wh / 1000) * sp.rate * (1 - sp.share);
      avoided += (pt.wh / 1000) * sp.rate * sp.share;
    });
    return {
      id: s.id,
      name: s.name,
      colorIndex: s.colorIndex,
      wh: Math.round(wh),
      paid: round4(paid),
      avoided: round4(avoided),
    };
  });
  return rows.filter((r) => r.wh > 0).sort((a, b) => b.paid - a.paid);
}

/**
 * The arbiter tile: the period's gain and how much of it was measured.
 *
 * Spec 202 — the gain is booked in Wh, peak and off-peak, and priced here with
 * the prices of each row's day (`pricesOf`). `avoidedEur` is what a row booked
 * in euros before that, kept as booked: a row of the upgrade day holds both.
 */
export function arbiterTile(
  enabled: boolean,
  since: string | null,
  rows: ArbiterGainRow[],
  fromDay: string,
  toDay: string,
  nameOf: (equipmentId: string) => string | null,
  pricesOf: (day: string) => TariffPrices,
): BilanArbiter {
  const measured: BilanArbiter["measured"] =
    since === null || since > toDay ? "none" : since <= fromDay ? "full" : "partial";
  const byLoad = new Map<string, { solarWh: number; avoided: number }>();
  for (const r of rows) {
    if (r.day < fromDay || r.day > toDay) continue;
    const acc = byLoad.get(r.equipmentId) ?? { solarWh: 0, avoided: 0 };
    acc.solarWh += r.solarWh;
    acc.avoided += r.avoidedEur + computeCost(r.solarHpWh, r.solarHcWh, pricesOf(r.day)).cost_total;
    byLoad.set(r.equipmentId, acc);
  }
  const loads = [...byLoad.entries()]
    .map(([equipmentId, v]) => ({
      equipmentId,
      name: nameOf(equipmentId),
      solarWh: Math.round(v.solarWh),
      avoided: round4(v.avoided),
    }))
    .sort((a, b) => b.avoided - a.avoided);
  return {
    enabled,
    since,
    measured,
    solarWh: loads.reduce((s, l) => s + l.solarWh, 0),
    avoided: round4(loads.reduce((s, l) => s + l.avoided, 0)),
    loads,
  };
}

export interface BilanInput {
  period: BilanPeriod;
  from: Date;
  to: Date;
  resolution: EnergyBilanResponse["resolution"];
  now: number;
  tariffConfigured: boolean;
  prices: TariffPrices;
  hasProduction: boolean;
  points: EnergyPoint[];
  totals: EnergyTotals;
  /** Day: the 7 days before (1 d). Month: the same month a year earlier (1 d).
   *  Year: the previous year (1 mo). */
  reference: EnergyPoint[];
  /** Year only: daily points of both years (FR3, complete months). */
  coverage?: YearCoverage;
  usage: UsageSeries[];
  arbiter: BilanArbiter;
}

export function computeBilan(input: BilanInput): EnergyBilanResponse {
  const { period, points, totals, reference, now } = input;
  const yearRef = period === "year" ? reference : null;
  const coverage = input.coverage ?? { current: [], previous: [] };
  const previousCounts = daysWithData(coverage.previous);
  const bilanPoints: BilanPoint[] = points.map((p, i) => {
    const sp = splitPoint(p);
    const point: BilanPoint = {
      time: p.time,
      paidHp: round4(sp.paidHp),
      paidHc: round4(sp.paidHc),
      avoided: round4(sp.avoided),
    };
    if (yearRef) {
      const prev = yearRef[i];
      // A partial month of the previous year is no reference: no tick.
      point.previousYearBill =
        prev && covered(prev, previousCounts) ? round4(billOf([prev])) : null;
    }
    return point;
  });

  let comparison: BilanComparison | null;
  if (period === "day") comparison = dayComparison(reference);
  else if (period === "month")
    comparison = monthComparison(totals.cost_total, points, input.from, input.to, now, reference);
  else comparison = yearComparison(points, reference, coverage, now);

  return {
    period,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    resolution: input.resolution,
    tariffConfigured: input.tariffConfigured,
    prices: input.prices,
    hasProduction: input.hasProduction,
    bill: { total: totals.cost_total, hp: totals.cost_hp, hc: totals.cost_hc },
    avoided: round4(points.reduce((s, p) => s + splitPoint(p).avoided, 0)),
    selfConsumedWh: Math.round(totals.total_autoconso),
    points: bilanPoints,
    comparison,
    usage: usageRows(input.usage, points),
    arbiter: input.arbiter,
  };
}

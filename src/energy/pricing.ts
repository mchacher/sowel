/**
 * Pricing by tariff version — spec 202.
 *
 * Pure: the callers pass the versions. Every euro Sowel shows is computed at
 * read time with the version in force at the date of the energy, so a price
 * change never reprices the past and a past price can be corrected.
 *
 * With a single version, the points and the totals come out exactly as the
 * single-price computation of spec 123 did: the Wh of a version are summed
 * first and priced once, so the 4-decimal rounding lands in the same place.
 */

import type {
  EnergyPoint,
  TariffConfig,
  TariffContract,
  TariffPrices,
  TariffVersion,
} from "../shared/types.js";
import { localDateStr } from "../shared/local-date.js";
import { computeCost, type CostBreakdown } from "./cost-calculator.js";

const NO_PRICES: TariffPrices = { hp: 0, hc: 0 };
/** Group key of the energy that no version covers (no tariff at all). */
const NO_VERSION = "";

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Oldest first: the version without a date, then by start date. */
export function sortVersions(versions: TariffVersion[]): TariffVersion[] {
  return [...versions].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
}

/**
 * The version in force on a local day: the last one started on or before it,
 * the version without a date before every dated one.
 */
export function versionOn(versions: TariffVersion[], localDate: string): TariffVersion | null {
  let found: TariffVersion | null = null;
  for (const v of sortVersions(versions)) {
    if (v.startDate === null || v.startDate <= localDate) found = v;
  }
  return found;
}

/** The prices in force at an instant, 0/0 without any version. */
export function pricesAt(versions: TariffVersion[], instant: Date): TariffPrices {
  return versionOn(versions, localDateStr(instant))?.prices ?? NO_PRICES;
}

/** The prices in force on a local day, null without a version or at 0/0. */
export function pricesOnOrNull(versions: TariffVersion[], localDate: string): TariffPrices | null {
  const prices = versionOn(versions, localDate)?.prices;
  if (!prices) return null;
  return prices.hp > 0 || prices.hc > 0 ? prices : null;
}

/** A tariff is "configured" when the version in force has a price above 0. */
export function isPriced(versions: TariffVersion[], localDate: string): boolean {
  return pricesOnOrNull(versions, localDate) !== null;
}

/** Does a dated version start strictly inside the local days of [from, to)? */
export function crossesChange(versions: TariffVersion[], from: Date, to: Date): boolean {
  const first = localDateStr(from);
  const last = localDateStr(new Date(to.getTime() - 1));
  return versions.some((v) => v.startDate !== null && v.startDate > first && v.startDate <= last);
}

/**
 * Does a range read in monthly points need its daily points to be priced?
 * Only when a version starts inside a month: a change on the 1st crosses none.
 */
export function monthlyNeedsDaily(versions: TariffVersion[], from: Date, to: Date): boolean {
  const first = localDateStr(from);
  const last = localDateStr(new Date(to.getTime() - 1));
  return versions.some(
    (v) =>
      v.startDate !== null &&
      v.startDate > first &&
      v.startDate <= last &&
      !v.startDate.endsWith("-01"),
  );
}

interface WhGroup {
  prices: TariffPrices;
  hp: number;
  hc: number;
}

/** Sum HP/HC Wh per version, in the order the versions are met. */
function groupByVersion(
  items: Array<{ time: string; hp: number; hc: number }>,
  versions: TariffVersion[],
): WhGroup[] {
  const sorted = sortVersions(versions);
  const groups = new Map<string, WhGroup>();
  for (const item of items) {
    const version = versionOn(sorted, localDateStr(new Date(item.time)));
    const key = version?.id ?? NO_VERSION;
    const group = groups.get(key);
    if (group) {
      group.hp += item.hp;
      group.hc += item.hc;
    } else {
      groups.set(key, { prices: version?.prices ?? NO_PRICES, hp: item.hp, hc: item.hc });
    }
  }
  return [...groups.values()];
}

/** Price each group once, then add the groups. One group = `computeCost`. */
function costOfGroups(groups: WhGroup[]): CostBreakdown {
  if (groups.length === 1) return computeCost(groups[0].hp, groups[0].hc, groups[0].prices);
  let hp = 0;
  let hc = 0;
  for (const g of groups) {
    const cost = computeCost(g.hp, g.hc, g.prices);
    hp += cost.cost_hp;
    hc += cost.cost_hc;
  }
  const cost_hp = round4(hp);
  const cost_hc = round4(hc);
  return { cost_hp, cost_hc, cost_total: round4(cost_hp + cost_hc) };
}

/** The local "YYYY-MM" of a bucket start. */
function monthKey(time: string): string {
  return localDateStr(new Date(time)).slice(0, 7);
}

/** Is this monthly bucket crossed by a price change? */
function monthCrossesChange(versions: TariffVersion[], time: string): boolean {
  const from = new Date(time);
  return crossesChange(versions, from, new Date(from.getFullYear(), from.getMonth() + 1, 1));
}

type UnpricedPoint = Omit<EnergyPoint, "cost_hp" | "cost_hc" | "cost_total">;

/**
 * Price each point with the version in force at its start.
 *
 * A monthly point crossed by a price change is priced from the daily points of
 * its month, per version; without them it falls back on the version of its
 * start. `daily` is only needed for a `1mo` range that crosses a change.
 */
export function pricePoints(
  points: UnpricedPoint[],
  versions: TariffVersion[],
  options: { monthly?: boolean; daily?: UnpricedPoint[] } = {},
): EnergyPoint[] {
  const sorted = sortVersions(versions);
  const dailyByMonth = new Map<string, UnpricedPoint[]>();
  if (options.monthly && options.daily) {
    for (const d of options.daily) {
      const key = monthKey(d.time);
      const list = dailyByMonth.get(key);
      if (list) list.push(d);
      else dailyByMonth.set(key, [d]);
    }
  }
  return points.map((p) => {
    const days = options.monthly ? dailyByMonth.get(monthKey(p.time)) : undefined;
    const cost =
      days && days.length > 0 && monthCrossesChange(sorted, p.time)
        ? costOfGroups(groupByVersion(days, sorted))
        : computeCost(p.hp, p.hc, pricesAt(sorted, new Date(p.time)));
    return { ...p, ...cost };
  });
}

/**
 * The grid-side Wh of a point: its consumption less what solar covered,
 * taken from HP and HC in proportion (a point can straddle a tariff boundary).
 */
export function gridSide(p: { hp: number; hc: number; autoconso: number }): {
  hp: number;
  hc: number;
} {
  const conso = p.hp + p.hc;
  if (conso > 0 && p.autoconso > 0) {
    return {
      hp: Math.max(0, p.hp - p.autoconso * (p.hp / conso)),
      hc: Math.max(0, p.hc - p.autoconso * (p.hc / conso)),
    };
  }
  return { hp: p.hp, hc: p.hc };
}

/**
 * The € of the grid bill over these points: grid-side Wh summed per version,
 * each version priced once, the versions added. `pricingPoints` are the
 * points of the response, or the daily points of a `1mo` range crossed by a
 * price change.
 */
export function priceTotals(
  pricingPoints: UnpricedPoint[],
  versions: TariffVersion[],
): CostBreakdown {
  const grid = pricingPoints.map((p) => ({ time: p.time, ...gridSide(p) }));
  const groups = groupByVersion(grid, versions);
  if (groups.length === 0) return computeCost(0, 0, NO_PRICES);
  return costOfGroups(groups);
}

/** The blended price of a priced point, € per kWh, 0 without consumption. */
export function pointRate(p: EnergyPoint): number {
  const conso = p.hp + p.hc;
  return conso > 0 ? (p.cost_total * 1000) / conso : 0;
}

/**
 * Price a series of Wh point by point, each at the blended price of the main
 * meter's point of the same bucket. A load that only runs in off-peak hours
 * then costs the off-peak price, not the period's average.
 */
export function priceSeries(
  series: Array<{ time: string; wh: number }>,
  main: EnergyPoint[],
): number {
  const rateByTime = new Map(main.map((p) => [p.time, pointRate(p)] as const));
  let cost = 0;
  for (const pt of series) cost += (pt.wh / 1000) * (rateByTime.get(pt.time) ?? 0);
  return round4(cost);
}

/**
 * The contract shown before one was ever saved: an unknown supplier, HP/HC
 * when the schedule has an off-peak slot, the power of the latest version.
 */
export function defaultContract(
  tariff: TariffConfig | null,
  versions: TariffVersion[],
): TariffContract {
  const hasOffPeak =
    tariff?.schedules.some((s) => s.slots.some((slot) => slot.tariff === "hc")) ?? false;
  const sorted = sortVersions(versions);
  return {
    supplier: "other",
    contractType: hasOffPeak ? "hphc" : "base",
    kva: sorted[sorted.length - 1]?.kva ?? null,
  };
}

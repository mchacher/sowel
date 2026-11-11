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
  BilanFee,
  BilanPriceSpan,
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

/**
 * The local day `n` days after `day` ("YYYY-MM-DD"). Through a `Date` at noon,
 * so a daylight-saving change never skips or doubles a day.
 */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDateStr(new Date(y, m - 1, d + n, 12));
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Spec 205 — the versions covering the local days [fromDay, toDay], oldest
 * first, each clamped to it. Days that no version covers are left out.
 */
export function priceSpans(
  versions: TariffVersion[],
  fromDay: string,
  toDay: string,
): BilanPriceSpan[] {
  const sorted = sortVersions(versions);
  const spans: BilanPriceSpan[] = [];
  sorted.forEach((v, i) => {
    const next = sorted[i + 1]?.startDate ?? null;
    const from = v.startDate !== null && v.startDate > fromDay ? v.startDate : fromDay;
    const end = next !== null ? addDays(next, -1) : toDay;
    const to = end < toDay ? end : toDay;
    if (from > to) return;
    spans.push({
      from,
      to,
      hp: v.prices.hp,
      hc: v.prices.hc,
      fixedFeeYear: v.fixedFeeYear,
      kva: v.kva,
    });
  });
  return spans;
}

/**
 * Spec 205 FR1 — the fixed fee of the local days [fromDay, countUntilDay]:
 * each day costs the yearly fee of its version over the length of its
 * calendar year. Null when no counted day has a fee.
 */
export function periodFee(
  versions: TariffVersion[],
  fromDay: string,
  countUntilDay: string,
): BilanFee | null {
  const sorted = sortVersions(versions);
  let total = 0;
  let days = 0;
  let daysWithoutFee = 0;
  let kva: number | null = null;
  for (let day = fromDay; day <= countUntilDay; day = addDays(day, 1)) {
    const v = versionOn(sorted, day);
    days += 1;
    kva = v?.kva ?? null;
    if (v === null || v.fixedFeeYear === null) {
      daysWithoutFee += 1;
      continue;
    }
    const yearDays = isLeapYear(Number(day.slice(0, 4))) ? 366 : 365;
    total += v.fixedFeeYear / yearDays;
  }
  if (days === 0 || daysWithoutFee === days) return null;
  return { total, days, daysWithoutFee, kva };
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
 * The points the totals of a monthly range are priced on: each month as it
 * is, but for a month crossed by a price change, which gives way to its days.
 * The months a change does not touch therefore keep their figures to the cent.
 */
export function monthlyPricingPoints<P extends UnpricedPoint>(
  points: P[],
  versions: TariffVersion[],
  daily: P[],
): P[] {
  const sorted = sortVersions(versions);
  const dailyByMonth = new Map<string, P[]>();
  for (const d of daily) {
    const key = monthKey(d.time);
    const list = dailyByMonth.get(key);
    if (list) list.push(d);
    else dailyByMonth.set(key, [d]);
  }
  return points.flatMap((p) => {
    const days = dailyByMonth.get(monthKey(p.time));
    return days && days.length > 0 && monthCrossesChange(sorted, p.time) ? days : [p];
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
 * points of the response; for a `1mo` range with a price change inside a
 * month, see `monthlyPricingPoints`.
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
 * A contract rebuilt from an untrusted value (the stored setting, a request
 * body): only the known suppliers and types, a power above 0 or none. Null
 * when the supplier or the type is not one of them.
 */
export function normalizeContract(value: unknown): TariffContract | null {
  if (typeof value !== "object" || value === null) return null;
  const { supplier, contractType, kva } = value as Record<string, unknown>;
  const knownSupplier =
    supplier === "edf-tarif-bleu" ? "edf-tarif-bleu" : supplier === "other" ? "other" : null;
  const knownType = contractType === "hphc" ? "hphc" : contractType === "base" ? "base" : null;
  if (!knownSupplier || !knownType) return null;
  // Spec 203 — following the price file is on unless switched off, and
  // meaningless for a supplier the file does not hold.
  const { autoUpdate } = value as Record<string, unknown>;
  return {
    supplier: knownSupplier,
    contractType: knownType,
    kva: typeof kva === "number" && Number.isFinite(kva) && kva > 0 ? kva : null,
    autoUpdate: knownSupplier !== "other" && autoUpdate !== false,
  };
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
    autoUpdate: false,
  };
}

/** Setting that holds the contract (JSON `TariffContract`). */
export const CONTRACT_SETTING_KEY = "energy.contract";

/**
 * The contract in force: the stored one when it is a known one, the default
 * otherwise. `raw` is the setting's text; a broken or unknown value is
 * reported through `onInvalid` and replaced by the default.
 */
export function resolveContract(
  raw: string | undefined,
  tariff: TariffConfig | null,
  versions: TariffVersion[],
  onInvalid?: (err: unknown) => void,
): TariffContract {
  if (raw) {
    try {
      const contract = normalizeContract(JSON.parse(raw));
      if (contract) return contract;
      onInvalid?.(new Error("unknown supplier or contract type"));
    } catch (err) {
      onInvalid?.(err);
    }
  }
  return defaultContract(tariff, versions);
}

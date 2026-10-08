import type { DataBindingWithValue, EquipmentWithDetails, HistoryPoint } from "../../types";

/**
 * Spec 186 — rain-only weather equipments (a tipping-bucket gauge, a lone
 * Netatmo rain module). The weather tile renders temperatures, so without one
 * it showed `— °C` while rain data was live.
 */

/** How far back "last rain" is looked up, in days (today included). */
export const RAIN_LOOKBACK_DAYS = 183;
/** Number of daily bars in the detail sheet. */
export const RAIN_BAR_DAYS = 30;

const TEMPERATURE_CATEGORIES = new Set(["temperature", "temperature_outdoor"]);

function hasComputed(equipment: EquipmentWithDetails, alias: string): boolean {
  return !!equipment.computedData?.some((c) => c.alias === alias);
}

/** A `weather` equipment that measures rain and no temperature. */
export function isRainOnlyWeather(equipment: EquipmentWithDetails): boolean {
  if (equipment.type !== "weather") return false;
  const bindings = equipment.dataBindings;
  if (bindings.some((b) => TEMPERATURE_CATEGORIES.has(b.category))) return false;
  return bindings.some((b) => b.category === "rain") || hasComputed(equipment, "rain_24h");
}

export interface RainLive {
  /** Since local midnight (`rain_today`), null when the plugin does not publish it. */
  today: number | null;
  /** Rolling 24 h (`sum_rain_24`, else computed `rain_24h`). */
  last24h: number | null;
  /** Rolling 1 h (`sum_rain_1`, else computed `rain_1h`). */
  lastHour: number | null;
  /** Alias of the per-hour `rain` series to query in the history, if bound. */
  historyAlias: string | null;
  battery: number | null;
}

/** One decimal in the viewer's locale, `—` when unknown. */
export function formatMm(value: number | null, locale: string): string {
  if (value === null) return "—";
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function readRainLive(equipment: EquipmentWithDetails): RainLive {
  const byKey = (key: string): DataBindingWithValue | undefined =>
    equipment.dataBindings.find((b) => b.key === key);
  const computed = (alias: string): number | null =>
    num(equipment.computedData?.find((c) => c.alias === alias)?.value);
  const bindingOr = (key: string, computedAlias: string): number | null => {
    const b = byKey(key);
    return b ? num(b.value) : computed(computedAlias);
  };
  const rainSeries = equipment.dataBindings.find((b) => b.key === "rain" && b.category === "rain");
  return {
    today: num(byKey("rain_today")?.value),
    last24h: bindingOr("sum_rain_24", "rain_24h"),
    lastHour: bindingOr("sum_rain_1", "rain_1h"),
    historyAlias: rainSeries?.alias ?? null,
    battery: num(equipment.dataBindings.find((b) => b.category === "battery")?.value),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Calendar day a daily history point belongs to. Daily buckets start on UTC
 * midnight until the core sums rain per local day (PR #1024), on local midnight
 * after. A point exactly on `00:00:00Z` is therefore read in UTC, any other in
 * local time — both name the intended day.
 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const utcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (utcMidnight) return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return localKey(d);
}

/** Local midnight `days - 1` days before `now`: start of the history request. */
export function rainHistoryFrom(now: Date, days: number = RAIN_LOOKBACK_DAYS): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
}

export interface RainDay {
  /** Local midnight of the day. */
  date: Date;
  /** Total in mm, null before the history starts. */
  mm: number | null;
}

export interface RainSummary {
  /** Last {@link RAIN_BAR_DAYS} days, oldest first, today last. */
  bars: RainDay[];
  today: number | null;
  sum7: number | null;
  sum30: number | null;
  /** Days of the window actually covered by the history (≤ 7 / ≤ 30). */
  measured7: number;
  measured30: number;
  /** Most recent day with rain over {@link RAIN_LOOKBACK_DAYS}, today included. */
  lastRain: { date: Date; daysAgo: number; mm: number } | null;
  /**
   * First measured day when the history starts inside the lookback window,
   * null when it covers the whole window or is empty. "No rain" can only be
   * claimed since that day — the hourly rain history keeps 90 days.
   */
  since: Date | null;
  /** True when no point at all came back. */
  empty: boolean;
}

/**
 * Fold daily history points into the sheet's figures. Days before the first
 * point are "not measured" (null); days after it with no point are dry (0) —
 * the gauge plugins write a 0 for every dry hour, so a gap is not a blind spot.
 */
export function summarizeRainHistory(points: readonly HistoryPoint[], now: Date): RainSummary {
  const totals = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    const k = dayKey(p.time);
    totals.set(k, (totals.get(k) ?? 0) + p.value);
  }

  const n = RAIN_LOOKBACK_DAYS;
  const dates = Array.from(
    { length: n },
    (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i)),
  );
  const first = dates.findIndex((d) => totals.has(localKey(d)));
  const values = dates.map((d, i) => (first === -1 || i < first ? null : (totals.get(localKey(d)) ?? 0)));

  const window = (days: number) => {
    const slice = values.slice(n - days);
    const measured = slice.filter((v) => v !== null).length;
    const sum = slice.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    return { measured, sum: measured > 0 ? sum : null };
  };
  const w7 = window(7);
  const w30 = window(30);

  let lastRain: RainSummary["lastRain"] = null;
  for (let i = n - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v > 0) {
      lastRain = { date: dates[i], daysAgo: n - 1 - i, mm: v };
      break;
    }
  }

  return {
    bars: dates.slice(n - RAIN_BAR_DAYS).map((date, i) => ({ date, mm: values[n - RAIN_BAR_DAYS + i] })),
    today: values[n - 1],
    sum7: w7.sum,
    sum30: w30.sum,
    measured7: w7.measured,
    measured30: w30.measured,
    lastRain,
    since: first > 0 ? dates[first] : null,
    empty: first === -1,
  };
}

/**
 * Headline of the tile: today's rain, or the rolling 24 h when the plugin
 * publishes no `rain_today` (a Netatmo rain module).
 */
export function rainHeadline(equipment: EquipmentWithDetails) {
  const live = readRainLive(equipment);
  const hasToday = live.today !== null;
  return {
    live,
    hasToday,
    value: hasToday ? live.today : live.last24h,
    raining: live.lastHour !== null && live.lastHour > 0,
  };
}

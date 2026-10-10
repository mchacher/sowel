import type { DataBindingWithValue, EquipmentWithDetails, HistoryPoint } from "../../types";
import { SENSOR_DATA_CATEGORIES } from "./sensorUtils";

/**
 * Spec 186 — rain-only weather equipments (a tipping-bucket gauge, a lone
 * Netatmo rain module). The weather tile renders temperatures, so without one
 * it showed `— °C` while rain data was live.
 */

/** How far back "last rain" is looked up, in months — what the sheet says. */
export const RAIN_LOOKBACK_MONTHS = 6;
/** The same lookback in days, today included (183 for six months). */
export const RAIN_LOOKBACK_DAYS = Math.ceil(RAIN_LOOKBACK_MONTHS * 30.5);
/** Number of daily bars in the detail sheet. */
export const RAIN_BAR_DAYS = 30;

/**
 * Categories the generic weather sheet (`WeatherDetailContent`) lists as rows:
 * every sensor category but the battery, which it shows as a badge.
 */
const WEATHER_SHEET_CATEGORIES = new Set<string>(
  SENSOR_DATA_CATEGORIES.filter((c) => c !== "battery"),
);

function hasComputed(equipment: EquipmentWithDetails, alias: string): boolean {
  return !!equipment.computedData?.some((c) => c.alias === alias);
}

/**
 * A `weather` equipment whose only measurement the generic weather sheet would
 * list is rain. Not just "no temperature": the rain tile and sheet replace the
 * generic ones, so a wind, humidity or pressure reading would vanish with them.
 */
export function isRainOnlyWeather(equipment: EquipmentWithDetails): boolean {
  if (equipment.type !== "weather") return false;
  const shown = equipment.dataBindings.filter((b) => WEATHER_SHEET_CATEGORIES.has(b.category));
  if (shown.some((b) => b.category !== "rain")) return false;
  return shown.length > 0 || hasComputed(equipment, "rain_24h");
}

export interface RainLive {
  /** Since local midnight (`rain_today`), null when the plugin does not publish it. */
  today: number | null;
  /** When `rain_today` was last published (ISO), null if never. */
  todayAt: string | null;
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
    todayAt: byKey("rain_today")?.lastUpdated ?? null,
    last24h: bindingOr("sum_rain_24", "rain_24h"),
    lastHour: bindingOr("sum_rain_1", "rain_1h"),
    historyAlias: rainSeries?.alias ?? null,
    battery: num(equipment.dataBindings.find((b) => b.category === "battery")?.value),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const utcKey = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const calendarFormats = new Map<string, Intl.DateTimeFormat>();

/** Calendar formatter for `timeZone`; the runtime's own zone when undefined or unknown. */
function calendarFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  const id = timeZone ?? "";
  let format = calendarFormats.get(id);
  if (!format) {
    const opts = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
    try {
      format = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone });
    } catch {
      format = new Intl.DateTimeFormat("en-CA", opts);
    }
    calendarFormats.set(id, format);
  }
  return format;
}

/** `YYYY-MM-DD` of an instant on the calendar of `timeZone` (the viewer's when undefined). */
export function calendarDay(d: Date, timeZone?: string): string {
  const parts = calendarFormat(timeZone).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Calendar day a daily history point belongs to, in the house's time zone.
 * Daily buckets start on UTC midnight until the core sums rain per local day
 * (PR #1024), on the server's local midnight after — and the server runs in the
 * house's zone (spec 061). A point exactly on `00:00:00Z` is therefore read in
 * UTC, any other in `timeZone`: both name the intended day.
 */
export function dayKey(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  const utcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return utcMidnight ? utcKey(d) : calendarDay(d, timeZone);
}

/**
 * Start of the history request: one day more than the window, so its oldest
 * day comes back whole whatever the time zone. The summary drops the extra,
 * partial day.
 */
export function rainHistoryFrom(now: Date, days: number = RAIN_LOOKBACK_DAYS): Date {
  return new Date(now.getTime() - (days + 1) * 86_400_000);
}

export interface RainDay {
  /** `YYYY-MM-DD` in the house's time zone. */
  key: string;
  /** Noon of that day in the viewer's zone: `toLocaleDateString` names the same day. */
  date: Date;
  /** Total in mm, null before the history starts. */
  mm: number | null;
}

/** The `n` calendar days ending today in `timeZone`, oldest first. */
function lastDays(now: Date, n: number, timeZone?: string): Omit<RainDay, "mm">[] {
  const [y, m, d] = calendarDay(now, timeZone).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    // Calendar arithmetic in UTC: a day is a day, whatever DST does.
    const u = new Date(Date.UTC(y, m - 1, d - (n - 1 - i)));
    return {
      key: utcKey(u),
      date: new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12),
    };
  });
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
  /** True when neither the history nor the live total gave a single value. */
  empty: boolean;
}

export interface RainSummaryOptions {
  /**
   * Live total since midnight (`rain_today`). The hourly history only writes an
   * hour once it has ended, so today lags behind it: when known, this value
   * replaces today's slot before the sums, the bars and the last rain.
   */
  liveToday?: number | null;
  /**
   * When the live total was published (`lastUpdated`). Given, the total only
   * counts if it was published on the house's today: a plugin that stopped
   * leaves yesterday's total in the binding. Omitted, it is not checked.
   */
  liveTodayAt?: string | null;
  /** House time zone the days are cut in (`GET /system/timezone`); the viewer's when undefined. */
  timeZone?: string;
}

/**
 * Fold daily history points into the sheet's figures. Days before the first
 * point are "not measured" (null); days after it with no point are dry (0) —
 * the gauge plugins write a 0 for every dry hour, so a gap is not a blind spot.
 */
export function summarizeRainHistory(
  points: readonly HistoryPoint[],
  now: Date,
  { liveToday = null, liveTodayAt, timeZone }: RainSummaryOptions = {},
): RainSummary {
  const totals = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    const k = dayKey(p.time, timeZone);
    totals.set(k, (totals.get(k) ?? 0) + p.value);
  }

  const n = RAIN_LOOKBACK_DAYS;
  const days = lastDays(now, n, timeZone);
  const todayKey = days[n - 1].key;
  const liveIsToday =
    liveTodayAt === undefined ||
    (liveTodayAt !== null && calendarDay(new Date(liveTodayAt), timeZone) === todayKey);
  if (liveToday !== null && Number.isFinite(liveToday) && liveToday >= 0 && liveIsToday) {
    // Never below the history: the live total can only be ahead of it.
    totals.set(todayKey, Math.max(liveToday, totals.get(todayKey) ?? 0));
  }

  const first = days.findIndex((d) => totals.has(d.key));
  const values = days.map((d, i) => (first === -1 || i < first ? null : (totals.get(d.key) ?? 0)));

  const window = (size: number) => {
    const slice = values.slice(n - size);
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
      lastRain = { date: days[i].date, daysAgo: n - 1 - i, mm: v };
      break;
    }
  }

  return {
    bars: days
      .slice(n - RAIN_BAR_DAYS)
      .map((d, i) => ({ ...d, mm: values[n - RAIN_BAR_DAYS + i] })),
    today: values[n - 1],
    sum7: w7.sum,
    sum30: w30.sum,
    measured7: w7.measured,
    measured30: w30.measured,
    lastRain,
    since: first > 0 ? days[first].date : null,
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

import i18n from "../i18n";
import { dateLocale } from "./locale";

// ============================================================
// Numbers and units — spec 196, FR-3
// ============================================================
//
// The only place a number becomes text. Every displayed number goes through
// one of the functions below, so the same quantity reads the same on every
// screen, and the French page reads as French:
//
//   - decimal comma, thin no-break space (U+202F) between thousands and
//     before the unit (« 1 288 lx », « 14,3 kWh », « 39 % »);
//   - a real minus sign (U+2212), and never « −0 »;
//   - trailing zeros dropped, except for temperatures, which keep one
//     decimal so a setpoint stepping by 0,5 does not change width.
//
// `Intl.NumberFormat("fr-FR")` does not do all of this by itself: under Node 24
// and current browsers it renders the minus as a hyphen and puts a full
// no-break space (U+00A0) before « % » and « € ». Hence the fix-ups below.
//
// The English page keeps the dot decimal, a comma between thousands, a
// no-break space before units, « 39% » and the hyphen-minus.
//
// `null`, `undefined` and `NaN` render as « — ». Booleans are labels, not
// numbers: they do not go through this module.

export type Locale = string;

/** Thin no-break space: between thousands and before a unit, in French. */
export const NNBSP = "\u202F";
/** No-break space: before a unit, in English. */
export const NBSP = "\u00A0";
/** The minus sign. */
export const MINUS = "\u2212";
/** The dash between the two ends of a range. */
export const RANGE_DASH = "\u2013";
/** What a missing value reads as. */
export const EMPTY = "—";

/** A number and its unit, apart, for layouts that style them differently. */
export interface QuantityParts {
  value: string;
  unit: string;
}

function resolve(locale: Locale | undefined): Locale {
  return dateLocale(locale ?? i18n.language);
}

function isFr(locale: Locale): boolean {
  return locale.startsWith("fr");
}

/** The space between a number and its unit. */
function unitSep(locale: Locale): string {
  return isFr(locale) ? NNBSP : NBSP;
}

function isMissing(v: number | null | undefined): v is null | undefined {
  return v === null || v === undefined || !Number.isFinite(v);
}

/**
 * Round half away from zero on the decimal digits, as `Intl.NumberFormat`
 * does. `toFixed` works on the binary value instead and rounds 1.15 to 1.1,
 * so a figure computed with one and displayed with the other could disagree.
 */
export function roundTo(x: number, decimals: number): number {
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const s = String(a);
  const r = s.includes("e")
    ? Math.round(a * 10 ** decimals) / 10 ** decimals
    : Number(`${Math.round(Number(`${s}e${decimals}`))}e-${decimals}`);
  // `+ 0` turns −0 into 0.
  return sign * r + 0;
}

const NUMBER_FORMATTERS = new Map<string, Intl.NumberFormat>();

function numberFormatter(
  locale: Locale,
  minDecimals: number,
  maxDecimals: number,
  grouping: boolean,
): Intl.NumberFormat {
  const key = `${locale}|${minDecimals}|${maxDecimals}|${grouping}`;
  let f = NUMBER_FORMATTERS.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      useGrouping: grouping,
    });
    NUMBER_FORMATTERS.set(key, f);
  }
  return f;
}

/** French spaces: whatever Intl put between groups or before a symbol becomes U+202F. */
function frenchSpaces(s: string): string {
  return s.replace(/\u00A0/g, NNBSP);
}

export interface NumberOptions {
  /** Fixed number of decimals (trailing zeros kept). */
  decimals?: number;
  /** Upper bound when adaptive; trailing zeros dropped. Default 2. */
  maxDecimals?: number;
  /** Prefix positive values with « + » (deltas, symmetric axes). */
  signed?: boolean;
  /** Thousands separator, on by default. */
  grouping?: boolean;
  locale?: Locale;
}

/** « 1 234,5 » / « 1,234.5 ». */
export function formatNumber(v: number | null | undefined, opts: NumberOptions = {}): string {
  if (isMissing(v)) return EMPTY;
  const locale = resolve(opts.locale);
  const max = opts.decimals ?? opts.maxDecimals ?? 2;
  const min = opts.decimals ?? 0;
  const r = roundTo(v, max);
  const body = numberFormatter(locale, min, max, opts.grouping ?? true).format(Math.abs(r));
  const digits = isFr(locale) ? frenchSpaces(body) : body;
  const sign = r < 0 ? (isFr(locale) ? MINUS : "-") : r > 0 && opts.signed ? "+" : "";
  return sign + digits;
}

function withUnit(value: string, unit: string, locale: Locale): string {
  if (value === EMPTY) return EMPTY;
  if (!unit) return value;
  return `${value}${unitSep(locale)}${unit}`;
}

// ── Power ───────────────────────────────────────────────────────────────

export interface PowerOptions {
  /** « auto » (default): whole W below 1 000 W, then kW with one decimal. */
  unit?: "auto" | "W" | "kW";
  /** Round watts to a multiple of this step (the Live page uses 5). */
  step?: number;
  signed?: boolean;
  locale?: Locale;
}

function powerShown(watts: number, opts: PowerOptions): { n: number; unit: "W" | "kW" } {
  const a = Math.abs(watts);
  const sign = watts < 0 ? -1 : 1;
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  const unit = opts.unit ?? "auto";
  const w = Math.round(a / step) * step;
  if (unit === "W" || (unit === "auto" && w < 1000)) return { n: sign * w + 0, unit: "W" };
  return { n: sign * roundTo(a / 1000, 1) + 0, unit: "kW" };
}

/**
 * The watts a reader sees, as a number: what `formatPower` prints, converted
 * back to watts. Shares and sums computed from it agree with the labels
 * beside them.
 */
export function displayedWatts(
  watts: number,
  opts: Omit<PowerOptions, "locale" | "signed"> = {},
): number {
  const { n, unit } = powerShown(watts, opts);
  return unit === "kW" ? roundTo(n * 1000, 0) : n;
}

/** « 745 », « W » / « 1,1 », « kW ». */
export function formatPowerParts(
  watts: number | null | undefined,
  opts: PowerOptions = {},
): QuantityParts {
  if (isMissing(watts)) return { value: EMPTY, unit: opts.unit === "kW" ? "kW" : "W" };
  const { n, unit } = powerShown(watts, opts);
  return {
    value: formatNumber(n, {
      maxDecimals: unit === "kW" ? 1 : 0,
      signed: opts.signed,
      locale: opts.locale,
    }),
    unit,
  };
}

/** « 745 W » · « 1,1 kW » · « −0,2 kW ». */
export function formatPower(watts: number | null | undefined, opts: PowerOptions = {}): string {
  const p = formatPowerParts(watts, opts);
  return withUnit(p.value, p.unit, resolve(opts.locale));
}

// ── Energy ──────────────────────────────────────────────────────────────

export interface EnergyOptions {
  /**
   * « kWh » (default): always kWh. « auto »: whole Wh below 1 kWh, then kWh.
   * « Wh »: always whole Wh.
   */
  unit?: "kWh" | "auto" | "Wh";
  signed?: boolean;
  locale?: Locale;
}

/** Three significant digits, at most two decimals: 0,7 · 7,09 · 14,3 · 984. */
function adaptiveKwh(a: number): { n: number; decimals: number } {
  let decimals = a < 10 ? 2 : a < 100 ? 1 : 0;
  let n = roundTo(a, decimals);
  // 9.996 rounds to 10.00: it is now a two-digit figure and takes one decimal.
  while (decimals > 0 && n >= 10 ** (3 - decimals)) {
    decimals -= 1;
    n = roundTo(a, decimals);
  }
  return { n, decimals };
}

/** « 14,3 », « kWh ». The value is in kWh. */
export function formatEnergyParts(
  kwh: number | null | undefined,
  opts: EnergyOptions = {},
): QuantityParts {
  const unit = opts.unit ?? "kWh";
  if (isMissing(kwh)) return { value: EMPTY, unit: unit === "Wh" ? "Wh" : "kWh" };
  const sign = kwh < 0 ? -1 : 1;
  const a = Math.abs(kwh);
  const wh = Math.round(a * 1000);
  if (unit === "Wh" || (unit === "auto" && wh < 1000)) {
    return {
      value: formatNumber(sign * wh, { maxDecimals: 0, signed: opts.signed, locale: opts.locale }),
      unit: "Wh",
    };
  }
  const { n, decimals } = adaptiveKwh(a);
  return {
    value: formatNumber(sign * n, {
      maxDecimals: decimals,
      signed: opts.signed,
      locale: opts.locale,
    }),
    unit: "kWh",
  };
}

/** « 0,7 kWh » · « 7,09 kWh » · « 14,3 kWh » · « 984 kWh ». The value is in kWh. */
export function formatEnergy(kwh: number | null | undefined, opts: EnergyOptions = {}): string {
  const p = formatEnergyParts(kwh, opts);
  return withUnit(p.value, p.unit, resolve(opts.locale));
}

// ── Temperature, percent, currency ──────────────────────────────────────

export interface TemperatureOptions {
  /**
   * « compact » (tiles, rows, strips): « 20,5° ».
   * « full » (default; pages, axes, tooltips): « 20,5 °C ».
   */
  style?: "compact" | "full";
  signed?: boolean;
  locale?: Locale;
}

/** One fixed decimal: « 20,0° », « 20,5 °C ». */
export function formatTemperature(
  celsius: number | null | undefined,
  opts: TemperatureOptions = {},
): string {
  if (isMissing(celsius)) return EMPTY;
  const locale = resolve(opts.locale);
  const n = formatNumber(celsius, { decimals: 1, signed: opts.signed, locale });
  return opts.style === "compact" ? `${n}°` : `${n}${unitSep(locale)}°C`;
}

export interface PercentOptions {
  /** Maximum decimals, trailing zeros dropped. Default 0. */
  decimals?: number;
  signed?: boolean;
  locale?: Locale;
}

/** The value is a percentage (0–100): « 39 % » / « 39% ». */
export function formatPercent(pct: number | null | undefined, opts: PercentOptions = {}): string {
  if (isMissing(pct)) return EMPTY;
  const locale = resolve(opts.locale);
  const n = formatNumber(pct, { maxDecimals: opts.decimals ?? 0, signed: opts.signed, locale });
  return isFr(locale) ? `${n}${NNBSP}%` : `${n}%`;
}

const CURRENCY_FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * Euros, two decimals: « 2,72 € » / « €2.72 ». The tariff is in euros whatever
 * the language; only the number and the symbol's place follow the locale.
 */
export function formatCurrency(
  eur: number | null | undefined,
  opts: { locale?: Locale } = {},
): string {
  if (isMissing(eur)) return EMPTY;
  const locale = resolve(opts.locale);
  let f = CURRENCY_FORMATTERS.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });
    CURRENCY_FORMATTERS.set(locale, f);
  }
  const r = roundTo(eur, 2);
  const body = f.format(Math.abs(r));
  if (r >= 0) return isFr(locale) ? frenchSpaces(body) : body;
  return isFr(locale) ? MINUS + frenchSpaces(body) : `-${body}`;
}

// ── Any unit ────────────────────────────────────────────────────────────

/** Decimals per unit (zeros dropped). Units not listed here keep one decimal. */
const UNIT_DECIMALS: Record<string, number> = {
  V: 0,
  A: 1,
  mbar: 0,
  hPa: 0,
  mm: 1,
  "mm/h": 1,
  "mm/24h": 1,
  "km/h": 0,
  "m/s": 0,
  dB: 0,
  lx: 0,
  ppm: 0,
  "µg/m³": 0,
  km: 0,
};

export interface UnitOptions {
  /** For °C only. Default « full ». */
  style?: "compact" | "full";
  signed?: boolean;
  locale?: Locale;
}

/**
 * A value with the unit it came with, by the unit's rule: W and kW as power,
 * Wh and kWh as energy, °C as temperature, % as percent, € as currency, and
 * the table above for the rest. A unit the table does not know (a plugin's
 * own) is kept as given, after a number with one decimal at most.
 */
export function formatWithUnit(
  v: number | null | undefined,
  unit: string | null | undefined,
  opts: UnitOptions = {},
): string {
  const { signed, locale } = opts;
  switch (unit ?? "") {
    case "":
      return formatNumber(v, { maxDecimals: 1, signed, locale });
    case "°C":
      return formatTemperature(v, { style: opts.style ?? "full", signed, locale });
    case "%":
      return formatPercent(v, { signed, locale });
    case "W":
      return formatPower(v, { signed, locale });
    case "kW":
      return formatPower(isMissing(v) ? v : v * 1000, { signed, locale });
    case "Wh":
      return formatEnergy(isMissing(v) ? v : v / 1000, { unit: "auto", signed, locale });
    case "kWh":
      return formatEnergy(v, { signed, locale });
    case "€":
      return formatCurrency(v, { locale });
    default: {
      const u = unit as string;
      const n = formatNumber(v, { maxDecimals: UNIT_DECIMALS[u] ?? 1, signed, locale });
      return withUnit(n, u, resolve(locale));
    }
  }
}

// ── Durations and ranges ────────────────────────────────────────────────

const DURATION_UNITS: Record<"fr" | "en", { s: string; min: string; h: string; d: string }> = {
  fr: { s: "s", min: "min", h: "h", d: "j" },
  en: { s: "s", min: "min", h: "h", d: "d" },
};

export interface DurationOptions {
  /** « compact » (default): « 2 min 12 s », « 1 h 05 ». « clock »: « 2:12 », « 1:05:00 ». */
  style?: "compact" | "clock";
  locale?: Locale;
}

/** A duration in seconds: « 35 s », « 2 min 12 s », « 1 h 05 », « 3 j 4 h ». */
export function formatDuration(
  seconds: number | null | undefined,
  opts: DurationOptions = {},
): string {
  if (isMissing(seconds)) return EMPTY;
  const locale = resolve(opts.locale);
  const total = Math.round(Math.abs(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");

  if (opts.style === "clock") {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const u = DURATION_UNITS[isFr(locale) ? "fr" : "en"];
  const sp = unitSep(locale);
  if (total < 60) return `${total}${sp}${u.s}`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s > 0 ? `${m}${sp}${u.min}${sp}${s}${sp}${u.s}` : `${m}${sp}${u.min}`;
  }
  if (total < 86_400) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return m > 0 ? `${h}${sp}${u.h}${sp}${pad(m)}` : `${h}${sp}${u.h}`;
  }
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  return h > 0 ? `${d}${sp}${u.d}${sp}${h}${sp}${u.h}` : `${d}${sp}${u.d}`;
}

/** « 07:22 – 17:17 »: an en dash between the two ends. */
export function formatRange(from: string, to: string, opts: { locale?: Locale } = {}): string {
  const sp = isFr(resolve(opts.locale)) ? NNBSP : " ";
  return `${from}${sp}${RANGE_DASH}${sp}${to}`;
}

// ============================================================
// Dates, data values, sources
// ============================================================

/**
 * Format a timestamp as hh:mm:ss (24h local time).
 */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  // SQLite timestamps lack timezone suffix — treat as UTC
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Format a timestamp as relative time ("2 min ago") or absolute ("Feb 16, 14:30").
 * Uses relative for timestamps less than 24h old, absolute otherwise.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";

  // SQLite timestamps lack timezone suffix — treat as UTC
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffS = Math.floor(diffMs / 1000);

  if (diffS < 0) return "< 5s ago";
  if (diffS < 5) return "< 5s ago";
  if (diffS < 15) return "< 15s ago";
  if (diffS < 30) return "< 30s ago";
  if (diffS < 45) return "< 45s ago";
  if (diffS < 60) return "< 1 min ago";
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} min ago`;
  }
  if (diffMs < 86_400_000) {
    const hours = Math.floor(diffMs / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    return mins > 0 ? `${hours}h${mins.toString().padStart(2, "0")} ago` : `${hours}h ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format a data value for display.
 * Returns "—" for null/undefined, formats numbers, booleans, etc.
 */
export function formatDataValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? i18n.t("controls.on") : i18n.t("controls.off");
  if (typeof value === "number") {
    const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
    return unit ? `${formatted}${unit}` : formatted;
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Get source badge text.
 */
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    zigbee2mqtt: "Z2M",
    tasmota: "Tasmota",
    esphome: "ESPHome",
    shelly: "Shelly",
    custom_mqtt: "MQTT",
    panasonic_cc: "Panasonic",
    mcz_maestro: "MCZ",
    netatmo_hc: "Legrand",
    simulator: "Simulator",
  };
  return labels[source] ?? source;
}

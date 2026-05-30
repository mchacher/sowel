export type TimeRange = "6h" | "24h" | "7d" | "30d";

// ============================================================
// Chart families (spec 118)
// ============================================================
//
// Every chartable DataCategory belongs to one family. A chart contains
// series from a single family (see F7 — family-locked picker in AnalyseView).

export type ChartFamily = "measurements" | "cumulative" | "states";

const CUMULATIVE_CATEGORIES = new Set<string>(["rain", "energy"]);

export const BOOLEAN_CATEGORIES = new Set<string>([
  "motion",
  "contact_door",
  "contact_window",
  "water_leak",
  "smoke",
]);

const MEASUREMENT_CATEGORIES = new Set<string>([
  "temperature",
  "temperature_outdoor",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "co2",
  "voc",
  "noise",
  "luminosity",
  "power",
  "voltage",
  "current",
  "wind",
  "battery",
]);

// Categories that benefit from the min/max envelope at 1h / 1d resolution.
// Slow-moving continuous measurements only — wind/battery/voltage/current
// vary fast or step-wise and the envelope would be noise.
export const ENVELOPE_CATEGORIES = new Set<string>([
  "temperature",
  "temperature_outdoor",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "co2",
  "voc",
  "noise",
  "luminosity",
  "power",
]);

/** Return the chart family for a DataCategory, or null if not chartable. */
export function familyOf(category: string): ChartFamily | null {
  if (CUMULATIVE_CATEGORIES.has(category)) return "cumulative";
  if (BOOLEAN_CATEGORIES.has(category)) return "states";
  if (MEASUREMENT_CATEGORIES.has(category)) return "measurements";
  return null;
}

/** Whether `category` qualifies for the min/max envelope. */
export function hasEnvelope(category: string): boolean {
  return ENVELOPE_CATEGORIES.has(category);
}

/** Whether `category` is a boolean/state series rendered as a step chart. */
export function isBooleanCategory(category: string): boolean {
  return BOOLEAN_CATEGORIES.has(category);
}

/**
 * Decide whether a binding should be visualised as a bar chart.
 *
 * `rain` and `energy` are rendered as bars (cumulative or rate-style values
 * that read better as discrete buckets); every other category is a line.
 *
 * Kept as a helper (rather than a Set) so we can refine the rule per alias
 * later without changing the call site.
 */
export function isCumulativeBarChart(category: string): boolean {
  return CUMULATIVE_CATEGORIES.has(category);
}

/** True when every category in the list is cumulative (rain/energy). */
export function isCumulativeChart(categories: string[]): boolean {
  return categories.length > 0 && categories.every((c) => familyOf(c) === "cumulative");
}

/**
 * Return the i18n key pair `[labelForFalse, labelForTrue]` used to render
 * tick labels and tooltip text for a boolean series. Falls back to the
 * generic on/off keys when no specific mapping exists for the category.
 */
export function booleanTickLabels(category: string): [string, string] {
  switch (category) {
    case "motion":
      return ["analyse.bool.motion.off", "analyse.bool.motion.on"];
    case "contact_door":
    case "contact_window":
      return ["analyse.bool.contact.closed", "analyse.bool.contact.open"];
    case "water_leak":
      return ["analyse.bool.leak.dry", "analyse.bool.leak.wet"];
    case "smoke":
      return ["analyse.bool.smoke.clear", "analyse.bool.smoke.detected"];
    default:
      return ["analyse.bool.generic.off", "analyse.bool.generic.on"];
  }
}

/** Convert a TimeRange to a relative "from" string for the API. */
export function rangeToFrom(range: TimeRange): string {
  switch (range) {
    case "6h":
      return "-6h";
    case "24h":
      return "-24h";
    case "7d":
      return "-168h"; // 7 * 24
    case "30d":
      return "-720h"; // 30 * 24
  }
}

/** Convert a TimeRange to its duration in milliseconds. */
export function rangeToDurationMs(range: TimeRange): number {
  switch (range) {
    case "6h":
      return 6 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
  }
}

// ============================================================
// Period-based navigation (Analyse page)
// ============================================================
//
// Whereas TimeRange is a relative window ("last 24h"), Period+date is an
// absolute window anchored on a calendar boundary ("May 2026"). Mirrors
// the navigator on the Energy page so the user can scrub through any
// past day/week/month/year.

export type Period = "day" | "week" | "month" | "year";

/** YYYY-MM-DD in the **local** timezone — NOT UTC. `.toISOString().slice(0,10)`
 *  is unsafe here because midnight local sits in the previous UTC day for
 *  any positive timezone offset, causing date-string arithmetic to silently
 *  fall back to "the previous local day" (no forward motion). */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date());
}

/** Returns the start of the period that contains `dateStr`, in local time. */
function periodStart(dateStr: string, period: Period): Date {
  const d = new Date(dateStr + "T12:00:00"); // noon to avoid DST edge cases
  switch (period) {
    case "day":
      d.setHours(0, 0, 0, 0);
      return d;
    case "week": {
      const dayOfWeek = d.getDay(); // 0 = Sunday
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      d.setDate(d.getDate() + mondayOffset);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "month":
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    case "year":
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return d;
  }
}

/** Returns the start of the period that immediately follows the one containing `dateStr`. */
function periodEnd(dateStr: string, period: Period): Date {
  const start = periodStart(dateStr, period);
  const end = new Date(start);
  switch (period) {
    case "day":
      end.setDate(end.getDate() + 1);
      break;
    case "week":
      end.setDate(end.getDate() + 7);
      break;
    case "month":
      end.setMonth(end.getMonth() + 1);
      break;
    case "year":
      end.setFullYear(end.getFullYear() + 1);
      break;
  }
  return end;
}

/** Compute the absolute [from, to) window the API should fetch for the given period+date. */
export function periodToWindow(dateStr: string, period: Period): { from: Date; to: Date } {
  return { from: periodStart(dateStr, period), to: periodEnd(dateStr, period) };
}

/** Convert period+date to a "from" string for the history API (ISO format). */
export function periodToFrom(dateStr: string, period: Period): string {
  return periodToWindow(dateStr, period).from.toISOString();
}

/** Convert period+date to a "to" string for the history API (ISO format). */
export function periodToTo(dateStr: string, period: Period): string {
  return periodToWindow(dateStr, period).to.toISOString();
}

/** Pick the closest TimeRange to a period, so chart components can keep their
 *  existing tick-formatting logic without further parameterisation. */
export function periodToClosestRange(period: Period): TimeRange {
  switch (period) {
    case "day":
      return "24h";
    case "week":
      return "7d";
    case "month":
    case "year":
      return "30d";
  }
}

/** Whether advancing one period would go beyond today (= no future data). */
export function canGoForwardPeriod(dateStr: string, period: Period): boolean {
  const next = periodEnd(dateStr, period);
  return next.getTime() <= Date.now();
}

/** Move `dateStr` forward (delta=+1) or backward (delta=-1) by one period. */
export function shiftPeriod(dateStr: string, period: Period, delta: number): string {
  const d = periodStart(dateStr, period);
  switch (period) {
    case "day":
      d.setDate(d.getDate() + delta);
      break;
    case "week":
      d.setDate(d.getDate() + delta * 7);
      break;
    case "month":
      d.setMonth(d.getMonth() + delta);
      break;
    case "year":
      d.setFullYear(d.getFullYear() + delta);
      break;
  }
  return toLocalDateStr(d);
}

export const periodTodayStr = todayStr;

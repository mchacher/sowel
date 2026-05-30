export type TimeRange = "6h" | "24h" | "7d" | "30d";

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
  return category === "rain" || category === "energy";
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

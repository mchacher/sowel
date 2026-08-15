import type { HistoryPoint } from "../../types";
import type { TimeRange } from "./history-utils";

/** One row of the merged Analyse dataset: an epoch-ms `time` plus one entry
 *  per series id, and the `id:min` / `id:max` envelope keys when present. */
export type ChartRow = Record<string, number>;

/** Minimal projection of a series the merge needs: its id and its points. */
export interface MergeSeries {
  id: string;
  points: HistoryPoint[];
}

/**
 * Merge every series' points into a single chart dataset indexed by instant.
 *
 * Rows are keyed by **epoch milliseconds**, not by the raw ISO string. The
 * same instant can reach us under two different ISO spellings across series
 * (an hourly bucket `…T00:00:00Z` vs a raw state event `…T00:00:00.000Z`, or
 * a `+02:00` offset form of the same UTC instant), and keying by string would
 * emit two rows at the same X coordinate. That duplicate is not merely
 * cosmetic: Recharts derives its tick-culling direction from
 * `sign(tick1.coordinate - tick0.coordinate)`, so two leading rows sharing a
 * coordinate yield `sign === 0`, which disables `minTickGap` culling and
 * paints every single label (issue #537). Keying by epoch collapses the
 * duplicate and keeps the axis legible. Rows are returned sorted
 * chronologically; points with an unparseable timestamp are skipped.
 */
export function mergeSeriesData(series: MergeSeries[]): ChartRow[] {
  const rows = new Map<number, ChartRow>();

  for (const { id, points } of series) {
    for (const p of points) {
      const key = new Date(p.time).getTime();
      if (Number.isNaN(key)) continue;
      const row = rows.get(key) ?? { time: key };
      row[id] = p.value;
      // F1 — carry the envelope band keys when the API returned them
      // (downsampled buckets at 1h / 1d resolution).
      if (typeof p.min === "number") row[`${id}:min`] = p.min;
      if (typeof p.max === "number") row[`${id}:max`] = p.max;
      rows.set(key, row);
    }
  }

  return Array.from(rows.values()).sort((a, b) => a.time - b.time);
}

/**
 * Group raw history points into time buckets sized for the range:
 *   - 6h / 24h → hourly buckets
 *   - 7d / 30d → daily buckets
 *
 * Within each bucket values are summed (the bar chart is used for cumulative
 * categories — rain and energy — where sum is the meaningful aggregation).
 * The returned points are anchored at the start of their bucket and sorted
 * chronologically. If the input is already at the target resolution the call
 * is idempotent.
 */
export function aggregateToBuckets(points: HistoryPoint[], range: TimeRange): HistoryPoint[] {
  if (points.length === 0) return [];

  const daily = range === "7d" || range === "30d";
  const buckets = new Map<number, number>();

  for (const p of points) {
    const d = new Date(p.time);
    if (daily) {
      d.setHours(0, 0, 0, 0);
    } else {
      d.setMinutes(0, 0, 0);
    }
    const key = d.getTime();
    buckets.set(key, (buckets.get(key) ?? 0) + p.value);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ time: new Date(t).toISOString(), value }));
}

/**
 * Build the tick label(s) for a given timestamp at a given range.
 * 7d uses two lines (weekday + day) to avoid overlapping; other ranges stay on one line.
 */
export function formatLabel(iso: string, range: TimeRange): { line1: string; line2?: string } {
  const d = new Date(iso);
  if (range === "6h" || range === "24h") {
    return {
      line1: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    };
  }
  if (range === "7d") {
    return {
      line1: d.toLocaleDateString("fr-FR", { weekday: "short" }),
      line2: String(d.getDate()).padStart(2, "0"),
    };
  }
  // 30d — compact DD/MM
  return {
    line1: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
  };
}

/**
 * Range-specific cap on the number of X-axis labels. Picked so the labels read
 * as "one entry per natural time unit" — 7 labels on 7d, 10 on 30d, etc.
 */
const RANGE_MAX_LABELS: Record<TimeRange, number> = {
  "6h": 6,
  "24h": 8,
  "7d": 7,
  "30d": 10,
};

/**
 * Compute the Recharts `interval` value (= number of ticks to skip between two visible ticks).
 *
 * Aims for ≤ `maxLabels` visible ticks given (a) the time range and (b) the
 * available viewport width. The smaller of the two caps wins so mobile stays
 * legible even on short ranges.
 */
export function pickTickInterval(count: number, viewportWidth: number, range?: TimeRange): number {
  const viewportMax = viewportWidth < 360 ? 6 : viewportWidth < 640 ? 8 : 12;
  const rangeMax = range ? RANGE_MAX_LABELS[range] : viewportMax;
  const maxLabels = Math.min(rangeMax, viewportMax);
  if (count <= maxLabels) return 0;
  // Ceil so the visible tick count actually stays ≤ maxLabels.
  // floor() would underestimate the skip and let too many labels through
  // (e.g. count=19 / maxLabels=12 → floor 1 → interval 0 → all 19 shown).
  return Math.ceil(count / maxLabels) - 1;
}

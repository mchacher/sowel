import type { PvForecastPoint } from "../../types";

/**
 * Sum an expected-production curve over one local calendar day.
 *
 * Local, not UTC: a household reads "tomorrow" off its own wall clock, and at
 * a +2 offset a UTC day would carry two hours of the wrong evening. The curve
 * itself is UTC instants, so the boundaries are computed locally and compared
 * as instants.
 */
export function sumKwh(curve: readonly PvForecastPoint[], dayOffset: number): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const wh = curve.reduce((sum, point) => {
    const ms = Date.parse(point.at);
    if (!Number.isFinite(ms) || ms < start.getTime() || ms >= end.getTime()) return sum;
    return sum + (Number.isFinite(point.watts) ? point.watts : 0);
  }, 0);

  return wh / 1000;
}

/**
 * One tick per local day, at midnight, across a series of timestamps.
 *
 * Recharts left to itself puts a tick every few points. On 144 hourly points
 * formatted as weekday names that produced "Tue Tue Tue Tue Wed Wed Wed…" — an
 * axis that reads as noise and tells you nothing about where a day begins.
 *
 * Local midnight, not a fixed 24 h step: on a DST changeover the day is 23 or
 * 25 hours long, and a fixed step would drift off the boundary it is meant to
 * mark.
 *
 * @param maxTicks roughly how many labels the axis can carry. Over that, whole
 *   days are skipped rather than the labels being crowded together.
 */
export function dailyTicks(timestamps: readonly number[], maxTicks = 12): number[] {
  if (timestamps.length === 0) return [];

  let min = timestamps[0];
  let max = timestamps[0];
  for (const ts of timestamps) {
    if (!Number.isFinite(ts)) continue;
    if (ts < min) min = ts;
    if (ts > max) max = ts;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  // Every day over a week is readable; ninety are not. Past `maxTicks` the
  // step widens so the axis stays a scale rather than a smear, and every tick
  // is still a real local midnight.
  const spanDays = Math.max(1, Math.ceil((max - min) / 86_400_000));
  const step = Math.max(1, Math.ceil(spanDays / maxTicks));

  const ticks: number[] = [];
  const cursor = new Date(min);
  cursor.setHours(0, 0, 0, 0);
  // The first midnight may sit before the data starts; step past it rather than
  // drawing a tick outside the domain.
  if (cursor.getTime() < min) cursor.setDate(cursor.getDate() + 1);

  // A ceiling as a backstop against a malformed range spinning forever.
  while (cursor.getTime() <= max && ticks.length < 400) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + step);
  }
  return ticks;
}

/** One hour on the merged timeline: what was expected, and what happened. */
export interface TimelinePoint {
  ts: number;
  /** Expected watts. Present across the whole span. */
  forecastW?: number;
  /** Measured watts. Past hours only, and only where the meter reported. */
  actualW?: number;
}

/**
 * Past and future on one timeline.
 *
 * The comparison and the forecast are the same quantity in the same unit on
 * adjacent stretches of time; drawn as two charts the reader had to join them up
 * by eye.
 *
 * A past hour carries what was actually **promised** for it, not the current
 * curve. The curve still contains today's elapsed hours, but for an hour that
 * has passed that value is a retrodiction — recomputed from irradiance now
 * known — and scoring or displaying it as a forecast would flatter the model.
 */
export function mergeTimeline(
  accuracy: ReadonlyArray<{ at: string; forecastW: number; actualW: number }>,
  curve: ReadonlyArray<{ at: string; watts: number }>,
  now: number,
): TimelinePoint[] {
  const byTs = new Map<number, TimelinePoint>();

  for (const p of accuracy) {
    const ts = Date.parse(p.at);
    if (!Number.isFinite(ts)) continue;
    byTs.set(ts, { ts, forecastW: p.forecastW, actualW: p.actualW });
  }

  for (const p of curve) {
    const ts = Date.parse(p.at);
    if (!Number.isFinite(ts)) continue;
    // The past belongs to what was promised at the time.
    if (ts < now) continue;
    byTs.set(ts, { ...(byTs.get(ts) ?? { ts }), forecastW: p.watts });
  }

  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

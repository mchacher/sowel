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

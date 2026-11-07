/**
 * X-axis tick density for the energy bar charts (spec 196, FR-1).
 *
 * Recharts' `interval={n}` draws one label every `n + 1` bars. A fixed value
 * glued the hourly labels together on a phone ("00h02h04h…"), so the step is
 * now chosen from the width the plot actually has: the smallest "round" step
 * for the period whose labels stay at least `MIN_LABEL_GAP_PX` apart.
 */

/** Width of the Y axis plus the chart's horizontal margins, in px. */
export const ENERGY_CHART_Y_AXIS_PX = 80;

/** Minimum distance between two label centres, per period, in px. */
export const MIN_LABEL_GAP_PX: Record<string, number> = {
  day: 44, // "00h" at 11 px plus air
  week: 0, // seven weekdays, always all shown
  month: 28, // "31"
  year: 40, // "Sept."
};

/** Allowed steps (in bars) per period, smallest first. */
const ROUND_STEPS: Record<string, number[]> = {
  day: [2, 3, 6, 12], // never every hour: 12 labels at most, as before
  week: [1],
  month: [1, 2, 7], // 7 gives 1, 8, 15, 22, 29
  year: [1, 2, 3, 6],
};

/**
 * Recharts `interval` for an energy bar chart.
 *
 * @param period    "day" | "week" | "month" | "year"
 * @param count     number of bars
 * @param plotWidth width of the plotting area in px (chart width minus the Y axis);
 *                  0 or less when not measured yet
 */
export function xTickInterval(period: string, count: number, plotWidth: number): number {
  const steps = ROUND_STEPS[period] ?? ROUND_STEPS.day;
  const minGap = MIN_LABEL_GAP_PX[period] ?? MIN_LABEL_GAP_PX.day;
  if (count <= 0) return 0;
  // Not measured yet: the densest allowed step (the desktop look).
  if (plotWidth <= 0) return steps[0] - 1;
  const slot = plotWidth / count;
  const step = steps.find((s) => s * slot >= minGap) ?? steps[steps.length - 1];
  return step - 1;
}

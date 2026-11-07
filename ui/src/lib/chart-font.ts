// Spec 196, slice 5a — font sizes inside charts (Recharts ticks, legends,
// tooltips) follow the type scale. Recharts takes numbers, not classes, so the
// two sizes charts use live here instead of as text-* utilities.
/** Axis ticks, legends, reference-line labels: `--text-micro`, the minimum. */
export const CHART_TICK_FONT = 11;
/** Tooltip body: `--text-caption`. */
export const CHART_TOOLTIP_FONT = 12;

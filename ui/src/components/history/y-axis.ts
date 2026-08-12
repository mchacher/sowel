// ============================================================
// Fitted Y axis (spec 145)
// ============================================================
//
// By default the measurement axis of the Analyse chart declares no domain, so
// Recharts anchors it at zero. That is right for a power curve and wrong for a
// tank temperature living between 48 and 55 °C — the whole story ends up
// squeezed into the top eighth of the plot.
//
// When the user opts in, the axis is fitted instead: the domain is the data
// range padded on both sides so the curve never touches the frame, and the
// ticks are round numbers picked *inside* that domain. Rounding the domain
// outwards to step multiples — the classic "nice axis" recipe — would give
// most of the margin back and can widen a 36…94 window to 20…100, which is the
// opposite of fitting.

/** Padding added below the min and above the max, as a share of the span. */
const MARGIN_RATIO = 0.08;

/** Tick count aimed for. The step is rounded up, so the real count is lower. */
const TARGET_TICKS = 5;

export interface FittedYAxis {
  domain: [number, number];
  ticks: number[];
}

/** Strip the float noise a division or a multiplication leaves behind. */
function clean(value: number): number {
  return Number(value.toPrecision(12));
}

/** Smallest `1 / 2 / 5 × 10ⁿ` value greater than or equal to `rough`. */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return clean(factor * magnitude);
}

/**
 * Compute a padded domain and its round ticks for the given values.
 *
 * Returns `null` when there is nothing finite to fit, so the caller can fall
 * back to the default axis rather than invent a domain for an empty chart.
 */
export function fitYAxis(
  values: Iterable<number>,
  marginRatio: number = MARGIN_RATIO,
): FittedYAxis | null {
  // A loop rather than Math.min(...values): the input is one entry per point
  // per series and would blow the argument limit on a long window.
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return null;

  const span = max - min;
  // A flat series has no span to take a percentage of — open a window around
  // the value instead, so the line sits mid-plot rather than on an edge.
  const margin = span > 0 ? span * marginRatio : Math.max(Math.abs(max) * marginRatio, 1);
  // A series that never goes negative must not get a negative axis. This is
  // also what makes a 0-based series (power, luminosity) look the same fitted
  // or not: fitting only changes the charts that need it.
  const low = min >= 0 ? Math.max(0, min - margin) : min - margin;
  const high = max + margin;

  const step = niceStep((high - low) / TARGET_TICKS);
  const first = Math.ceil(low / step) * step;
  // Epsilon so a tick landing exactly on `high` is not dropped by float error.
  const count = Math.floor((high - first) / step + 1e-9) + 1;

  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(clean(first + i * step));

  return {
    domain: [clean(low), clean(high)],
    // A domain too narrow to hold two step multiples still needs labelled
    // bounds — fall back to the padded edges themselves.
    ticks: ticks.length >= 2 ? ticks : [clean(low), clean(high)],
  };
}

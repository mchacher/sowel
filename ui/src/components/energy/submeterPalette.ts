/**
 * Sub-meter colours (spec 091, themed by spec 196 FR-E).
 *
 * A sub-meter takes the series palette entry at its sorted index (sort by id,
 * then the meters on their own supply after the partition: a server rule, see
 * `src/api/routes/energy.ts`). The by-usage API sends that index as
 * `colorIndex`; the Live donut computes the same index from the same sort, so
 * the two surfaces paint a meter alike. The colour itself is a CSS variable
 * (`--color-series-N`, design-system/tokens.css), so it follows the theme. The
 * server's `color` field keeps the pre-196 palette for external API clients;
 * it is painted only when an older server sends no `colorIndex`.
 */
import { SERIES_VARS } from "../../lib/series-palette";

/** The themed colour of series `index` (0-based, wraps after eight). */
export function seriesColor(index: number): string {
  const n = SERIES_VARS.length;
  return SERIES_VARS[((index % n) + n) % n];
}

export const SUBMETER_PALETTE = SERIES_VARS;

export function pickSubmeterColor(sortedIndex: number): string {
  return seriesColor(sortedIndex);
}

/** A by-usage series' colour: its themed palette entry when the server sent
 *  `colorIndex`, its hex otherwise (an older server). */
export function byUsageSeriesColor(s: { color: string; colorIndex?: number }): string {
  return typeof s.colorIndex === "number" ? seriesColor(s.colorIndex) : s.color;
}

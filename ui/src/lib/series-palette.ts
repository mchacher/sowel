/**
 * Analyse series palette (spec 118, themed by spec 196 FR-E).
 *
 * A saved chart stores each series' colour as a hex (spec 145), and the free
 * colour input edits a hex, so the palette keeps a hex identity per entry: the
 * light-theme value of `--series-N` (design-system/tokens.css). On screen, a
 * palette hex is painted with its theme variable instead, so the same series
 * reads in both themes; a colour the user picked freely is painted as is.
 *
 * Charts saved before spec 196 store the old palette (amber, red and orange
 * among them, the first one 2.02:1 on the dark card). They map to the entry at
 * the same position, at read time, without touching the database.
 */
/** The themed series colours (design-system/tokens.css `--series-N`), spelled
 *  out so a scan for undefined custom properties can read them. */
export const SERIES_VARS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
];

export const SERIES_COLORS = [
  "#1A4F6E",
  "#6A7B27",
  "#00867A",
  "#7C61A8",
  "#006574",
  "#A0557B",
  "#526FB2",
  "#915A95",
];

const LEGACY_SERIES_COLORS = [
  "#1A4F6E",
  "#D4963F",
  "#2D8B59",
  "#9B59B6",
  "#E74C3C",
  "#17A2B8",
  "#F39C12",
  "#8E44AD",
];

const PAINT = new Map<string, string>();
for (const list of [LEGACY_SERIES_COLORS, SERIES_COLORS]) {
  list.forEach((hex, i) => PAINT.set(hex.toLowerCase(), SERIES_VARS[i]));
}

/** What to paint for a stored series colour: the themed palette entry when the
 *  hex is (or was) a palette colour, the hex itself otherwise. */
export function seriesPaint(color: string): string {
  return PAINT.get(color.toLowerCase()) ?? color;
}

/** Reads a custom property on the page root as the browser computes it. */
function rootVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** The `#rrggbb` actually drawn for a stored series colour, in the theme the
 *  page shows now: the computed value of the themed palette entry when the
 *  hex is (or was) a palette colour, the hex itself otherwise. The free colour
 *  input opens on it, so it starts from what the user sees, not from a light
 *  value or a pre-196 hex the chart no longer paints. Where nothing is
 *  computed (no stylesheet), the entry's light hex. */
export function seriesDrawnHex(color: string, readVar: (name: string) => string = rootVar): string {
  const index = SERIES_VARS.indexOf(seriesPaint(color));
  if (index < 0) return color;
  const computed = readVar(SERIES_VARS[index].slice("var(".length, -1)).trim();
  return /^#[0-9a-f]{6}$/i.test(computed) ? computed : SERIES_COLORS[index];
}

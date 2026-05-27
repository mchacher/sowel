/**
 * Submeter color palette — mirror of `SUBMETER_PALETTE` in
 * `src/api/routes/energy.ts` (spec 091). Keeping the hex codes and the
 * sort-by-id indexing identical here ensures the Live donut (spec 117)
 * paints each submeter with the same color the historical By-usage
 * chart assigns to it on the same instance.
 *
 * If you change this list, update the backend constant in lockstep.
 */
export const SUBMETER_PALETTE = [
  "#60A5FA",
  "#34D399",
  "#F87171",
  "#A78BFA",
  "#22D3EE",
  "#FB7185",
  "#FBBF24",
  "#818CF8",
];

export function pickSubmeterColor(sortedIndex: number): string {
  return SUBMETER_PALETTE[sortedIndex % SUBMETER_PALETTE.length];
}

/**
 * Analyse landing decision (#498, point 1).
 *
 * Visiting the bare `/analyse` workspace should redirect to the first saved
 * chart so the page opens on real content by default. The empty
 * "build a new chart" workspace stays reachable through an explicit
 * `/analyse?new` entry (sidebar + mobile drawer "New chart" buttons), which
 * sets `isNew` and suppresses the redirect.
 *
 * Returns the path to redirect to, or `null` to stay on the current view.
 */
export function firstChartTarget(params: {
  /** True when the route carries `?new` — the user explicitly wants the
   * empty workspace. */
  isNew: boolean;
  /** True while the saved-charts list is still being fetched — wait rather
   * than deciding on a transiently-empty list. */
  loading: boolean;
  /** The user's saved charts, in display order. */
  charts: { id: string }[];
}): string | null {
  if (params.isNew || params.loading) return null;
  const first = params.charts[0];
  return first ? `/analyse/${first.id}` : null;
}

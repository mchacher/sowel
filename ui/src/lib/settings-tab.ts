export type SettingsTab = "general" | "account" | "energy" | "solar" | "admin";

/**
 * Which tab a fresh Settings page opens on (spec 163).
 *
 * `?tab=` is an entry point, not synced state: it decides the initial tab and
 * is never written back on click. A tab the role cannot see (everything but
 * "account" is admin-only) falls back to the role's default rather than
 * rendering an empty pane.
 */
export function initialSettingsTab(param: string | null, isAdmin: boolean): SettingsTab {
  if (
    param === "general" ||
    param === "account" ||
    param === "energy" ||
    param === "solar" ||
    param === "admin"
  ) {
    if (param === "account" || isAdmin) return param;
  }
  return isAdmin ? "general" : "account";
}

/**
 * Where the Settings tab bar must scroll so a tab shows in full (spec 206), or
 * `null` when it already does. Only the bar moves: `scrollIntoView` would also
 * scroll the page's `<main>`, undoing a `#notifications` deep link.
 *
 * `itemLeft` is the tab's offset inside the bar's content, padding included;
 * `pad` keeps the tab clear of the bar's side padding.
 */
export function revealScrollLeft(
  scrollLeft: number,
  viewWidth: number,
  itemLeft: number,
  itemWidth: number,
  pad: number,
): number | null {
  if (itemLeft - pad < scrollLeft) return Math.max(0, itemLeft - pad);
  if (itemLeft + itemWidth + pad > scrollLeft + viewWidth) {
    return itemLeft + itemWidth + pad - viewWidth;
  }
  return null;
}

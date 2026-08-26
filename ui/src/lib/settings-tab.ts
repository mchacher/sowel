export type SettingsTab = "general" | "account" | "energy" | "admin";

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
    param === "admin"
  ) {
    if (param === "account" || isAdmin) return param;
  }
  return isAdmin ? "general" : "account";
}

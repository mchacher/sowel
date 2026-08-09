import { describe, it, expect } from "vitest";
import { ADMIN_NAV_ITEMS, visibleAdminNavItems } from "./admin-nav-items";

// Regression for issue #373: the mobile drawer used to hand-write a subset of
// the admin navigation and drifted from the desktop sidebar. Both now render
// ADMIN_NAV_ITEMS; these tests pin the contract of that shared list.
describe("admin-nav-items", () => {
  it("contains every admin page reachable from the desktop sidebar", () => {
    expect(ADMIN_NAV_ITEMS.map((i) => i.to)).toEqual([
      "/devices",
      "/equipments",
      "/zones",
      "/calendar",
      "/integrations",
      "/plugins",
      "/mqtt-publishers",
      "/notification-publishers",
      "/logs",
      "/backup",
    ]);
  });

  it("has unique routes and nav.* label keys", () => {
    const routes = ADMIN_NAV_ITEMS.map((i) => i.to);
    expect(new Set(routes).size).toBe(routes.length);
    for (const item of ADMIN_NAV_ITEMS) {
      expect(item.labelKey).toMatch(/^nav\./);
      expect(item.icon).toBeTruthy();
    }
  });

  it("marks exactly the consultation pages (equipments, zones) as visible to non-admins", () => {
    // Must match the AdminRoute gating in App.tsx: /equipments and /zones are
    // open to all roles, everything else redirects non-admins to the dashboard.
    const openRoutes = ADMIN_NAV_ITEMS.filter((i) => !i.adminOnly).map((i) => i.to);
    expect(openRoutes).toEqual(["/equipments", "/zones"]);
  });

  it("returns the full list for admins and only open pages otherwise", () => {
    expect(visibleAdminNavItems(true)).toEqual(ADMIN_NAV_ITEMS);
    expect(visibleAdminNavItems(false).map((i) => i.to)).toEqual(["/equipments", "/zones"]);
  });
});

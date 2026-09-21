import { describe, it, expect } from "vitest";
import { isOnPage, pluginPagePath, splitPluginPages } from "./plugin-page-nav";
import type { PluginPageInfo } from "../../types";

const page = (pluginId: string, placement: PluginPageInfo["placement"]): PluginPageInfo => ({
  pluginId,
  label: pluginId,
  icon: "Puzzle",
  placement,
  equipmentTypes: [],
  entryUrl: `/plugin-ui/${pluginId}/panel.js?v=1.0.0`,
});

// Spec 180 R1.6.bis — the sidebar and the mobile drawer both place plugin pages
// from this one split, so they cannot disagree about where a page lives.
describe("plugin-page-nav", () => {
  it("lists a `main` page in the main navigation and everything else under Administration", () => {
    const { main, admin } = splitPluginPages([
      page("guest-access", "main"),
      page("backup-tool", "admin"),
      // A manifest from before the field existed reaches the UI without it.
      { ...page("old", "admin"), placement: undefined as unknown as "admin" },
    ]);
    expect(main.map((p) => p.pluginId)).toEqual(["guest-access"]);
    expect(admin.map((p) => p.pluginId)).toEqual(["backup-tool", "old"]);
  });

  it("recognises a main page's route, which lives under /plugins like the admin screens", () => {
    const main = [page("guest-access", "main")];
    expect(pluginPagePath("guest-access")).toBe("/plugins/guest-access/page");
    expect(isOnPage("/plugins/guest-access/page", main)).toBe(true);
    // The Plugins admin screen itself is not the page.
    expect(isOnPage("/plugins", main)).toBe(false);
    expect(isOnPage("/plugins/other/page", main)).toBe(false);
  });
});

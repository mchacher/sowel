import type { PluginPageInfo } from "../../types";

/** Spec 180 — where the SPA mounts a plugin's page. */
export function pluginPagePath(pluginId: string): string {
  return `/plugins/${pluginId}/page`;
}

/**
 * Spec 180 R1.6.bis — the pages the main navigation lists, and the ones that stay
 * under Administration. Anything not explicitly `main` is an admin page, which
 * is where every page lived before the placement existed.
 */
export function splitPluginPages(pages: PluginPageInfo[]): {
  main: PluginPageInfo[];
  admin: PluginPageInfo[];
} {
  return {
    main: pages.filter((page) => page.placement === "main"),
    admin: pages.filter((page) => page.placement !== "main"),
  };
}

/** Is this path one of the main-navigation pages? They live under `/plugins/…` too. */
export function isOnPage(pathname: string, pages: PluginPageInfo[]): boolean {
  return pages.some((page) => pathname.startsWith(pluginPagePath(page.pluginId)));
}

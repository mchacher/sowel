import { ADMIN_NAV_ITEMS } from "./admin-nav-items";
import { isUsageEquipmentPage } from "../../lib/equipment-origin";

export type SidebarSection = "maison" | "modes" | "analyse" | "energy" | "admin";

const ADMIN_ROUTES = ADMIN_NAV_ITEMS.map((item) => item.to);

/**
 * The sidebar section a route belongs to. An equipment page belongs to Maison
 * (spec 196, pr9-retour) unless it was opened from an Administration list (the
 * equipments or the devices), which `state.from` says.
 */
export function getSectionForPath(pathname: string, state?: unknown): SidebarSection | null {
  if (pathname.startsWith("/home") || isUsageEquipmentPage(pathname, state)) return "maison";
  if (pathname.startsWith("/modes")) return "modes";
  if (pathname.startsWith("/analyse")) return "analyse";
  if (pathname.startsWith("/energy")) return "energy";
  if (ADMIN_ROUTES.some((r) => pathname.startsWith(r))) return "admin";
  return null;
}

import {
  Radio,
  Box,
  Map,
  Calendar,
  Plug,
  Package,
  Send,
  Bell,
  ScrollText,
  DatabaseBackup,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  /** Mirrors the AdminRoute gating in App.tsx — non-admin users can still
   *  consult equipments and zones, so those entries stay visible to them. */
  adminOnly: boolean;
}

/** Single source of truth for the Administration navigation, rendered by both
 *  the desktop Sidebar and the mobile drawer so the two menus cannot drift. */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: "/devices", labelKey: "nav.devices", icon: Radio, adminOnly: true },
  { to: "/equipments", labelKey: "nav.equipments", icon: Box, adminOnly: false },
  { to: "/zones", labelKey: "nav.zones", icon: Map, adminOnly: false },
  { to: "/calendar", labelKey: "nav.calendar", icon: Calendar, adminOnly: true },
  { to: "/integrations", labelKey: "nav.integrations", icon: Plug, adminOnly: true },
  { to: "/plugins", labelKey: "nav.plugins", icon: Package, adminOnly: true },
  { to: "/mqtt-publishers", labelKey: "nav.mqttPublishers", icon: Send, adminOnly: true },
  { to: "/notification-publishers", labelKey: "nav.notificationPublishers", icon: Bell, adminOnly: true },
  { to: "/logs", labelKey: "nav.logs", icon: ScrollText, adminOnly: true },
  { to: "/backup", labelKey: "nav.backup", icon: DatabaseBackup, adminOnly: true },
];

/** Items a given user may navigate to. Admins get the full list; other roles
 *  only the consultation pages (equipments, zones). */
export function visibleAdminNavItems(isAdmin: boolean): AdminNavItem[] {
  return isAdmin ? ADMIN_NAV_ITEMS : ADMIN_NAV_ITEMS.filter((item) => !item.adminOnly);
}

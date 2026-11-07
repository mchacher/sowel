/**
 * Where the equipment page was opened from (spec 196, FR-9).
 *
 * Every link to `/equipments/:id` sets `state.from = { label, to }`: the page's
 * back link reads « Retour à {label} » and goes back in history; the sidebar
 * and the breadcrumb place the page under Maison unless it came from an
 * Administration list. Without an origin (a direct link, a reload in a fresh
 * tab) the page belongs to the equipment's room.
 */
export interface EquipmentOrigin {
  /** Name of the page the user came from (room, mode, device list…). */
  label: string;
  /** Its route, used to classify the origin, not to navigate. */
  to: string;
}

/** The `state` a link to the equipment page carries. */
export function equipmentLinkState(label: string, to: string): { from: EquipmentOrigin } {
  return { from: { label, to } };
}

/** The origin carried by a location state, or null when absent or malformed. */
export function readEquipmentOrigin(state: unknown): EquipmentOrigin | null {
  if (!state || typeof state !== "object") return null;
  const from = (state as { from?: unknown }).from;
  if (!from || typeof from !== "object") return null;
  const { label, to } = from as { label?: unknown; to?: unknown };
  if (typeof label !== "string" || typeof to !== "string" || !label || !to) return null;
  return { label, to };
}

/**
 * An origin inside Administration: the equipment list or the devices pages.
 * Another equipment's page (a vehicle linking to its charger) is not: it is a
 * usage page too.
 */
export function isAdminOrigin(origin: EquipmentOrigin | null): boolean {
  if (!origin) return false;
  const path = origin.to.split(/[?#]/)[0];
  return path === "/equipments" || path === "/devices" || path.startsWith("/devices/");
}

/** The equipment id of an equipment page path, or null for any other path. */
export function equipmentIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/equipments\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/** An equipment page that belongs to Maison rather than to Administration. */
export function isUsageEquipmentPage(pathname: string, state: unknown): boolean {
  return equipmentIdFromPath(pathname) !== null && !isAdminOrigin(readEquipmentOrigin(state));
}

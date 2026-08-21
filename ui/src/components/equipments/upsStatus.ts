/**
 * UPS rendering primitives (spec 156).
 *
 * Kept out of the components for two reasons: the severity mapping and the
 * duration formatter are pure and worth unit-testing on their own, and a file
 * exporting both components and helpers breaks react-refresh (same reason
 * `vmcSpeed.ts` exists, spec 153).
 */

import { UPS_STATUS_VALUES, type UpsStatus } from "../../lib/ups";
import { findDataByCategory } from "./bindingUtils";
import type { EquipmentWithDetails } from "../../types";

/** How loudly a status should be rendered. */
export type UpsSeverity = "ok" | "warning" | "error" | "unknown";

const SEVERITY: Record<UpsStatus, UpsSeverity> = {
  online: "ok",
  on_battery: "warning",
  bypass: "warning",
  overload: "error",
  low_battery: "error",
  offline: "error",
};

function isUpsStatus(value: unknown): value is UpsStatus {
  return typeof value === "string" && (UPS_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Normalize whatever the plugin pushed into a known status.
 *
 * A plugin is free to report a value outside the enum — the core stores
 * categories as free text. Rather than dropping the equipment, an unrecognized
 * value renders neutrally and the raw string is shown, which is far more
 * debuggable than a blank card.
 */
export function upsStatusOf(equipment: EquipmentWithDetails): {
  status: UpsStatus | null;
  raw: string | null;
} {
  const binding = findDataByCategory(equipment.dataBindings, ["ups_status"], [
    "status",
    "ups_status",
  ]);
  const value = binding?.value;
  if (value === undefined || value === null || value === "") return { status: null, raw: null };
  const raw = String(value);
  return { status: isUpsStatus(raw) ? raw : null, raw };
}

export function upsSeverityOf(status: UpsStatus | null): UpsSeverity {
  return status ? SEVERITY[status] : "unknown";
}

/** i18n key for a status, falling back to the "unknown" label. */
export function upsStatusKey(status: UpsStatus | null): string {
  return status ? `equipments.ups.status.${status}` : "equipments.ups.status.unknown";
}

/** True when the UPS is not being powered from the mains. */
export function isOnBattery(status: UpsStatus | null): boolean {
  return status === "on_battery" || status === "low_battery";
}

/**
 * Remaining autonomy, seconds → a short human duration.
 *
 * UPS units report autonomy in seconds and the useful range spans two orders of
 * magnitude (a loaded rack: 90 s; an idle one: two hours), so a fixed unit is
 * wrong at one end or the other. Below an hour, minutes; above, `h min`.
 * Sub-minute values keep their seconds — that is the range where the number
 * actually matters.
 */
export function formatRuntime(seconds: unknown): string | null {
  // `Number(null)` and `Number("")` are both 0, so an absent binding would
  // otherwise render a confident "0 s" — the one reading that would make
  // someone run for the server room.
  if (seconds === null || seconds === undefined || seconds === "") return null;
  const n = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n < 0) return null;
  const total = Math.round(n);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}

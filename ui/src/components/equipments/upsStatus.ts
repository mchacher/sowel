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

export function isUpsStatus(value: unknown): value is UpsStatus {
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

// ============================================================
// Panel readings (spec 157)
// ============================================================

/** Everything the UPS panel needs, read once from the bindings. */
export interface UpsReadings {
  status: UpsStatus | null;
  rawStatus: string | null;
  chargePct: number | null;
  runtimeS: number | null;
  loadPct: number | null;
  /** Output load in watts — measured or derived by the plugin, never `power`. */
  loadW: number | null;
  inputV: number | null;
  nominalV: number | null;
  nominalW: number | null;
  transferLow: number | null;
  transferHigh: number | null;
  chargeLowPct: number | null;
  runtimeLowS: number | null;
  charging: boolean;
  replaceBattery: boolean;
}

interface MinimalBinding {
  alias: string;
  category?: string;
  value?: unknown;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function byCategory(bindings: readonly MinimalBinding[], category: string): unknown {
  return bindings.find((b) => b.category === category)?.value;
}

function byAlias(bindings: readonly MinimalBinding[], alias: string): unknown {
  return bindings.find((b) => b.alias === alias)?.value;
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

/**
 * Read the panel's working set.
 *
 * Categories win where they are unambiguous. `voltage` is not: a UPS reports
 * both an input and a battery voltage under it, so those two are read by
 * alias — the one place the panel cannot be category-driven.
 */
export function readUpsBindings(bindings: readonly MinimalBinding[]): UpsReadings {
  const raw = byCategory(bindings, "ups_status") ?? byAlias(bindings, "status");
  const rawStatus = raw === null || raw === undefined || raw === "" ? null : String(raw);
  const flags = byAlias(bindings, "status_flags");

  return {
    status: isUpsStatus(rawStatus) ? rawStatus : null,
    rawStatus,
    chargePct: num(byCategory(bindings, "battery")),
    runtimeS: num(byCategory(bindings, "battery_runtime")),
    loadPct: num(byCategory(bindings, "ups_load")),
    loadW: num(byAlias(bindings, "real_power")) ?? num(byAlias(bindings, "estimated_power")),
    inputV: num(byAlias(bindings, "input_voltage")),
    nominalV: num(byAlias(bindings, "input_voltage_nominal")),
    nominalW: num(byAlias(bindings, "nominal_power")),
    transferLow: num(byAlias(bindings, "transfer_low")),
    transferHigh: num(byAlias(bindings, "transfer_high")),
    chargeLowPct: num(byAlias(bindings, "battery_charge_low")),
    runtimeLowS: num(byAlias(bindings, "battery_runtime_low")),
    // The plugin pushes explicit booleans; the raw flag string is the fallback
    // for any other integration that only mirrors `ups.status`.
    charging: bool(byAlias(bindings, "charging")) || /\bCHRG\b/.test(String(flags ?? "")),
    replaceBattery: bool(byAlias(bindings, "replace_battery")) || /\bRB\b/.test(String(flags ?? "")),
  };
}

/** How much room is left before the UPS stops protecting the load. */
export type UpsMargin = "comfortable" | "tight" | "critical";

/**
 * Summarise the margins in one word for the card header.
 *
 * Deliberately coarse: the row values below carry the detail, and a header
 * that changed on every percent would be noise rather than a summary.
 */
export function upsMarginOf(r: UpsReadings): UpsMargin {
  if (r.status === "low_battery" || r.status === "overload" || r.status === "offline") {
    return "critical";
  }
  if (isOnBattery(r.status)) return "tight";
  if (r.loadPct !== null && r.loadPct >= 80) return "tight";
  if (r.chargePct !== null && r.chargePct < 50) return "tight";
  return "comfortable";
}

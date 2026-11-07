import { METERED_CHARGER_THRESHOLD_W, type EvVehicleState } from "../../../lib/ev-charger-contract";
import type { EvChargeSession } from "../../../types";
import { formatEnergyParts, formatPowerParts } from "../../../lib/format";

/**
 * Spec 191 — pure helpers shared by the vehicle and charger session views.
 */

/** `YYYY-MM` of a local date. */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The month `delta` months after `month` (`YYYY-MM`). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(y, m - 1 + delta, 1));
}

/** Capitalised long month and year, e.g. "Novembre 2026". */
export function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Shares of a bar, in percent, off-peak / peak / solar; zeros when there is no energy. */
export function energyShares(e: { gridHcWh: number; gridHpWh: number; solarWh: number }): {
  hc: number;
  hp: number;
  solar: number;
} {
  const total = e.gridHcWh + e.gridHpWh + e.solarWh;
  if (!(total > 0)) return { hc: 0, hp: 0, solar: 0 };
  return {
    hc: (e.gridHcWh / total) * 100,
    hp: (e.gridHpWh / total) * 100,
    solar: (e.solarWh / total) * 100,
  };
}

/** How a session reads on the charger list. */
export type SessionChip =
  | { kind: "identifying" }
  | { kind: "vehicle"; name: string; deleted: boolean }
  | { kind: "todo" }
  | { kind: "other" };

export function sessionChip(s: EvChargeSession): SessionChip {
  switch (s.attribution) {
    case "vehicle":
      return { kind: "vehicle", name: s.vehicleName ?? "?", deleted: s.vehicleDeleted };
    case "other":
      return { kind: "other" };
    case "unattributed":
      return { kind: "todo" };
    default:
      return { kind: "identifying" };
  }
}

/** Wh as a kWh figure, three significant digits (spec 196): « 0,7 », « 14,3 ». */
export function kwh(wh: number, locale: string): string {
  return formatEnergyParts(wh / 1000, { locale }).value;
}

export function dayLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export type PauseReason = "charger-off" | "charge-limit" | "waiting-vehicle";

/**
 * What a session card reads live, from the shared readers of the charger
 * (`evChargerStateOf`) and of the car (`electricVehicleStateOf`).
 */
export interface LiveInputs {
  /** Charging enabled on the charger; null when unbound or unreadable. */
  chargerOn: boolean | null;
  vehicle: EvVehicleState | null;
  /** When the charger's vehicle state last changed (SQLite or ISO). */
  vehicleChangedAt: string | null;
  /** A current power reading only (null when stale or absent). */
  powerW: number | null;
  battery: number | null;
  chargeLimit: number | null;
  /** Spec 193 — the charger has no vehicle state at all: its power tells. */
  metered: boolean;
}

/** Spec 192 — what the charge in progress is doing now. */
export type LiveState =
  | { kind: "charging"; powerW: number | null }
  /** `reason` null: a metered charger (spec 193) cannot tell why. */
  | { kind: "paused"; sinceIso: string | null; reason: PauseReason | null; battery: number | null }
  /** The charger reads unplugged, the session not closed yet: nothing to show until it is. */
  | { kind: "unplugged" }
  | { kind: "ended" };

/** SQLite timestamps use a space (`2026-11-01 14:06:05Z`); ISO uses a `T`. */
export function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * From the session and the live data of its charger and of the car: charging,
 * paused (with the reason the data tells), or ended. A metered charger reads
 * by its power; a charger whose vehicle state is unreadable reads as
 * charging, without a power.
 */
export function liveState(
  session: Pick<EvChargeSession, "endedAt">,
  live: LiveInputs | null,
): LiveState {
  if (session.endedAt !== null) return { kind: "ended" };
  if (live?.vehicle === "disconnected") return { kind: "unplugged" };
  // Spec 193 — a metered charger has no vehicle state: its power tells.
  if (live !== null && live.metered && live.powerW !== null) {
    return live.powerW >= METERED_CHARGER_THRESHOLD_W
      ? { kind: "charging", powerW: live.powerW }
      : { kind: "paused", sinceIso: null, reason: null, battery: live.battery };
  }
  if (live?.vehicle !== "connected") {
    return { kind: "charging", powerW: live?.vehicle === "charging" ? live.powerW : null };
  }
  let reason: PauseReason = "waiting-vehicle";
  if (live.chargerOn === false) reason = "charger-off";
  else if (live.battery !== null && live.chargeLimit !== null && live.battery >= live.chargeLimit) {
    reason = "charge-limit";
  }
  return { kind: "paused", sinceIso: toIso(live.vehicleChangedAt), reason, battery: live.battery };
}

/** W as a kW figure, one decimal: « 3,7 ». */
export function kw(w: number, locale: string): string {
  return formatPowerParts(w, { unit: "kW", locale }).value;
}

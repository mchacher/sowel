import type { EvChargeSession } from "../../../types";

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

export function kwh(wh: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(wh / 1000);
}

export function dayLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function timeLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** The live values a session card reads: a binding's alias, value and last change. */
export interface LiveBinding {
  alias: string;
  value: unknown;
  lastChanged: string | null;
}

export type PauseReason = "charger-off" | "charge-limit" | "waiting-vehicle";

/** Spec 192 — what the charge in progress is doing now. */
export type LiveState =
  | { kind: "charging"; powerW: number | null }
  | { kind: "paused"; sinceIso: string | null; reason: PauseReason; battery: number | null }
  | { kind: "ended" };

/** SQLite timestamps use a space (`2026-11-01 14:06:05Z`); ISO uses a `T`. */
export function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function binding(bindings: LiveBinding[] | undefined, alias: string): LiveBinding | undefined {
  return bindings?.find((b) => b.alias === alias);
}

function num(b: LiveBinding | undefined): number | null {
  return typeof b?.value === "number" && Number.isFinite(b.value) ? b.value : null;
}

/**
 * From the session and the live data of its charger and of the car: charging,
 * paused (with the reason the data tells), or ended. Without the charger's
 * vehicle state it reads as charging, without a power.
 */
export function liveState(
  session: Pick<EvChargeSession, "endedAt">,
  charger: LiveBinding[] | undefined,
  vehicle: LiveBinding[] | undefined,
): LiveState {
  if (session.endedAt !== null) return { kind: "ended" };
  const state = binding(charger, "vehicle");
  if (state?.value !== "connected") {
    return {
      kind: "charging",
      powerW: state?.value === "charging" ? num(binding(charger, "power")) : null,
    };
  }
  const sinceIso = toIso(state.lastChanged);
  const battery = num(binding(vehicle, "battery_level"));
  const limit = num(binding(vehicle, "charge_limit"));
  let reason: PauseReason = "waiting-vehicle";
  if (binding(charger, "state")?.value === false) reason = "charger-off";
  else if (battery !== null && limit !== null && battery >= limit) reason = "charge-limit";
  return { kind: "paused", sinceIso, reason, battery };
}

export function kw(w: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(w / 1000);
}

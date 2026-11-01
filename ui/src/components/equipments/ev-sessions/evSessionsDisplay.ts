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

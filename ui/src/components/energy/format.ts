// Spec 123 — formatting helpers shared by EnergyPage, EnergyBarChart,
// EnergyByUsageChart and LiveEnergyPage. A single helper keeps the
// Wh / € toggle behaviour consistent across every chart, tooltip and
// totals card.

import type { EnergyUnit } from "../../store/useUiState";

// One formatter per locale, built on first use: the tick formatters call this
// on every frame, and constructing an Intl.NumberFormat is not free. The
// currency stays EUR whatever the language (the tariff is in euros); only the
// number and symbol placement follow the locale (#730).
const EUR_BY_LOCALE = new Map<string, Intl.NumberFormat>();

function eurFormatter(locale: string): Intl.NumberFormat {
  let formatter = EUR_BY_LOCALE.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2,
    });
    EUR_BY_LOCALE.set(locale, formatter);
  }
  return formatter;
}

/** Format a Wh value as "X.XX" (day) or "N" (longer periods). */
export function formatKWh(wh: number, period: string): string {
  const kwh = wh / 1000;
  if (period === "day") return kwh.toFixed(2);
  return Math.round(kwh).toString();
}

/** Format an € value, always 2 decimals, with the localized currency symbol. */
export function formatEur(eur: number, locale: string): string {
  const formatter = eurFormatter(locale);
  if (!Number.isFinite(eur)) return formatter.format(0);
  return formatter.format(eur);
}

/**
 * Format either Wh (returned with " kWh" suffix) or € (returned with
 * currency symbol) depending on the active unit. Caller chooses
 * between the kWh and € value to pass — this keeps the helper a pure
 * dispatcher and avoids touching the response shape.
 */
export function formatEnergyOrCost(
  whValue: number,
  eurValue: number,
  unit: EnergyUnit,
  period: string,
  locale: string,
): string {
  if (unit === "eur") return formatEur(eurValue, locale);
  return `${formatKWh(whValue, period)} kWh`;
}

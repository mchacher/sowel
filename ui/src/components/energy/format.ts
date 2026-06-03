// Spec 123 — formatting helpers shared by EnergyPage, EnergyBarChart,
// EnergyByUsageChart and LiveEnergyPage. A single helper keeps the
// Wh / € toggle behaviour consistent across every chart, tooltip and
// totals card.

import type { EnergyUnit } from "../../store/useUiState";

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

/** Format a Wh value as "X.XX" (day) or "N" (longer periods). */
export function formatKWh(wh: number, period: string): string {
  const kwh = wh / 1000;
  if (period === "day") return kwh.toFixed(2);
  return Math.round(kwh).toString();
}

/** Format an € value, always 2 decimals, with the localized currency symbol. */
export function formatEur(eur: number): string {
  if (!Number.isFinite(eur)) return EUR.format(0);
  return EUR.format(eur);
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
): string {
  if (unit === "eur") return formatEur(eurValue);
  return `${formatKWh(whValue, period)} kWh`;
}

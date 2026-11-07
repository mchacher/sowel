// Spec 123 — the Wh / € toggle shared by EnergyPage, EnergyBarChart and
// EnergyByUsageChart, so a chart, its tooltip and the totals card cannot
// disagree. The numbers themselves come from `lib/format` (spec 196).

import type { EnergyUnit } from "../../store/useUiState";
import { formatCurrency, formatEnergy } from "../../lib/format";

/** A Wh total as kWh, three significant digits: « 14,3 kWh », « 984 kWh ». */
export function formatWh(wh: number, locale?: string): string {
  return formatEnergy(wh / 1000, { locale });
}

/**
 * An € value, always 2 decimals, with the localized currency symbol. The
 * currency stays EUR whatever the language (the tariff is in euros); only the
 * number and symbol placement follow the locale (#730). A value that is not a
 * number reads « 0,00 € », as it always has here.
 */
export function formatEur(eur: number, locale: string): string {
  return formatCurrency(Number.isFinite(eur) ? eur : 0, { locale });
}

/**
 * Either the Wh value (as kWh) or the € value depending on the active unit.
 * The caller passes both — this keeps the helper a pure dispatcher and avoids
 * touching the response shape.
 */
export function formatEnergyOrCost(
  whValue: number,
  eurValue: number,
  unit: EnergyUnit,
  locale: string,
): string {
  if (unit === "eur") return formatEur(eurValue, locale);
  return formatWh(whValue, locale);
}

/** A chart tooltip figure, in kWh: Wh below 1 kWh (« 674 Wh », « 7,09 kWh »). */
export function formatKwhTooltip(kwh: number, locale: string): string {
  return formatEnergy(kwh, { unit: "auto", locale });
}

/** A chart Y-axis tick, in kWh: a bare « 0 » at the origin, then « 0,5 kWh », « 4 kWh ». */
export function formatKwhTick(kwh: number, locale: string): string {
  return kwh === 0 ? "0" : formatEnergy(kwh, { locale });
}

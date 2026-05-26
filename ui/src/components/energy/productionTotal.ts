import type { EnergyTotals } from "../../types";

/**
 * Production total shown under the chart legend.
 *
 * Equals the sum of the stacked bars (autoconso + injection) so the
 * label always matches what the user sees on screen. We deliberately do
 * NOT use `total_production` (raw inverter `energy` alias): grid and
 * solar meters drift, so per-minute clamping in SelfConsumptionWriter
 * (autoconso = max(0, solar - injection)) can leave the two series out
 * of sync once injection > solar.
 */
export function displayedProductionTotalWh(totals: EnergyTotals): number {
  return totals.total_autoconso + totals.total_injection;
}

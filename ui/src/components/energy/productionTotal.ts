import type { EnergyTotals } from "../../types";

/**
 * Production total shown under the chart legend.
 *
 * Equals the sum of the stacked bars (autoconso + injection) so the
 * label always matches what the user sees on screen. We deliberately do
 * NOT use `total_production` (raw inverter `energy` alias) as long as the
 * split exists: grid and solar meters drift, so per-minute clamping in
 * SelfConsumptionWriter (autoconso = max(0, solar - injection)) can leave
 * the two series out of sync once injection > solar.
 *
 * When there is no split at all — no grid meter, or a grid stream that
 * never paired with the solar one — the chart falls back to plotting the
 * raw production, and so does this total.
 */
export function displayedProductionTotalWh(totals: EnergyTotals): number {
  const split = totals.total_autoconso + totals.total_injection;
  return split > 0 ? split : totals.total_production;
}

/** Whether the autoconso / injection breakdown is available for the period. */
export function hasProductionSplit(totals: EnergyTotals): boolean {
  return totals.total_autoconso + totals.total_injection > 0;
}

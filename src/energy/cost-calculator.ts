/**
 * Cost calculator — Read-time valuation of HP/HC energy windows in €.
 *
 * Pure, dependency-free. The HP/HC split itself is produced upstream by the
 * TariffClassifier at write time; this module only multiplies Wh by €/kWh.
 * Which prices apply to which energy is `pricing.ts` (spec 202: the tariff
 * version in force at the date of the energy).
 *
 * Spec 123.
 */

import type { TariffPrices } from "../shared/types.js";

export interface CostBreakdown {
  cost_hp: number;
  cost_hc: number;
  cost_total: number;
}

const ZERO: CostBreakdown = { cost_hp: 0, cost_hc: 0, cost_total: 0 };

/**
 * Compute the € cost of an HP/HC energy window.
 *
 * Returns zeros for any non-finite input (defensive — protects routes
 * from a corrupt TariffConfig blob or empty Influx point).
 */
export function computeCost(hpWh: number, hcWh: number, prices: TariffPrices): CostBreakdown {
  if (
    !Number.isFinite(hpWh) ||
    !Number.isFinite(hcWh) ||
    !prices ||
    !Number.isFinite(prices.hp) ||
    !Number.isFinite(prices.hc)
  ) {
    return { ...ZERO };
  }
  const cost_hp = round4((hpWh / 1000) * prices.hp);
  const cost_hc = round4((hcWh / 1000) * prices.hc);
  const cost_total = round4(cost_hp + cost_hc);
  return { cost_hp, cost_hc, cost_total };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

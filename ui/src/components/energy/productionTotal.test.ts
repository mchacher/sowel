import { describe, expect, it } from "vitest";
import type { EnergyTotals } from "../../types";
import { displayedProductionTotalWh } from "./productionTotal";

function totals(partial: Partial<EnergyTotals>): EnergyTotals {
  return {
    total_consumption: 0,
    total_hp: 0,
    total_hc: 0,
    total_production: 0,
    total_autoconso: 0,
    total_injection: 0,
    ...partial,
  };
}

describe("displayedProductionTotalWh", () => {
  it("returns autoconso + injection", () => {
    expect(
      displayedProductionTotalWh(
        totals({ total_autoconso: 13_600, total_injection: 2_480 }),
      ),
    ).toBe(16_080);
  });

  it("ignores total_production from the raw inverter series", () => {
    // Real-world case from the bug report: solar meter measured 15.01 kWh
    // but autoconso + injection on the grid meter side sums to 16.08 kWh
    // because of per-minute clamping when injection > solar. The label
    // must match the stacked bars, not the raw inverter total.
    const t = totals({
      total_production: 15_010,
      total_autoconso: 13_600,
      total_injection: 2_480,
    });
    expect(displayedProductionTotalWh(t)).toBe(16_080);
  });

  it("returns 0 when both components are 0", () => {
    expect(displayedProductionTotalWh(totals({}))).toBe(0);
  });
});

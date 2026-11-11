import { describe, expect, it } from "vitest";
import { computeCost } from "./cost-calculator.js";

describe("computeCost", () => {
  it("values pure-HP window", () => {
    expect(computeCost(1000, 0, { hp: 0.2, hc: 0.1 })).toEqual({
      cost_hp: 0.2,
      cost_hc: 0,
      cost_total: 0.2,
    });
  });

  it("values mixed HP/HC window", () => {
    expect(computeCost(500, 500, { hp: 0.2, hc: 0.1 })).toEqual({
      cost_hp: 0.1,
      cost_hc: 0.05,
      cost_total: 0.15,
    });
  });

  it("returns zeros when prices are 0", () => {
    expect(computeCost(1000, 1000, { hp: 0, hc: 0 })).toEqual({
      cost_hp: 0,
      cost_hc: 0,
      cost_total: 0,
    });
  });

  it("returns zeros when energy is 0", () => {
    expect(computeCost(0, 0, { hp: 0.2, hc: 0.1 })).toEqual({
      cost_hp: 0,
      cost_hc: 0,
      cost_total: 0,
    });
  });

  it("returns zeros defensively on NaN energy", () => {
    expect(computeCost(Number.NaN, 0, { hp: 0.2, hc: 0.1 })).toEqual({
      cost_hp: 0,
      cost_hc: 0,
      cost_total: 0,
    });
  });

  it("returns zeros defensively on NaN price", () => {
    expect(computeCost(1000, 1000, { hp: Number.NaN, hc: 0.1 })).toEqual({
      cost_hp: 0,
      cost_hc: 0,
      cost_total: 0,
    });
  });

  it("rounds to 4 decimals", () => {
    const result = computeCost(1234, 5678, { hp: 0.23456, hc: 0.12345 });
    // hp: 1.234 * 0.23456 = 0.28944704 → 0.2894
    // hc: 5.678 * 0.12345 = 0.70094910 → 0.7009
    // cost_total = round4(cost_hp + cost_hc) after each is already rounded.
    expect(result.cost_hp).toBeCloseTo(0.2894, 4);
    expect(result.cost_hc).toBeCloseTo(0.7009, 4);
    expect(result.cost_total).toBeCloseTo(0.9903, 4);
  });

  it("handles HC-only price (HP=0)", () => {
    expect(computeCost(1000, 1000, { hp: 0, hc: 0.1 })).toEqual({
      cost_hp: 0,
      cost_hc: 0.1,
      cost_total: 0.1,
    });
  });
});

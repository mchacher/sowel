import { describe, expect, it } from "vitest";
import {
  HOLD_LIMIT_MS,
  WINDOW_S,
  WindowAccountant,
  poolImport,
  settleWindow,
} from "./window-accountant.js";

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0); // a window boundary
const MIN = 60_000;

describe("WindowAccountant", () => {
  it("integrates a held power over a whole window", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 1400);
    const [w] = acc.advance(T0 + WINDOW_S * 1000);
    expect(w.carWh).toBeCloseTo(1400 / 12, 6);
  });

  it("returns nothing for a window where the car drew nothing", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 0);
    expect(acc.advance(T0 + WINDOW_S * 1000)).toEqual([]);
  });

  it("stops holding the power after the hold limit without any charger report", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 1200);
    const closed = acc.advance(T0 + 30 * MIN);
    const total = closed.reduce((s, w) => s + w.carWh, 0);
    expect(total).toBeCloseTo((1200 * HOLD_LIMIT_MS) / 3_600_000, 6);
  });

  it("keeps the power held while the charger reports something else", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 1200);
    const closed = [...acc.carEnergy(T0 + 14 * MIN, 100), ...acc.advance(T0 + 25 * MIN)];
    const total = closed.reduce((s, w) => s + w.carWh, 0);
    expect(total).toBeCloseTo((1200 * 25 * MIN) / 3_600_000, 6);
  });

  it("falls back to energy deltas when the charger reports no power", () => {
    const acc = new WindowAccountant(T0);
    acc.carEnergy(T0 + MIN, 100);
    acc.carEnergy(T0 + 3 * MIN, 50);
    const [w] = acc.advance(T0 + WINDOW_S * 1000);
    expect(w.carWh).toBe(150);
  });

  it("measures by power alone once the charger reported one (no double count)", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 1200);
    acc.power(T0 + MIN, 0);
    const [w] = [...acc.carEnergy(T0 + 6 * MIN, 100), ...acc.finish(T0 + 7 * MIN)];
    expect(w.carWh).toBeCloseTo(20, 6);
  });

  it("closes the partial last window at the session end", () => {
    const acc = new WindowAccountant(T0);
    acc.power(T0, 3600);
    const closed = acc.finish(T0 + 7 * MIN);
    expect(closed).toHaveLength(2);
    expect(closed[1].lengthS).toBe(120);
    expect(closed[1].carWh).toBeCloseTo(120, 6);
  });

  it("starts on the window boundary before the plug-in", () => {
    const acc = new WindowAccountant(T0 + 2 * MIN);
    acc.power(T0 + 2 * MIN, 600);
    const [w] = acc.advance(T0 + WINDOW_S * 1000);
    expect(w.startS).toBe(T0 / 1000);
    expect(w.carWh).toBeCloseTo(30, 6);
  });
});

describe("settleWindow", () => {
  const prices = { hp: 0.2, hc: 0.1 };
  const base = { startS: T0 / 1000, lengthS: WINDOW_S };

  it("charges the car only what the house imported (P5)", () => {
    const s = settleWindow(
      { ...base, carWh: 1400 / 12, importWh: 400 / 12 },
      { hasMainMeter: true, hcShare: 0, prices },
    );
    expect(s.gridHpWh).toBeCloseTo(400 / 12, 6);
    expect(s.gridHpWh / s.carWh).toBeCloseTo(2 / 7, 6);
  });

  it("is all solar when the house exported the whole window", () => {
    const s = settleWindow(
      { ...base, carWh: 100, importWh: 0 },
      { hasMainMeter: true, hcShare: 0, prices },
    );
    expect(s.gridHpWh + s.gridHcWh).toBe(0);
  });

  it("is all grid when the house imported more than the car drew", () => {
    const s = settleWindow(
      { ...base, carWh: 100, importWh: 900 },
      { hasMainMeter: true, hcShare: 0, prices },
    );
    expect(s.gridHpWh).toBe(100);
  });

  it("never invents solar without a grid reading or without a main meter", () => {
    const silent = settleWindow(
      { ...base, carWh: 100, importWh: null },
      { hasMainMeter: true, hcShare: 0, prices },
    );
    const noMeter = settleWindow(
      { ...base, carWh: 100, importWh: 0 },
      { hasMainMeter: false, hcShare: 0, prices },
    );
    expect(silent.gridHpWh).toBe(100);
    expect(noMeter.gridHpWh).toBe(100);
  });

  it("prices off-peak at the HC price and peak at the HP price", () => {
    const hc = settleWindow(
      { ...base, carWh: 1000, importWh: 1000 },
      { hasMainMeter: true, hcShare: 1, prices },
    );
    const hp = settleWindow(
      { ...base, carWh: 1000, importWh: 1000 },
      { hasMainMeter: true, hcShare: 0, prices },
    );
    expect(hc.costHcEur).toBeCloseTo(0.1, 9);
    expect(hc.costHpEur).toBe(0);
    expect(hp.costHpEur).toBeCloseTo(0.2, 9);
  });

  it("splits a window straddling a tariff boundary by its off-peak share", () => {
    const s = settleWindow(
      { ...base, carWh: 1000, importWh: 1000 },
      { hasMainMeter: true, hcShare: 0.2, prices },
    );
    expect(s.gridHcWh).toBeCloseTo(200, 9);
    expect(s.gridHpWh).toBeCloseTo(800, 9);
  });

  it("has no cost without a tariff, but still splits grid and solar", () => {
    const s = settleWindow(
      { ...base, carWh: 100, importWh: 40 },
      { hasMainMeter: true, hcShare: 0, prices: null },
    );
    expect(s.costHpEur).toBeNull();
    expect(s.gridHpWh).toBe(40);
  });
});

describe("poolImport (audit A2)", () => {
  it("shares one import between the cars of a window, pro rata", () => {
    // Two cars draw 1300 and 7000 Wh while the house imports 5800 Wh.
    const [a, b] = poolImport([1300, 7000], [5800, 5800], 5800) as number[];
    expect(a + b).toBeCloseTo(5800, 6);
    expect(a / b).toBeCloseTo(1300 / 7000, 6);
  });

  it("never gives a car more than it drew or than was imported during its own part", () => {
    expect(poolImport([100, 200], [900, 900], 900)).toEqual([100, 200]);
    // A car plugged in for the last 2 min: the house's import before is not its.
    expect(poolImport([100], [10], 300)).toEqual([10]);
    expect(poolImport([100], [0], null)).toEqual([null]);
    expect(poolImport([0, 0], [50, 50], 50)).toEqual([0, 0]);
  });
});

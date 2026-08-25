import { describe, expect, it } from "vitest";
import type { PvForecastPoint } from "../../types";
import { sumKwh } from "./pvForecastUtils";

/** An hourly curve of `watts`, starting at local midnight `dayOffset` days out. */
function curve(dayOffset: number, watts: number, hours = 24): PvForecastPoint[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + dayOffset);
  return Array.from({ length: hours }, (_, h) => ({
    at: new Date(start.getTime() + h * 3_600_000).toISOString(),
    watts,
  }));
}

describe("sumKwh", () => {
  it("sums one local day, in kWh", () => {
    // 24 hours at 1000 W is 24 kWh.
    expect(sumKwh(curve(0, 1000), 0)).toBeCloseTo(24, 6);
  });

  it("keeps the days apart", () => {
    const both = [...curve(0, 1000), ...curve(1, 500)];
    expect(sumKwh(both, 0)).toBeCloseTo(24, 6);
    expect(sumKwh(both, 1)).toBeCloseTo(12, 6);
  });

  it("uses local midnight, not UTC midnight", () => {
    // The first local hour of today must count towards today even where the
    // local offset puts it on the previous UTC date.
    const firstHour = curve(0, 1000, 1);
    expect(sumKwh(firstHour, 0)).toBeCloseTo(1, 6);
    expect(sumKwh(firstHour, -1)).toBe(0);
  });

  it("excludes the hour that starts exactly at the next midnight", () => {
    const twentyFive = curve(0, 1000, 25);
    expect(sumKwh(twentyFive, 0)).toBeCloseTo(24, 6);
    expect(sumKwh(twentyFive, 1)).toBeCloseTo(1, 6);
  });

  it("is zero for a day the curve does not reach", () => {
    expect(sumKwh(curve(0, 1000), 4)).toBe(0);
  });

  it("is zero on an empty curve", () => {
    expect(sumKwh([], 0)).toBe(0);
  });

  it("ignores an unparseable timestamp rather than producing NaN", () => {
    const dirty = [...curve(0, 1000, 2), { at: "not-a-date", watts: 9999 }];
    expect(sumKwh(dirty, 0)).toBeCloseTo(2, 6);
  });

  it("ignores a non-finite wattage", () => {
    const dirty = curve(0, 1000, 2).concat({
      at: new Date().toISOString(),
      watts: Number.NaN,
    });
    expect(Number.isFinite(sumKwh(dirty, 0))).toBe(true);
  });
});

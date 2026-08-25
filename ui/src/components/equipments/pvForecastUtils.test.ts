import { describe, expect, it } from "vitest";
import type { PvForecastPoint } from "../../types";
import { sumKwh, dailyTicks } from "./pvForecastUtils";

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

describe("dailyTicks", () => {
  const HOUR = 3_600_000;
  /** `n` hourly timestamps starting at a local midnight. */
  function hourly(startLocal: string, n: number): number[] {
    const t0 = new Date(startLocal).getTime();
    return Array.from({ length: n }, (_, i) => t0 + i * HOUR);
  }

  it("gives one tick per day, not one every few points", () => {
    // The defect: 144 hourly points formatted as weekday names rendered as
    // "Tue Tue Tue Tue Wed Wed Wed…".
    const ticks = dailyTicks(hourly("2026-08-25T00:00:00", 144));
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
  });

  it("puts every tick on a local midnight", () => {
    for (const ts of dailyTicks(hourly("2026-08-25T00:00:00", 144))) {
      const d = new Date(ts);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it("keeps every tick inside the data range", () => {
    const points = hourly("2026-08-25T13:00:00", 60);
    const min = Math.min(...points);
    const max = Math.max(...points);
    for (const ts of dailyTicks(points)) {
      expect(ts).toBeGreaterThanOrEqual(min);
      expect(ts).toBeLessThanOrEqual(max);
    }
  });

  it("never repeats a day", () => {
    const ticks = dailyTicks(hourly("2026-08-25T00:00:00", 144));
    const days = ticks.map((ts) => new Date(ts).toDateString());
    expect(new Set(days).size).toBe(days.length);
  });

  it("returns nothing for an empty series", () => {
    expect(dailyTicks([])).toEqual([]);
  });

  it("returns nothing rather than looping on a series of non-finite values", () => {
    expect(dailyTicks([Number.NaN, Number.NaN])).toEqual([]);
  });

  it("handles a range shorter than a day", () => {
    // Six hours inside one afternoon contains no midnight at all.
    expect(dailyTicks(hourly("2026-08-25T13:00:00", 6))).toEqual([]);
  });

  it("copes with an unsorted series", () => {
    const points = hourly("2026-08-25T00:00:00", 72);
    const shuffled = [...points].reverse();
    expect(dailyTicks(shuffled)).toEqual(dailyTicks(points));
  });
});

describe("dailyTicks over a long window", () => {
  const HOUR = 3_600_000;
  const hourly = (startLocal: string, n: number): number[] => {
    const t0 = new Date(startLocal).getTime();
    return Array.from({ length: n }, (_, i) => t0 + i * HOUR);
  };

  it("thins the ticks rather than crowding ninety labels onto the axis", () => {
    const ticks = dailyTicks(hourly("2026-06-01T00:00:00", 90 * 24));
    expect(ticks.length).toBeLessThanOrEqual(13);
    expect(ticks.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every thinned tick on a local midnight", () => {
    for (const ts of dailyTicks(hourly("2026-06-01T00:00:00", 90 * 24))) {
      expect(new Date(ts).getHours()).toBe(0);
    }
  });

  it("still gives one tick per day over a short window", () => {
    // The thinning must not kick in when it is not needed.
    const ticks = dailyTicks(hourly("2026-08-20T00:00:00", 6 * 24));
    expect(ticks.length).toBeGreaterThanOrEqual(5);
  });

  it("honours an explicit ceiling", () => {
    expect(dailyTicks(hourly("2026-06-01T00:00:00", 30 * 24), 5).length).toBeLessThanOrEqual(6);
  });
});

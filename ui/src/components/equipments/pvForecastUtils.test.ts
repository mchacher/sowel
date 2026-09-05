import { describe, expect, it } from "vitest";
import type { PvForecastPoint } from "../../types";
import { sumKwh, dailyTicks, mergeTimeline } from "./pvForecastUtils";

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

describe("mergeTimeline", () => {
  const NOW = Date.parse("2026-08-25T12:00:00Z");
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

  it("puts past and future on one ordered series", () => {
    const out = mergeTimeline(
      [{ at: at(-2), forecastW: 900, actualW: 850 }],
      [{ at: at(1), watts: 1200 }],
      NOW,
    );
    expect(out.map((p) => p.ts)).toEqual([...out.map((p) => p.ts)].sort((a, b) => a - b));
    expect(out).toHaveLength(2);
  });

  it("carries the measurement only on past hours", () => {
    const out = mergeTimeline(
      [{ at: at(-2), forecastW: 900, actualW: 850 }],
      [{ at: at(1), watts: 1200 }],
      NOW,
    );
    expect(out[0].actualW).toBe(850);
    expect(out[1].actualW).toBeUndefined();
  });

  it("keeps what was promised for a past hour, not the recomputed curve", () => {
    // The curve still holds today's elapsed hours, recomputed from irradiance
    // now known. Letting that overwrite the promise would flatter the model
    // against its own record.
    const out = mergeTimeline(
      [{ at: at(-2), forecastW: 900, actualW: 850 }],
      [
        { at: at(-2), watts: 860 },
        { at: at(3), watts: 1500 },
      ],
      NOW,
    );
    const past = out.find((p) => p.ts === Date.parse(at(-2)));
    expect(past?.forecastW).toBe(900);
  });

  it("takes the curve for the hour in progress and everything after", () => {
    const out = mergeTimeline([], [{ at: at(0), watts: 1100 }], NOW);
    expect(out[0].forecastW).toBe(1100);
  });

  it("shows the forecast alone when nothing has been compared yet", () => {
    const out = mergeTimeline([], [{ at: at(1), watts: 1200 }], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].actualW).toBeUndefined();
  });

  it("shows the comparison alone when the curve is empty", () => {
    const out = mergeTimeline([{ at: at(-3), forecastW: 700, actualW: 640 }], [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].forecastW).toBe(700);
  });

  it("skips unparseable timestamps rather than producing NaN points", () => {
    const out = mergeTimeline(
      [{ at: "hier", forecastW: 1, actualW: 1 }],
      [{ at: "demain", watts: 1 }],
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("is empty when both sides are", () => {
    expect(mergeTimeline([], [], NOW)).toEqual([]);
  });
});

describe("mergeTimeline with a measured series and no forecast history", () => {
  const NOW = Date.parse("2026-08-25T12:00:00Z");
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

  it("draws production for the past even when nothing was ever forecast", () => {
    // The reported bug: an installation declared this morning showed a forecast
    // over an empty past while its own production sat in the database. The
    // measured line was fed from the comparison, which needs a forecast issued
    // the day before to exist at all.
    const out = mergeTimeline(
      [],
      [{ at: at(2), watts: 1500 }],
      NOW,
      [
        { at: at(-3), watts: 700 },
        { at: at(-2), watts: 900 },
      ],
    );
    expect(out).toHaveLength(3);
    expect(out.filter((p) => p.actualW !== undefined)).toHaveLength(2);
    expect(out[0].actualW).toBe(700);
    expect(out[0].forecastW).toBeUndefined();
  });

  it("lets the comparison win where both describe the same hour", () => {
    // `points.actualW` and `measured.watts` are the same reading; taking either
    // is fine, but the pair must not end up split across two entries.
    const out = mergeTimeline(
      [{ at: at(-2), forecastW: 950, actualW: 900 }],
      [],
      NOW,
      [{ at: at(-2), watts: 900 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].forecastW).toBe(950);
    expect(out[0].actualW).toBe(900);
  });

  it("still works with no measured series at all, as older payloads have", () => {
    const out = mergeTimeline([{ at: at(-1), forecastW: 800, actualW: 780 }], [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].actualW).toBe(780);
  });

  it("keeps measured hours ordered with the rest", () => {
    const out = mergeTimeline(
      [],
      [{ at: at(1), watts: 100 }],
      NOW,
      [{ at: at(-1), watts: 200 }, { at: at(-5), watts: 300 }],
    );
    expect(out.map((p) => p.ts)).toEqual([...out.map((p) => p.ts)].sort((a, b) => a - b));
  });

  it("ignores an unparseable measured timestamp", () => {
    expect(mergeTimeline([], [], NOW, [{ at: "hier", watts: 1 }])).toEqual([]);
  });
});

describe("mergeTimeline forward horizon (#907)", () => {
  const NOW = Date.parse("2026-08-25T12:00:00Z");
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

  // The curve runs to J+5. On a one-day zoom, keeping all of it would draw one
  // day of history against five of forecast, which does not read as a zoom.
  const curve = [at(1), at(25), at(49), at(73), at(97)].map((a) => ({ at: a, watts: 900 }));

  it("caps the forecast side at the selected window", () => {
    const merged = mergeTimeline([], curve, NOW, [], 1);
    expect(merged).toHaveLength(1);
    expect(merged[0].ts).toBe(Date.parse(at(1)));
  });

  it("keeps the whole curve when no horizon is given", () => {
    expect(mergeTimeline([], curve, NOW, [])).toHaveLength(5);
  });

  it("never trims the past, which is the window the user asked for", () => {
    const measured = [{ at: at(-20), watts: 500 }];
    const merged = mergeTimeline([], curve, NOW, measured, 1);
    expect(merged.some((p) => p.actualW === 500)).toBe(true);
  });
});

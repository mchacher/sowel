import { describe, expect, it } from "vitest";
import { pairSeries } from "./pv-accuracy.js";

const h = (n: number): string => `2026-08-25T${String(n).padStart(2, "0")}:00:00Z`;

describe("pairSeries", () => {
  it("scores the hours both sides carry", () => {
    const forecast = new Map([
      [h(10), 1000],
      [h(11), 1200],
    ]);
    const actual = new Map([
      [h(10), 900],
      [h(11), 1400],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(2);
    expect(result.maeW).toBe(150); // (100 + 200) / 2
    expect(result.points).toHaveLength(2);
  });

  it("ignores an hour the meter never reported", () => {
    // An outage is not a forecast miss. Scoring it as one would make a dead
    // inverter look like a bad model.
    const forecast = new Map([
      [h(10), 1000],
      [h(11), 1200],
    ]);
    const actual = new Map([[h(10), 1000]]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(1);
    expect(result.maeW).toBe(0);
  });

  it("ignores an hour that was never forecast", () => {
    const result = pairSeries(
      new Map([[h(10), 500]]),
      new Map([
        [h(10), 500],
        [h(11), 900],
      ]),
    );
    expect(result.samples).toBe(1);
  });

  it("reports nothing rather than a perfect score when there is no overlap", () => {
    const result = pairSeries(new Map([[h(10), 1000]]), new Map([[h(15), 1000]]));
    expect(result.samples).toBe(0);
    expect(result.maeW).toBeNull();
    expect(result.points).toEqual([]);
  });

  it("reports nothing on empty inputs", () => {
    expect(pairSeries(new Map(), new Map()).maeW).toBeNull();
  });

  it("returns the points in chronological order whatever the map order", () => {
    const forecast = new Map([
      [h(14), 1],
      [h(9), 2],
      [h(11), 3],
    ]);
    const actual = new Map([
      [h(9), 2],
      [h(11), 3],
      [h(14), 1],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.points.map((p) => p.at)).toEqual([h(9), h(11), h(14)]);
  });

  it("skips a non-finite value rather than producing a NaN error", () => {
    const forecast = new Map([
      [h(10), Number.NaN],
      [h(11), 1000],
    ]);
    const actual = new Map([
      [h(10), 500],
      [h(11), 800],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(1);
    expect(result.maeW).toBe(200);
  });

  it("treats over- and under-forecasting alike", () => {
    const over = pairSeries(new Map([[h(10), 1200]]), new Map([[h(10), 1000]]));
    const under = pairSeries(new Map([[h(10), 800]]), new Map([[h(10), 1000]]));
    expect(over.maeW).toBe(under.maeW);
  });
});

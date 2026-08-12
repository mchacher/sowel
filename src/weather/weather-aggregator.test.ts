import { describe, it, expect, vi } from "vitest";
import { computeRainCumuls } from "./weather-aggregator.js";

describe("computeRainCumuls", () => {
  it("uses the native rolling cumulative (sum_rain_24) as-is, never summing samples", async () => {
    const bindings = [
      { alias: "rain", value: 0 },
      { alias: "sum_rain_1", value: 0 },
      { alias: "sum_rain_24", value: 11.9 },
    ];
    // 1392.3 is what the old buggy sum-of-cumuls path produced — must NOT be used.
    const sumIncremental = vi.fn(async () => 1392.3);

    const { rain1h, rain24h } = await computeRainCumuls(bindings, sumIncremental);

    expect(rain24h).toBe(11.9);
    expect(rain1h).toBe(0);
    expect(sumIncremental).not.toHaveBeenCalled();
  });

  it("rounds the native value to one decimal", async () => {
    const bindings = [
      { alias: "sum_rain_24", value: 11.94 },
      { alias: "sum_rain_1", value: 0.06 },
    ];
    const { rain1h, rain24h } = await computeRainCumuls(bindings, async () => null);
    expect(rain24h).toBe(11.9);
    expect(rain1h).toBe(0.1);
  });

  it("falls back to summing the incremental rain when no native cumulative exists", async () => {
    const bindings = [{ alias: "rain", value: 0.2 }]; // incremental-only station (e.g. z2m)
    const sumIncremental = vi.fn(async (w: "-1h" | "-24h") => (w === "-24h" ? 3.4 : 0.2));

    const { rain1h, rain24h } = await computeRainCumuls(bindings, sumIncremental);

    expect(rain24h).toBe(3.4);
    expect(rain1h).toBe(0.2);
    expect(sumIncremental).toHaveBeenCalledWith("-24h");
    expect(sumIncremental).toHaveBeenCalledWith("-1h");
  });

  it("yields null (no fallback) when a native cumulative is present but non-numeric", async () => {
    const bindings = [
      { alias: "sum_rain_24", value: null },
      { alias: "sum_rain_1", value: "x" },
    ];
    const sumIncremental = vi.fn(async () => 99);

    const { rain1h, rain24h } = await computeRainCumuls(bindings, sumIncremental);

    expect(rain24h).toBeNull();
    expect(rain1h).toBeNull();
    expect(sumIncremental).not.toHaveBeenCalled();
  });

  // ── Additional cases (spec 449 coverage) ──────────────────────────────

  it("mixes native (present) and incremental fallback (absent) per window", async () => {
    // sum_rain_1 present → used as-is; sum_rain_24 absent → incremental fallback.
    const sumIncremental = vi.fn(async () => 3.0);
    const { rain1h, rain24h } = await computeRainCumuls(
      [{ alias: "sum_rain_1", value: 2.0 }],
      sumIncremental,
    );

    expect(rain1h).toBe(2.0); // native
    expect(rain24h).toBe(3.0); // fallback
    expect(sumIncremental).toHaveBeenCalledTimes(1);
    expect(sumIncremental).toHaveBeenCalledWith("-24h");
  });

  it("coerces a numeric string native value (and only that value is used)", async () => {
    const sumIncremental = vi.fn(async () => null);
    const { rain1h, rain24h } = await computeRainCumuls(
      [
        { alias: "sum_rain_1", value: "1.5" }, // coerced to 1.5
        { alias: "sum_rain_24", value: "abc" }, // NaN → null
      ],
      sumIncremental,
    );

    expect(rain1h).toBe(1.5);
    expect(rain24h).toBeNull();
    expect(sumIncremental).not.toHaveBeenCalled();
  });

  it("returns null (not 0) when the incremental fallback itself has no data", async () => {
    const { rain1h, rain24h } = await computeRainCumuls([], async () => null);
    expect(rain1h).toBeNull();
    expect(rain24h).toBeNull();
  });
});

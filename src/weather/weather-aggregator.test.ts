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
});

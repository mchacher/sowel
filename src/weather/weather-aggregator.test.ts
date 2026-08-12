import { describe, it, expect, vi } from "vitest";
import { computeRainCumuls } from "./weather-aggregator.js";

describe("computeRainCumuls", () => {
  it("uses the native rolling cumulatives as-is when present (never summed)", async () => {
    const sumIncremental = vi.fn<(w: "-1h" | "-24h") => Promise<number | null>>();
    const result = await computeRainCumuls(
      [
        { alias: "sum_rain_1", value: 1.23 },
        { alias: "sum_rain_24", value: 8.76 },
      ],
      sumIncremental,
    );

    expect(result).toEqual({ rain1h: 1.2, rain24h: 8.8 }); // rounded to a tenth
    expect(sumIncremental).not.toHaveBeenCalled(); // native present → no Influx fallback
  });

  it("falls back to summing the incremental series when a native cumul is absent", async () => {
    const sumIncremental = vi.fn(async (window: "-1h" | "-24h") =>
      window === "-1h" ? 0.44 : 5.55,
    );

    const result = await computeRainCumuls([{ alias: "rain", value: 0.2 }], sumIncremental);

    expect(result).toEqual({ rain1h: 0.4, rain24h: 5.6 });
    expect(sumIncremental).toHaveBeenCalledWith("-1h");
    expect(sumIncremental).toHaveBeenCalledWith("-24h");
  });

  it("mixes native (present) and fallback (absent) per window", async () => {
    const sumIncremental = vi.fn(async () => 3.0);
    const result = await computeRainCumuls([{ alias: "sum_rain_1", value: 2.0 }], sumIncremental);

    expect(result.rain1h).toBe(2.0); // native
    expect(result.rain24h).toBe(3.0); // fallback (sum_rain_24 absent)
    expect(sumIncremental).toHaveBeenCalledTimes(1);
    expect(sumIncremental).toHaveBeenCalledWith("-24h");
  });

  it("treats a present-but-empty native binding as null (no fallback)", async () => {
    const sumIncremental = vi.fn(async () => 9.9);
    const result = await computeRainCumuls(
      [
        { alias: "sum_rain_1", value: null },
        { alias: "sum_rain_24", value: "" },
      ],
      sumIncremental,
    );

    // Present binding with no numeric value → null, and NOT a fallback trigger.
    expect(result).toEqual({ rain1h: null, rain24h: null });
    expect(sumIncremental).not.toHaveBeenCalled();
  });

  it("coerces string numbers and rejects non-numeric strings to null", async () => {
    const sumIncremental = vi.fn(async () => null);
    const result = await computeRainCumuls(
      [
        { alias: "sum_rain_1", value: "1.5" }, // coerced
        { alias: "sum_rain_24", value: "abc" }, // NaN → null
      ],
      sumIncremental,
    );

    expect(result).toEqual({ rain1h: 1.5, rain24h: null });
    expect(sumIncremental).not.toHaveBeenCalled();
  });

  it("returns null (not 0) when the incremental fallback has no data", async () => {
    const sumIncremental = vi.fn(async () => null);
    const result = await computeRainCumuls([], sumIncremental);
    expect(result).toEqual({ rain1h: null, rain24h: null });
  });
});

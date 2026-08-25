import { describe, expect, it } from "vitest";
import {
  GAMMA_PER_C,
  IMPOSSIBLE_FACTOR,
  MIN_SAMPLES,
  fitModel,
  predict,
  refitGainOnly,
  type PvSample,
} from "./pv-model.js";

const PEAK_WC = 4000;
const AT = new Date("2026-08-25T02:00:00Z");

/**
 * A synthetic array: `gain` watts per W/m2, and an hourly shape that dips in the
 * morning the way a shaded site does. Enough days to clear the sample floor.
 */
function synthetic(opts: {
  gain: number;
  days?: number;
  shape?: Record<number, number>;
  tempC?: number;
}): PvSample[] {
  const { gain, days = 20, shape = {}, tempC = 25 } = opts;
  const out: PvSample[] = [];
  for (let d = 0; d < days; d++) {
    for (let hourLocal = 8; hourLocal <= 18; hourLocal++) {
      const poa = 200 + 60 * (12 - Math.abs(13 - hourLocal));
      const factor = shape[hourLocal] ?? 1;
      out.push({ hourLocal, poa, tempC, watts: gain * factor * poa });
    }
  }
  return out;
}

describe("fitModel", () => {
  it("recovers the injected gain on a clean array", () => {
    const model = fitModel(synthetic({ gain: 2.5 }), PEAK_WC, AT);
    expect(model).not.toBeNull();
    expect(model!.gain).toBeCloseTo(2.5, 3);
  });

  it("normalises the shape on the array's best hour", () => {
    const model = fitModel(synthetic({ gain: 2.5, shape: { 8: 0.5, 18: 0.6 } }), PEAK_WC, AT);
    expect(Math.max(...Object.values(model!.shape))).toBeCloseTo(1, 6);
    expect(model!.shape[8]).toBeCloseTo(0.5, 3);
    expect(model!.shape[18]).toBeCloseTo(0.6, 3);
  });

  it("recovers a shading profile shaped like the reference site's", () => {
    // 53 % at 08 h and 61 % at 20 h were this household's trees.
    const model = fitModel(synthetic({ gain: 3, shape: { 8: 0.53, 18: 0.61 } }), PEAK_WC, AT);
    expect(model!.shape[8]).toBeCloseTo(0.53, 2);
    expect(model!.shape[12]).toBeCloseTo(1, 2);
  });

  it("returns null below the sample floor rather than fitting on noise", () => {
    const few = synthetic({ gain: 2.5 }).slice(0, MIN_SAMPLES - 1);
    expect(fitModel(few, PEAK_WC, AT)).toBeNull();
  });

  it("returns null when every sample is dark", () => {
    const night: PvSample[] = Array.from({ length: 300 }, () => ({
      hourLocal: 2,
      poa: 0,
      tempC: 12,
      watts: 0,
    }));
    expect(fitModel(night, PEAK_WC, AT)).toBeNull();
  });

  it("excludes a physically impossible reading from the fit", () => {
    const clean = synthetic({ gain: 2.5 });
    const poisoned = [
      ...clean,
      // The shape of the real thing: 31 kW on an array rated 4 kWc.
      { hourLocal: 13, poa: 900, tempC: 25, watts: 31000 },
      { hourLocal: 13, poa: 900, tempC: 25, watts: 29000 },
    ];
    const reference = fitModel(clean, PEAK_WC, AT)!;
    const guarded = fitModel(poisoned, PEAK_WC, AT)!;
    expect(guarded.gain).toBeCloseTo(reference.gain, 6);
    expect(guarded.samples).toBe(reference.samples);
  });

  it("keeps a reading just under the impossible ceiling", () => {
    const kept = [
      ...synthetic({ gain: 2.5 }),
      { hourLocal: 13, poa: 900, tempC: 5, watts: PEAK_WC * (IMPOSSIBLE_FACTOR - 0.05) },
    ];
    expect(fitModel(kept, PEAK_WC, AT)!.samples).toBe(synthetic({ gain: 2.5 }).length + 1);
  });

  it("ignores an hour with too few samples rather than trusting it", () => {
    const sparse = [...synthetic({ gain: 2.5 }), { hourLocal: 5, poa: 100, tempC: 20, watts: 10 }];
    expect(fitModel(sparse, PEAK_WC, AT)!.shape[5]).toBeUndefined();
  });

  it("rejects a nonsense local hour", () => {
    const bad = [...synthetic({ gain: 2.5 }), { hourLocal: 25, poa: 500, tempC: 20, watts: 1000 }];
    expect(fitModel(bad, PEAK_WC, AT)!.shape[25]).toBeUndefined();
  });
});

describe("predict", () => {
  const model = fitModel(synthetic({ gain: 2.5, shape: { 8: 0.5 } }), PEAK_WC, AT)!;

  it("reproduces the samples it was fitted on", () => {
    expect(predict(model, { hourLocal: 13, poa: 800, tempC: 25 }, PEAK_WC)).toBeCloseTo(
      2.5 * 800,
      0,
    );
  });

  it("applies the hourly shape", () => {
    const noon = predict(model, { hourLocal: 13, poa: 800, tempC: 25 }, PEAK_WC);
    const shaded = predict(model, { hourLocal: 8, poa: 800, tempC: 25 }, PEAK_WC);
    expect(shaded).toBeCloseTo(noon * 0.5, 0);
  });

  it("derates with heat, by the physical coefficient", () => {
    const cool = predict(model, { hourLocal: 13, poa: 800, tempC: 25 }, PEAK_WC);
    const hot = predict(model, { hourLocal: 13, poa: 800, tempC: 35 }, PEAK_WC);
    expect(hot).toBeLessThan(cool);
    expect(hot / cool).toBeCloseTo(1 + GAMMA_PER_C * 10, 3);
  });

  it("returns zero with no irradiance", () => {
    expect(predict(model, { hourLocal: 2, poa: 0, tempC: 12 }, PEAK_WC)).toBe(0);
  });

  it("never exceeds the declared peak power", () => {
    expect(predict(model, { hourLocal: 13, poa: 100000, tempC: 25 }, PEAK_WC)).toBe(PEAK_WC);
  });

  it("treats an hour it never learned as unobstructed, not as dark", () => {
    // A winter dawn a summer window never saw must not read as "panels off".
    expect(predict(model, { hourLocal: 6, poa: 300, tempC: 5 }, PEAK_WC)).toBeGreaterThan(0);
  });

  it("survives a missing temperature by assuming the reference", () => {
    const value = predict(model, { hourLocal: 13, poa: 800, tempC: Number.NaN }, PEAK_WC);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeCloseTo(2.5 * 800, 0);
  });
});

describe("refitGainOnly", () => {
  const before = fitModel(synthetic({ gain: 2.5, shape: { 8: 0.5, 18: 0.6 } }), PEAK_WC, AT)!;

  it("moves the gain and leaves the shape identical", () => {
    // A +40 % array, the measured shape of the reference site's +1 kW addition.
    const after = refitGainOnly(
      before,
      synthetic({ gain: 3.5, shape: { 8: 0.5, 18: 0.6 } }),
      PEAK_WC * 1.4,
      AT,
    );
    expect(after.gain / before.gain).toBeCloseTo(1.4, 2);
    expect(after.shape).toEqual(before.shape);
  });

  it("handles a downward change the same way", () => {
    const after = refitGainOnly(
      before,
      synthetic({ gain: 1.25, shape: { 8: 0.5, 18: 0.6 } }),
      PEAK_WC,
      AT,
    );
    expect(after.gain / before.gain).toBeCloseTo(0.5, 2);
  });

  it("keeps the old gain below the sample floor rather than taking a noisy one", () => {
    expect(refitGainOnly(before, [], PEAK_WC, AT)).toEqual(before);
  });

  it("keeps the old gain when nothing usable comes back", () => {
    const dark: PvSample[] = Array.from({ length: 50 }, () => ({
      hourLocal: 2,
      poa: 0,
      tempC: 5,
      watts: 0,
    }));
    expect(refitGainOnly(before, dark, PEAK_WC, AT).gain).toBe(before.gain);
  });

  it("ignores samples from an hour the shape does not cover", () => {
    const unknownHour: PvSample[] = Array.from({ length: 50 }, () => ({
      hourLocal: 3,
      poa: 500,
      tempC: 20,
      watts: 9999,
    }));
    expect(refitGainOnly(before, unknownHour, PEAK_WC, AT).gain).toBe(before.gain);
  });
});

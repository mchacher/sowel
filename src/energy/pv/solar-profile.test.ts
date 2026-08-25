import { describe, expect, it } from "vitest";
import { CARDINAL_AZIMUTHS, isActiveSolarProfile, validateSolarProfile } from "./solar-profile.js";

const SOUTH = { tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 };

describe("validateSolarProfile", () => {
  it("accepts the reference installation", () => {
    expect(validateSolarProfile({ planes: [SOUTH] })).toEqual([]);
  });

  it("accepts an east/west roof", () => {
    expect(
      validateSolarProfile({
        planes: [
          { tiltDeg: 30, azimuthDeg: 90, peakWc: 2000 },
          { tiltDeg: 30, azimuthDeg: 270, peakWc: 2000 },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts a flat array and a vertical one", () => {
    expect(validateSolarProfile({ planes: [{ ...SOUTH, tiltDeg: 0 }] })).toEqual([]);
    expect(validateSolarProfile({ planes: [{ ...SOUTH, tiltDeg: 90 }] })).toEqual([]);
  });

  it("accepts a north-facing array, which is unusual but real", () => {
    expect(validateSolarProfile({ planes: [{ ...SOUTH, azimuthDeg: 0 }] })).toEqual([]);
  });

  it("refuses a tilt outside 0 to 90, naming the field", () => {
    const errors = validateSolarProfile({ planes: [{ ...SOUTH, tiltDeg: 91 }] });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("tiltDeg");
    expect(errors[0].plane).toBe(0);
    expect(validateSolarProfile({ planes: [{ ...SOUTH, tiltDeg: -1 }] })[0].field).toBe("tiltDeg");
  });

  it("refuses an azimuth outside 0 to 359", () => {
    expect(validateSolarProfile({ planes: [{ ...SOUTH, azimuthDeg: 361 }] })[0].field).toBe(
      "azimuthDeg",
    );
    // 360 is refused rather than folded to 0, so a typo is seen, not guessed at.
    expect(validateSolarProfile({ planes: [{ ...SOUTH, azimuthDeg: 360 }] })[0].field).toBe(
      "azimuthDeg",
    );
  });

  it("refuses a peak power at or below zero", () => {
    expect(validateSolarProfile({ planes: [{ ...SOUTH, peakWc: 0 }] })[0].field).toBe("peakWc");
    expect(validateSolarProfile({ planes: [{ ...SOUTH, peakWc: -100 }] })[0].field).toBe("peakWc");
  });

  it("refuses a non-finite value rather than letting NaN reach the model", () => {
    expect(validateSolarProfile({ planes: [{ ...SOUTH, tiltDeg: Number.NaN }] })[0].field).toBe(
      "tiltDeg",
    );
  });

  it("reports every offending plane, with its index", () => {
    const errors = validateSolarProfile({
      planes: [SOUTH, { tiltDeg: 200, azimuthDeg: 999, peakWc: 0 }],
    });
    expect(errors).toHaveLength(3);
    expect(new Set(errors.map((e) => e.plane))).toEqual(new Set([1]));
  });

  it("treats an empty plane list as valid, since that is how the feature is turned off", () => {
    expect(validateSolarProfile({ planes: [] })).toEqual([]);
  });

  it("refuses a planes field that is not a list", () => {
    const errors = validateSolarProfile({ planes: null as never });
    expect(errors[0].field).toBe("planes");
  });
});

describe("isActiveSolarProfile", () => {
  it("is true for a valid profile with at least one plane", () => {
    expect(isActiveSolarProfile({ planes: [SOUTH] })).toBe(true);
  });

  it("is false for undefined, an empty list, or an invalid plane", () => {
    expect(isActiveSolarProfile(undefined)).toBe(false);
    expect(isActiveSolarProfile({ planes: [] })).toBe(false);
    expect(isActiveSolarProfile({ planes: [{ ...SOUTH, peakWc: 0 }] })).toBe(false);
  });
});

describe("CARDINAL_AZIMUTHS", () => {
  it("offers all eight, not just the sunny ones", () => {
    expect(Object.keys(CARDINAL_AZIMUTHS)).toHaveLength(8);
  });

  it("puts north at 0 and south at 180", () => {
    expect(CARDINAL_AZIMUTHS.N).toBe(0);
    expect(CARDINAL_AZIMUTHS.S).toBe(180);
    expect(CARDINAL_AZIMUTHS.E).toBe(90);
    expect(CARDINAL_AZIMUTHS.W).toBe(270);
  });

  it("only offers bearings the validator accepts", () => {
    for (const azimuthDeg of Object.values(CARDINAL_AZIMUTHS)) {
      expect(validateSolarProfile({ planes: [{ ...SOUTH, azimuthDeg }] })).toEqual([]);
    }
  });
});

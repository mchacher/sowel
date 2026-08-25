import { describe, expect, it } from "vitest";
import type { SolarPlane } from "../../shared/types.js";
import {
  MIN_ELEVATION_RAD,
  planeOfArray,
  solarPosition,
  toDni,
  totalPeakWc,
} from "./solar-geometry.js";

const GRENOBLE = { lat: 45.175508, lon: 5.805943 };
const deg = (rad: number): number => (rad * 180) / Math.PI;

/** The reference installation: coplanar, due south, 35 degrees. */
const SOUTH: SolarPlane[] = [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }];

describe("solarPosition", () => {
  it("puts the sun due south and highest at solar noon in June", () => {
    // Solar noon at 5.8 E is about 11:37 UTC.
    const sun = solarPosition(new Date("2026-06-21T11:37:00Z"), GRENOBLE.lat, GRENOBLE.lon);
    expect(deg(sun.azimuthRad)).toBeGreaterThan(175);
    expect(deg(sun.azimuthRad)).toBeLessThan(185);
    // 90 - latitude + declination = about 68 degrees.
    expect(deg(sun.elevationRad)).toBeGreaterThan(66);
    expect(deg(sun.elevationRad)).toBeLessThan(70);
  });

  it("reports the compass convention, not suncalc's from-south one", () => {
    // The morning sun is east, i.e. an azimuth well under 180. Left unconverted,
    // suncalc would report a negative angle here.
    const morning = solarPosition(new Date("2026-06-21T06:00:00Z"), GRENOBLE.lat, GRENOBLE.lon);
    expect(deg(morning.azimuthRad)).toBeGreaterThan(0);
    expect(deg(morning.azimuthRad)).toBeLessThan(180);
  });

  it("moves the sun from east to west across the day", () => {
    const morning = solarPosition(new Date("2026-06-21T06:00:00Z"), GRENOBLE.lat, GRENOBLE.lon);
    const evening = solarPosition(new Date("2026-06-21T17:00:00Z"), GRENOBLE.lat, GRENOBLE.lon);
    expect(deg(morning.azimuthRad)).toBeLessThan(180);
    expect(deg(evening.azimuthRad)).toBeGreaterThan(180);
  });

  it("puts the sun below the horizon at midnight", () => {
    const night = solarPosition(new Date("2026-06-21T00:00:00Z"), GRENOBLE.lat, GRENOBLE.lon);
    expect(night.elevationRad).toBeLessThan(0);
  });
});

describe("toDni", () => {
  it("returns the horizontal value unchanged with the sun overhead", () => {
    expect(toDni(800, Math.PI / 2)).toBeCloseTo(800, 5);
  });

  it("doubles it with the sun at 30 degrees", () => {
    expect(toDni(400, Math.PI / 6)).toBeCloseTo(800, 5);
  });

  it("refuses to divide by a vanishing sine near the horizon", () => {
    // At 1 degree, 10 W/m2 horizontal would otherwise become 573 W/m2 of beam.
    expect(toDni(10, (1 * Math.PI) / 180)).toBe(0);
    expect(toDni(10, MIN_ELEVATION_RAD - 0.001)).toBe(0);
  });

  it("returns zero at night and for a non-positive reading", () => {
    expect(toDni(500, -0.5)).toBe(0);
    expect(toDni(0, Math.PI / 4)).toBe(0);
    expect(toDni(Number.NaN, Math.PI / 4)).toBe(0);
  });
});

describe("planeOfArray", () => {
  const noon = { elevationRad: (55 * Math.PI) / 180, azimuthRad: Math.PI };

  it("collects nearly the whole beam when the sun faces the plane", () => {
    const poa = planeOfArray(SOUTH, 800, 100, noon);
    expect(poa).toBeGreaterThan(800);
  });

  it("keeps only the diffuse share when the sun is behind the plane", () => {
    const northFacing: SolarPlane[] = [{ tiltDeg: 70, azimuthDeg: 0, peakWc: 1000 }];
    const poa = planeOfArray(northFacing, 800, 100, noon);
    const skyView = (1 + Math.cos((70 * Math.PI) / 180)) / 2;
    expect(poa).toBeCloseTo(100 * skyView, 5);
  });

  it("never lets a plane contribute a negative beam", () => {
    const northFacing: SolarPlane[] = [{ tiltDeg: 90, azimuthDeg: 0, peakWc: 1000 }];
    expect(planeOfArray(northFacing, 800, 0, noon)).toBe(0);
  });

  it("beats an averaged single plane on an east/west array at sunrise", () => {
    // This is the reason the profile is a list. Summed without per-plane
    // clipping, an east and a west plane cancel into something facing nowhere.
    const sunrise = { elevationRad: (10 * Math.PI) / 180, azimuthRad: (80 * Math.PI) / 180 };
    const eastWest: SolarPlane[] = [
      { tiltDeg: 30, azimuthDeg: 90, peakWc: 2000 },
      { tiltDeg: 30, azimuthDeg: 270, peakWc: 2000 },
    ];
    const averaged: SolarPlane[] = [{ tiltDeg: 30, azimuthDeg: 180, peakWc: 4000 }];

    expect(planeOfArray(eastWest, 600, 80, sunrise)).toBeGreaterThan(
      planeOfArray(averaged, 600, 80, sunrise),
    );
  });

  it("gives a flat plane the whole sky and a beam scaled by sin(elevation)", () => {
    const flat: SolarPlane[] = [{ tiltDeg: 0, azimuthDeg: 180, peakWc: 1000 }];
    const sun = { elevationRad: (30 * Math.PI) / 180, azimuthRad: Math.PI };
    // cos(theta) on a flat plane is sin(elevation) = 0.5, sky view factor 1.
    expect(planeOfArray(flat, 1000, 200, sun)).toBeCloseTo(1000 * 0.5 + 200, 5);
  });

  it("weights the planes by their share of the declared peak power", () => {
    const lopsided: SolarPlane[] = [
      { tiltDeg: 35, azimuthDeg: 180, peakWc: 3000 },
      { tiltDeg: 90, azimuthDeg: 0, peakWc: 1000 }, // contributes diffuse only
    ];
    const southOnly = planeOfArray(SOUTH, 800, 0, noon);
    expect(planeOfArray(lopsided, 800, 0, noon)).toBeCloseTo(southOnly * 0.75, 5);
  });

  it("returns zero on an empty plane list rather than dividing by zero", () => {
    expect(planeOfArray([], 800, 100, noon)).toBe(0);
  });

  it("treats a missing diffuse reading as zero, not as NaN", () => {
    const poa = planeOfArray(SOUTH, 800, Number.NaN, noon);
    expect(Number.isFinite(poa)).toBe(true);
    expect(poa).toBeGreaterThan(0);
  });

  it("returns zero at night, when the beam is already zero", () => {
    expect(planeOfArray(SOUTH, 0, 0, { elevationRad: -0.3, azimuthRad: 0 })).toBe(0);
  });
});

describe("totalPeakWc", () => {
  it("sums the planes", () => {
    expect(totalPeakWc([{ tiltDeg: 30, azimuthDeg: 90, peakWc: 2000 }, ...SOUTH])).toBe(6000);
  });

  it("is zero for an empty list", () => {
    expect(totalPeakWc([])).toBe(0);
  });

  it("ignores a non-finite peak rather than propagating NaN", () => {
    expect(totalPeakWc([{ tiltDeg: 30, azimuthDeg: 180, peakWc: Number.NaN }])).toBe(0);
  });
});

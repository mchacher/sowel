import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  RIBBON_MAX,
  RIBBON_MIN,
  WAVE_PERIOD,
  headSize,
  ribbonWidth,
  waveDashes,
  waveSpeed,
} from "./flow-geometry";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

// Spec 197 (FR-E4.1) — the ribbon's width follows the power continuously,
// within a floor and a ceiling.
describe("ribbonWidth", () => {
  it.each([
    [0, 2.5],
    [200, 3.5],
    [1000, 7.5],
    [2000, 12.5],
    [4000, 15.5],
    [8000, 18],
    [50_000, 18],
  ])("draws %s W at %s px", (w, px) => {
    expect(ribbonWidth(w)).toBeCloseTo(px);
  });

  it("is continuous at 2 kW and never decreases", () => {
    expect(ribbonWidth(1999.9)).toBeCloseTo(ribbonWidth(2000.1), 2);
    let prev = 0;
    for (let w = 0; w <= 12_000; w += 250) {
      expect(ribbonWidth(w)).toBeGreaterThanOrEqual(prev);
      prev = ribbonWidth(w);
    }
  });

  it("stays between its floor and ceiling, sign and missing reading included", () => {
    expect(ribbonWidth(undefined)).toBe(RIBBON_MIN);
    expect(ribbonWidth(-4900)).toBe(ribbonWidth(4900));
    expect(ribbonWidth(1e9)).toBe(RIBBON_MAX);
  });

  it("narrows by a fifth in a narrow diagram, never under the floor", () => {
    expect(ribbonWidth(2000, true)).toBeCloseTo(10);
    expect(ribbonWidth(0, true)).toBe(RIBBON_MIN);
    expect(ribbonWidth(1e9, true)).toBeCloseTo(RIBBON_MAX * 0.8);
  });
});

describe("waveSpeed, waveDashes, headSize", () => {
  it("speeds the wave up with the power, from 18 px/s, flat past 8 kW", () => {
    expect(waveSpeed(0)).toBe(18);
    expect(waveSpeed(3000)).toBeCloseTo(88);
    expect(waveSpeed(20_000)).toBe(waveSpeed(8000));
    expect(waveSpeed(4900)).toBeGreaterThan(waveSpeed(180));
  });

  it("stacks three dashes, longest and faintest first, all shorter than the period", () => {
    const d = waveDashes(RIBBON_MAX);
    expect(d.map((x) => x.opacity)).toEqual([0.3, 0.55, 1]);
    expect(d[0].length).toBeGreaterThan(d[1].length);
    expect(d[1].length).toBeGreaterThan(d[2].length);
    expect(d[0].length).toBeLessThan(WAVE_PERIOD);
  });

  it("sizes the head on the ribbon, always wider than it", () => {
    for (const w of [RIBBON_MIN, 12.5, RIBBON_MAX]) {
      expect(headSize(w).base).toBeGreaterThan(w);
    }
    expect(headSize(10)).toEqual({ base: 20, length: 12.5 });
  });
});

describe("ribbon CSS (spec 197, FR-E4.2 and E4.4)", () => {
  it("hides the wave and tints the band more under reduced motion", () => {
    expect(indexCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.flow-wave\s*\{\s*display: none;/,
    );
    expect(indexCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\{\s*--flow-tint: 72%;/,
    );
  });

  it("moves the wave by exactly one period per cycle", () => {
    expect(indexCss).toMatch(
      new RegExp(`stroke-dashoffset: calc\\(var\\(--o0, 0px\\) - ${WAVE_PERIOD}px\\)`),
    );
  });

  it("falls back to an opacity where color-mix is missing (Safari before 16.2)", () => {
    expect(indexCss).toMatch(
      /\.flow-band \{\s*stroke: var\(--flow-c\);\s*stroke-opacity: var\(--flow-tint-alpha\);/,
    );
    expect(indexCss).toMatch(/@supports \(color: color-mix\(in srgb, red 50%, blue\)\)/);
  });

  it("gives the halo a strength in dark only", () => {
    expect(indexCss).toMatch(
      /:root \{\s*--flow-tint: 36%;\s*--flow-tint-alpha: 0\.36;\s*--flow-halo: 0;/,
    );
    expect(indexCss).toMatch(/--flow-halo: 0\.16;/);
  });
});

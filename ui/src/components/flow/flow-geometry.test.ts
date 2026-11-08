import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  RIBBON_WIDTH,
  WAVE_BASE_SPEED,
  WAVE_PERIOD,
  headSize,
  waveDashes,
  waveRate,
  waveSpeed,
} from "./flow-geometry";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

// Spec 197 (FR-E4.1, amended) — one ribbon width for every route: the
// magnitude is told by the wave's speed and the share bars.
describe("RIBBON_WIDTH", () => {
  it("is one width, a little narrower in a narrow diagram", () => {
    expect(RIBBON_WIDTH.wide).toBe(6);
    expect(RIBBON_WIDTH.narrow).toBe(5);
  });
});

describe("waveSpeed, waveDashes, headSize", () => {
  it("speeds the wave up with the power, from 18 px/s, flat past 8 kW", () => {
    expect(waveSpeed(0)).toBe(18);
    expect(waveSpeed(3000)).toBeCloseTo(88);
    expect(waveSpeed(20_000)).toBe(waveSpeed(8000));
    expect(waveSpeed(4900)).toBeGreaterThan(waveSpeed(180));
  });

  it("turns the speed into a playback rate against the 18 px/s CSS cycle", () => {
    expect(waveRate(0)).toBe(1);
    expect(waveRate(3000)).toBeCloseTo(88 / 18, 2);
  });

  it("stacks three dashes, longest and faintest first, all shorter than the period", () => {
    const d = waveDashes(RIBBON_WIDTH.wide);
    expect(d.map((x) => x.opacity)).toEqual([0.3, 0.55, 1]);
    expect(d[0].length).toBeGreaterThan(d[1].length);
    expect(d[1].length).toBeGreaterThan(d[2].length);
    expect(d[0].length).toBeLessThan(WAVE_PERIOD);
  });

  it("sizes the head on the ribbon, always wider than it", () => {
    for (const w of [RIBBON_WIDTH.narrow, RIBBON_WIDTH.wide]) {
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
    expect(indexCss).toMatch(new RegExp(`to \\{\\s*stroke-dashoffset: -${WAVE_PERIOD}px;\\s*\\}`));
    // At rate 1 the cycle runs at the base speed; no custom property in the keyframes.
    expect(indexCss).toMatch(
      new RegExp(`animation-duration: ${(WAVE_PERIOD / WAVE_BASE_SPEED).toFixed(3)}s`),
    );
    expect(indexCss).not.toMatch(/--o0/);
  });

  it("keeps an opacity guard under the color-mix band", () => {
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

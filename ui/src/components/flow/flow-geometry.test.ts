import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { FLOW_DOT_PERIOD, FLOW_TIER_STYLE, flowDotSeconds, flowTier } from "./flow-geometry";

const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

// Spec 197 (FR-E4) — the tiers that give a route its width and its speed.
describe("flowTier", () => {
  it.each([
    [0, 1],
    [499, 1],
    [500, 2],
    [1999, 2],
    [2000, 3],
    [-2500, 3],
    [undefined, 1],
  ])("puts %s W in tier %s", (w, tier) => {
    expect(flowTier(w)).toBe(tier);
  });

  it("widens and speeds up with each tier", () => {
    expect(FLOW_TIER_STYLE[1].width).toBeLessThan(FLOW_TIER_STYLE[2].width);
    expect(FLOW_TIER_STYLE[2].width).toBeLessThan(FLOW_TIER_STYLE[3].width);
    expect(flowDotSeconds(3)).toBeLessThan(flowDotSeconds(2));
    expect(flowDotSeconds(2)).toBeLessThan(flowDotSeconds(1));
  });

  it("draws each dot wider than its route, so it reads on top of it", () => {
    for (const t of [1, 2, 3] as const) {
      expect(FLOW_TIER_STYLE[t].dot).toBeGreaterThan(FLOW_TIER_STYLE[t].width);
    }
  });
});

describe("flow dots in CSS (spec 197, FR-E4.2 and E4.4)", () => {
  it("stops the dots under reduced motion", () => {
    expect(indexCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.flow-dash\s*\{\s*animation: none;/,
    );
    // And the keyframes move the dashes by exactly one period.
    expect(indexCss).toMatch(new RegExp(`stroke-dashoffset: -${FLOW_DOT_PERIOD};`));
  });
});

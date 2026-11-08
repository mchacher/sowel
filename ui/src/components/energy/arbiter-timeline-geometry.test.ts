import { describe, it, expect } from "vitest";
import {
  MIN_HALF_SHARE,
  legendStates,
  liveLabelTop,
  mergeRuns,
  sampleInColumn,
  surplusScale,
} from "./arbiter-timeline-geometry";

// Spec 197 (FR-E5) — the history's geometry, without React.

const H = 100;
const PAD = 2;
const INNER = H - 2 * PAD;

describe("surplusScale (FR-E5.1)", () => {
  it("places zero from the peaks, with one W/px on both sides", () => {
    const s = surplusScale([300, -4800, 0], null, H);
    // 300 / 5100 of the height is under 15 %: the floor applies.
    expect(s.y0).toBeCloseTo(PAD + INNER * MIN_HALF_SHARE);
    // Equal watts, equal heights, either side of zero.
    expect(s.y0 - s.yOf(1000)).toBeCloseTo(s.yOf(-1000) - s.y0);
    // The deficit peak reaches the bottom; the surplus half stands for more
    // than its 300 W peak because of the floor.
    expect(s.yOf(-4800)).toBeCloseTo(H - PAD);
    expect(s.bottomW).toBeCloseTo(4800);
    expect(s.topW).toBeGreaterThan(300);
  });

  it("splits the height in proportion when both halves are large enough", () => {
    const s = surplusScale([3000, -1000], null, H);
    expect(s.y0).toBeCloseTo(PAD + INNER * 0.75);
    expect(s.topW).toBeCloseTo(3000);
    expect(s.bottomW).toBeCloseTo(1000);
  });

  it("keeps an absent half at 15 %, with its own extent (only deficit)", () => {
    const s = surplusScale([-2000, -500], null, H);
    expect(s.y0).toBeCloseTo(PAD + INNER * MIN_HALF_SHARE);
    expect(s.bottomW).toBeCloseTo(2000);
    expect(s.topW).toBeCloseTo((2000 * 0.15) / 0.85);
  });

  it("keeps an absent half at 15 % (only surplus)", () => {
    const s = surplusScale([1500], null, H);
    expect(s.y0).toBeCloseTo(PAD + INNER * (1 - MIN_HALF_SHARE));
    expect(s.topW).toBeCloseTo(1500);
  });

  it("includes the live reading in the peaks", () => {
    const s = surplusScale([-900, -1000], -4800, H);
    expect(s.bottomW).toBeCloseTo(4800);
    expect(s.yOf(-4800)).toBeCloseTo(H - PAD);
  });

  it("does not stretch a few watts to the full height", () => {
    const s = surplusScale([20, -10], null, H);
    expect(s.topW + s.bottomW).toBeCloseTo(500);
  });
});

describe("mergeRuns (FR-E5.5)", () => {
  it("merges equal neighbours and keeps alternations apart", () => {
    expect(mergeRuns(["idle", "idle", "granted", "pending", "pending", "idle"])).toEqual([
      { state: "idle", start: 0, end: 2 },
      { state: "granted", start: 2, end: 3 },
      { state: "pending", start: 3, end: 5 },
      { state: "idle", start: 5, end: 6 },
    ]);
  });

  it("makes one run of a single-state lane", () => {
    expect(mergeRuns(new Array(24).fill("idle"))).toEqual([{ state: "idle", start: 0, end: 24 }]);
  });

  it("makes no run of an empty lane", () => {
    expect(mergeRuns([])).toEqual([]);
  });
});

describe("legendStates (FR-E5.6)", () => {
  it("lists the present states in reading order, always with « at rest »", () => {
    expect(
      legendStates([{ quarters: ["pending", "granted"] }, { quarters: ["suspended"] }]),
    ).toEqual(["granted", "pending", "suspended", "idle"]);
    expect(legendStates([])).toEqual(["idle"]);
  });
});

describe("sampleInColumn (FR-E5.3)", () => {
  const samples = [
    { at: 0, w: 100 },
    { at: 5, w: -200 },
    { at: 15, w: 300 },
  ];
  it("takes the last sample of the column, or none", () => {
    expect(sampleInColumn(samples, 0, 15)).toBe(-200);
    expect(sampleInColumn(samples, 15, 30)).toBe(300);
    expect(sampleInColumn(samples, 30, 45)).toBeNull();
  });
});

describe("liveLabelTop — the live value keeps off the curve", () => {
  it("sits above the dot when the curve comes from below, below otherwise", () => {
    expect(liveLabelTop(50, true, 120)).toBe(30); // 50 − 8 − 12
    expect(liveLabelTop(50, false, 120)).toBe(58); // 50 + 8
  });

  it("flips when its side has no room, and stays inside the plot", () => {
    expect(liveLabelTop(10, true, 120)).toBe(18); // no room above: below
    expect(liveLabelTop(115, false, 120)).toBe(95); // no room below: above
    expect(liveLabelTop(5, false, 14)).toBeLessThanOrEqual(2);
  });
});

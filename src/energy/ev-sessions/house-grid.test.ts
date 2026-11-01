import { describe, expect, it } from "vitest";
import { HouseGridLedger } from "./house-grid.js";

const T0 = Date.UTC(2026, 10, 1, 19, 0, 0); // a window boundary
const MIN = 60_000;
const W = 5 * MIN;

/** One delta a minute, at :01, of `wh` each, from `fromMin` to `toMin`. */
function steady(g: HouseGridLedger, fromMin: number, toMin: number, wh: (m: number) => number) {
  for (let m = fromMin; m <= toMin; m++) g.tick(T0 + m * MIN + 1000, wh(m));
}

describe("HouseGridLedger (audit A1)", () => {
  it("puts a delta in the time it measured, not the window it arrives in", () => {
    const g = new HouseGridLedger();
    // Each delta covers the minute before it, arriving one second late.
    steady(g, 0, 6, (m) => (m === 5 ? 120 : 100));
    // The window holds 1 s of the 19:00:01 delta, the 19:01–19:04 ones whole,
    // and 59 s of the 19:05:01 one (it measured 19:04:01–19:05:01).
    expect(g.importBetween(T0, T0 + W)).toBeCloseTo(100 / 60 + 4 * 100 + (120 * 59) / 60, 6);
    expect(g.coveredUntilMs).toBe(T0 + 6 * MIN + 1000);
  });

  it("reads the import of part of a window", () => {
    const g = new HouseGridLedger();
    for (let m = 1; m <= 5; m++) g.tick(T0 + m * MIN, m <= 3 ? 100 : 20);
    expect(g.importBetween(T0 + 3 * MIN, T0 + W)).toBeCloseTo(40, 6);
  });

  it("counts exports as nothing and a first delta as one minute", () => {
    const g = new HouseGridLedger();
    g.tick(T0 + 2 * MIN, -50);
    g.tick(T0 + 3 * MIN, 60);
    expect(g.importBetween(T0 + MIN, T0 + 3 * MIN)).toBeCloseTo(60, 6);
  });

  it("says nothing for a span the deltas did not cover (a meter silence)", () => {
    const g = new HouseGridLedger();
    g.tick(T0 + MIN, 10);
    g.tick(T0 + 20 * MIN, 30); // after 19 min: covers its last minute only
    expect(g.importBetween(T0 + 19 * MIN, T0 + 20 * MIN)).toBeCloseTo(30, 6);
    expect(g.importBetween(T0 + 15 * MIN, T0 + 20 * MIN)).toBeNull();
    expect(g.importBetween(T0 + W, T0 + 2 * W)).toBeNull();
  });

  it("forgets the import before a time", () => {
    const g = new HouseGridLedger();
    steady(g, 0, 6, () => 10);
    g.prune(T0 + W);
    expect(g.importBetween(T0, T0 + MIN)).toBeNull();
    expect(g.size).toBeLessThanOrEqual(3);
  });
});

import { describe, expect, it } from "vitest";
import { HouseGridLedger } from "./house-grid.js";

const T0 = Date.UTC(2026, 10, 1, 19, 0, 0); // a window boundary
const MIN = 60_000;
const W = 5 * MIN;

describe("HouseGridLedger (audit A1)", () => {
  it("puts a delta in the time it measured, not the window it arrives in", () => {
    const g = new HouseGridLedger();
    g.tick(T0 + 4 * MIN + 1000, 100); // covers 19:03:01 – 19:04:01
    g.tick(T0 + 5 * MIN + 1000, 120); // covers 19:04:01 – 19:05:01: mostly the first window
    expect(g.importBetween(T0, T0 + W)).toBeCloseTo(100 + (120 * 59) / 60, 6);
    expect(g.importBetween(T0 + W, T0 + 2 * W)).toBeCloseTo(120 / 60, 6);
    expect(g.coveredUntilMs).toBe(T0 + 5 * MIN + 1000);
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
    expect(g.importBetween(T0, T0 + W)).toBeCloseTo(60, 6);
  });

  it("does not stretch a delta over a long silence", () => {
    const g = new HouseGridLedger();
    g.tick(T0 + MIN, 10);
    g.tick(T0 + 20 * MIN, 30); // after 19 min: covers its last minute only
    expect(g.importBetween(T0 + 3 * W, T0 + 4 * W)).toBeCloseTo(30, 6);
    expect(g.importBetween(T0 + W, T0 + 2 * W)).toBeNull();
  });

  it("forgets the import before a time", () => {
    const g = new HouseGridLedger();
    g.tick(T0 + MIN, 10);
    g.tick(T0 + 6 * MIN, 10);
    g.prune(T0 + W);
    expect(g.importBetween(T0, T0 + W)).toBeNull();
  });
});

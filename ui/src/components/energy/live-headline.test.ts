import { describe, it, expect } from "vitest";
import { liveHeadline } from "./live-headline";

// Spec 197 (FR-E1) — the balance line of the Live flow card.
describe("liveHeadline", () => {
  it("reads an import: the grid's watts, and the sun's share of the consumption", () => {
    // The review's morning: 4.9 kW from the grid, 180 W of sun, 5 kW drawn.
    const h = liveHeadline({ gridW: 4900, solarW: 180 });
    expect(h.kind).toBe("import");
    expect(h.valueW).toBe(4900);
    expect(h.consumptionW).toBe(5080);
    expect(h.solarPct).toBe(4);
  });

  it("reads an export: the exported watts, unsigned", () => {
    const h = liveHeadline({ gridW: -1200, solarW: 2000 });
    expect(h.kind).toBe("export");
    expect(h.valueW).toBe(1200);
    expect(h.consumptionW).toBe(800);
  });

  it("reads a grid within 5 W as self-powered while the sun produces", () => {
    const h = liveHeadline({ gridW: 3, solarW: 900 });
    expect(h.kind).toBe("self");
    expect(h.valueW).toBe(903);
    expect(h.solarPct).toBe(100);
    expect(liveHeadline({ gridW: -4, solarW: 900 }).kind).toBe("self");
  });

  it("never calls a house at rest in the dark self-powered", () => {
    expect(liveHeadline({ gridW: 0, solarW: 0 }).kind).toBe("import");
  });

  it("has no solar share when nothing is produced, for « Pas de production solaire »", () => {
    const h = liveHeadline({ gridW: 1500, solarW: 0 });
    expect(h.kind).toBe("import");
    expect(h.solarPct).toBeNull();
  });

  it("falls back to the consumption alone without a grid source", () => {
    const h = liveHeadline({ gridW: null, solarW: 600 });
    expect(h.kind).toBe("consumption-only");
    expect(h.valueW).toBe(600);
    expect(h.solarPct).toBeNull();
  });

  it("falls back to the consumption alone without a production source", () => {
    const h = liveHeadline({ gridW: 1200, solarW: null });
    expect(h.kind).toBe("consumption-only");
    expect(h.valueW).toBe(1200);
  });

  it("carries the stale source and its age, and keeps the figure", () => {
    const since = "2026-11-08T07:40:00.000Z";
    const h = liveHeadline({ gridW: 4900, solarW: 180, stale: { source: "grid", since } });
    expect(h.stale).toEqual({ source: "grid", since });
    expect(h.valueW).toBe(4900);
    expect(liveHeadline({ gridW: 4900, solarW: 180 }).stale).toBeNull();
  });
});

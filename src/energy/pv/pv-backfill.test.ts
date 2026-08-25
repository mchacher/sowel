import { describe, expect, it } from "vitest";
import type { SolarPlane } from "../../shared/types.js";
import { pairHistory, profilePeakWc, resolveWindow, type HistoryHour } from "./pv-backfill.js";

const GRENOBLE = { latitude: 45.175508, longitude: 5.805943 };
const SOUTH: SolarPlane[] = [{ tiltDeg: 35, azimuthDeg: 180, peakWc: 4000 }];
const DAY = 86_400_000;

/** A fixed instant, so nothing here depends on when the suite runs. */
const NOW = Date.parse("2026-08-25T12:00:00Z");

describe("resolveWindow", () => {
  it("reaches back exactly the rolling window when nothing is declared", () => {
    const w = resolveWindow(undefined, 45, NOW);
    expect(w.fromMs).toBe(NOW - 45 * DAY);
    expect(w.toMs).toBe(NOW);
    expect(w.boundedBy).toBe("window");
  });

  it("stops at a declared date inside the window", () => {
    const since = new Date(NOW - 9 * DAY).toISOString();
    const w = resolveWindow(since, 45, NOW);
    expect(w.fromMs).toBe(Date.parse(since));
    expect(w.boundedBy).toBe("declaration");
  });

  it("ignores a declared date older than the window", () => {
    // Reaching further back is what the seasonal drift measurement rules out.
    const w = resolveWindow(new Date(NOW - 90 * DAY).toISOString(), 45, NOW);
    expect(w.fromMs).toBe(NOW - 45 * DAY);
    expect(w.boundedBy).toBe("window");
  });

  it("ignores a date in the future rather than producing an empty window", () => {
    const w = resolveWindow(new Date(NOW + 5 * DAY).toISOString(), 45, NOW);
    expect(w.fromMs).toBe(NOW - 45 * DAY);
    expect(w.boundedBy).toBe("window");
  });

  it("ignores an unparseable date", () => {
    // It comes from a text field; the safe reading of nonsense is "no extra
    // information", never "trust it and fit across a capacity change".
    for (const bad of ["", "hier", "2026-13-45", "null"]) {
      expect(resolveWindow(bad, 45, NOW).boundedBy).toBe("window");
    }
  });

  it("accepts a bare date, which is what the form produces", () => {
    const w = resolveWindow("2026-08-20", 45, NOW);
    expect(w.boundedBy).toBe("declaration");
    expect(w.fromMs).toBe(Date.parse("2026-08-20"));
  });
});

/** Midday hours over `days` days ending just before NOW, with real irradiance. */
function build(days: number): { production: Map<number, number>; hours: HistoryHour[] } {
  const production = new Map<number, number>();
  const hours: HistoryHour[] = [];
  for (let d = 1; d <= days; d++) {
    for (const h of [9, 10, 11, 12, 13, 14]) {
      const ms = Date.parse(
        `2026-08-${String(25 - d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`,
      );
      production.set(ms, 2500);
      hours.push({ t: new Date(ms).toISOString(), direct: 600, diffuse: 120, temp: 24 });
    }
  }
  return { production, hours };
}

const base = {
  planes: SOUTH,
  ...GRENOBLE,
  peakWc: 4000,
  window: resolveWindow(undefined, 45, NOW),
};

describe("pairHistory", () => {
  it("pairs an hour that has both sides", () => {
    const { production, hours } = build(1);
    const out = pairHistory({ ...base, production, hours });
    expect(out).toHaveLength(6);
    expect(out[0].watts).toBe(2500);
    expect(out[0].poa).toBeGreaterThan(0);
  });

  it("drops a production hour with no irradiance rather than zeroing it", () => {
    const { production, hours } = build(1);
    const orphan = Date.parse("2026-08-24T15:00:00Z");
    production.set(orphan, 1800);
    const out = pairHistory({ ...base, production, hours });
    // Zeroing would teach the array to expect nothing at 15 h.
    expect(out.some((s) => s.at === new Date(orphan).toISOString())).toBe(false);
    expect(out).toHaveLength(6);
  });

  it("drops an hour whose irradiance is null", () => {
    const { production, hours } = build(1);
    hours[0] = { ...hours[0], direct: null };
    expect(pairHistory({ ...base, production, hours })).toHaveLength(5);
  });

  it("drops night hours, where the plane sees nothing", () => {
    const production = new Map([[Date.parse("2026-08-24T01:00:00Z"), 0]]);
    const hours: HistoryHour[] = [{ t: "2026-08-24T01:00:00Z", direct: 0, diffuse: 0, temp: 14 }];
    expect(pairHistory({ ...base, production, hours })).toHaveLength(0);
  });

  it("excludes a reading above the impossible ceiling", () => {
    const { production, hours } = build(1);
    const spike = Date.parse("2026-08-24T12:00:00Z");
    production.set(spike, 31_000); // both channels of one micro-inverter at once
    const out = pairHistory({ ...base, production, hours });
    expect(out.some((s) => s.watts === 31_000)).toBe(false);
  });

  it("keeps a reading just under the ceiling", () => {
    const { production, hours } = build(1);
    production.set(Date.parse("2026-08-24T12:00:00Z"), 4000 * 1.29);
    expect(pairHistory({ ...base, production, hours }).some((s) => s.watts > 4000)).toBe(true);
  });

  it("honours the window on both ends", () => {
    const { production, hours } = build(1);
    const old = Date.parse("2026-06-01T12:00:00Z");
    production.set(old, 2500);
    hours.push({ t: new Date(old).toISOString(), direct: 600, diffuse: 120, temp: 24 });
    const out = pairHistory({ ...base, production, hours });
    expect(out.some((s) => s.at === new Date(old).toISOString())).toBe(false);
  });

  it("stops at a declared date, which is the point of the feature", () => {
    const { production, hours } = build(6);
    const since = "2026-08-22T00:00:00Z";
    const out = pairHistory({
      ...base,
      production,
      hours,
      window: resolveWindow(since, 45, NOW),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.at >= since)).toBe(true);
  });

  it("returns nothing when no array is declared", () => {
    const { production, hours } = build(1);
    expect(pairHistory({ ...base, planes: [], production, hours })).toHaveLength(0);
  });

  it("returns nothing without home coordinates, instead of a nonsense sun", () => {
    const { production, hours } = build(1);
    expect(pairHistory({ ...base, latitude: Number.NaN, production, hours })).toHaveLength(0);
  });

  it("falls back to 25 C when the temperature is missing", () => {
    const { production, hours } = build(1);
    const out = pairHistory({
      ...base,
      production,
      hours: hours.map((h) => ({ ...h, temp: null })),
    });
    expect(out[0].tempC).toBe(25);
  });

  it("aligns a mid-hour production timestamp onto the hour", () => {
    // Influx stamps at the window start, but nothing guarantees a caller does.
    const ms = Date.parse("2026-08-24T12:37:00Z");
    const production = new Map([[ms, 2500]]);
    const hours: HistoryHour[] = [
      { t: "2026-08-24T12:00:00Z", direct: 600, diffuse: 120, temp: 24 },
    ];
    const out = pairHistory({ ...base, production, hours });
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe("2026-08-24T12:00:00.000Z");
  });

  it("returns the samples in chronological order", () => {
    const { production, hours } = build(3);
    const out = pairHistory({ ...base, production, hours });
    const ats = out.map((s) => s.at);
    expect([...ats].sort()).toEqual(ats);
  });

  it("labels hour_local from the hour start, as the live path does", () => {
    const ms = Date.parse("2026-08-24T12:00:00Z");
    const out = pairHistory({
      ...base,
      production: new Map([[ms, 2500]]),
      hours: [{ t: "2026-08-24T12:00:00Z", direct: 600, diffuse: 120, temp: 24 }],
    });
    expect(out[0].hourLocal).toBe(new Date(ms).getHours());
  });
});

describe("profilePeakWc", () => {
  it("sums the declared planes", () => {
    expect(
      profilePeakWc({ planes: [...SOUTH, { tiltDeg: 30, azimuthDeg: 90, peakWc: 1000 }] }),
    ).toBe(5000);
  });

  it("is zero for an absent or empty profile", () => {
    expect(profilePeakWc(null)).toBe(0);
    expect(profilePeakWc(undefined)).toBe(0);
    expect(profilePeakWc({ planes: [] })).toBe(0);
  });

  it("ignores a non-finite peak rather than propagating NaN", () => {
    expect(profilePeakWc({ planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: Number.NaN }] })).toBe(
      0,
    );
  });
});

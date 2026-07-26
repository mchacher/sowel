import { describe, it, expect } from "vitest";
import { aggregateToBuckets, formatLabel, pickTickInterval } from "./chart-utils";

describe("pickTickInterval", () => {
  describe("without a range (viewport-only cap)", () => {
    it("returns 0 when count fits the desktop budget (≤12)", () => {
      expect(pickTickInterval(7, 1024)).toBe(0);
      expect(pickTickInterval(12, 1024)).toBe(0);
    });

    it("returns 0 when count fits the small-mobile budget (≤6 at <360px)", () => {
      expect(pickTickInterval(6, 320)).toBe(0);
    });

    it("returns 0 when count fits the medium-mobile budget (≤8 at <640px)", () => {
      expect(pickTickInterval(8, 400)).toBe(0);
    });

    it("uses ceil() so visible count actually stays ≤ maxLabels (regression: floor leaks ticks)", () => {
      // 19 points / 12 maxLabels — floor would give 0 (all ticks shown).
      // ceil(19/12)=2 → interval 1 → ~10 visible. Bug seen in spec 114 v1.
      expect(pickTickInterval(19, 1024)).toBe(1);
    });

    it("skips ticks on desktop when count exceeds 12", () => {
      // ceil(30/12)=3 → interval 2 (=> 1 visible / 3 → ~10 shown)
      expect(pickTickInterval(30, 1024)).toBe(2);
    });

    it("skips more aggressively on small mobile", () => {
      // ceil(30/6)=5 → interval 4 (=> 1 visible / 5 → 6 shown)
      expect(pickTickInterval(30, 340)).toBe(4);
    });

    it("handles dense hourly history on desktop", () => {
      // ceil(168/12)=14 → interval 13 (=> 1 visible / 14)
      expect(pickTickInterval(168, 1024)).toBe(13);
    });

    it("never returns a negative interval", () => {
      expect(pickTickInterval(1, 320)).toBe(0);
      expect(pickTickInterval(0, 320)).toBe(0);
    });
  });

  describe("with a range (per-range cap kicks in)", () => {
    it("caps 7d at ~7 labels on desktop", () => {
      // 19 spiky points on 7d → 7 labels max → ceil(19/7)=3 → interval 2
      expect(pickTickInterval(19, 1024, "7d")).toBe(2);
    });

    it("caps 30d at ~10 labels on desktop", () => {
      // 30 points on 30d → 10 max → ceil(30/10)=3 → interval 2
      expect(pickTickInterval(30, 1024, "30d")).toBe(2);
    });

    it("caps 24h at ~8 labels on desktop", () => {
      // 24 points → 8 max → ceil(24/8)=3 → interval 2
      expect(pickTickInterval(24, 1024, "24h")).toBe(2);
    });

    it("takes the smaller of range cap and viewport cap on mobile", () => {
      // 7d range cap = 7; small-mobile viewport cap = 6 → min = 6
      // 30 points / 6 = 5 → interval 4
      expect(pickTickInterval(30, 340, "7d")).toBe(4);
    });

    it("returns 0 when count fits the range cap", () => {
      expect(pickTickInterval(7, 1024, "7d")).toBe(0);
      expect(pickTickInterval(8, 1024, "24h")).toBe(0);
    });
  });
});

describe("aggregateToBuckets", () => {
  it("returns an empty array on empty input", () => {
    expect(aggregateToBuckets([], "7d")).toEqual([]);
  });

  it("sums hourly points into daily buckets for 7d range", () => {
    // Two rainy hours on Thursday + zero hours on other days
    const points = [
      { time: "2026-05-14T10:00:00.000Z", value: 0.2 },
      { time: "2026-05-14T13:00:00.000Z", value: 0.2 },
      { time: "2026-05-15T08:00:00.000Z", value: 0 },
    ];
    const out = aggregateToBuckets(points, "7d");
    expect(out).toHaveLength(2);
    expect(out[0].value).toBeCloseTo(0.4, 5);
    expect(out[1].value).toBe(0);
  });

  it("uses hourly buckets for 24h range", () => {
    const points = [
      { time: "2026-05-14T10:15:00.000Z", value: 1 },
      { time: "2026-05-14T10:45:00.000Z", value: 2 },
      { time: "2026-05-14T11:05:00.000Z", value: 3 },
    ];
    const out = aggregateToBuckets(points, "24h");
    expect(out).toHaveLength(2);
    expect(out[0].value).toBe(3);
    expect(out[1].value).toBe(3);
  });

  it("returns chronologically sorted buckets", () => {
    const points = [
      { time: "2026-05-16T10:00:00.000Z", value: 1 },
      { time: "2026-05-14T10:00:00.000Z", value: 1 },
      { time: "2026-05-15T10:00:00.000Z", value: 1 },
    ];
    const out = aggregateToBuckets(points, "7d");
    const times = out.map((p) => p.time);
    expect(times).toEqual([...times].sort());
  });

  it("is idempotent — re-bucketing the output yields the same buckets", () => {
    // We build the input around noon UTC to avoid TZ edge cases (a 00:00 UTC
    // input would already cross the local midnight boundary in CET/CEST).
    const points = [
      { time: "2026-05-14T12:00:00.000Z", value: 3 },
      { time: "2026-05-14T15:00:00.000Z", value: 2 },
      { time: "2026-05-15T12:00:00.000Z", value: 10 },
    ];
    const once = aggregateToBuckets(points, "7d");
    const twice = aggregateToBuckets(once, "7d");
    expect(twice).toEqual(once);
  });
});

describe("formatLabel", () => {
  // Use an ISO at noon UTC to avoid TZ drift around midnight.
  const iso = "2026-03-09T12:00:00.000Z"; // Monday March 9, 2026

  it("returns HH:MM on a single line for 6h/24h ranges", () => {
    const r1 = formatLabel(iso, "6h");
    const r2 = formatLabel(iso, "24h");
    expect(r1.line2).toBeUndefined();
    expect(r2.line2).toBeUndefined();
    // line1 is locale-dependent — assert shape rather than exact value.
    expect(r1.line1).toMatch(/^\d{1,2}[:h]\d{2}/);
  });

  it("returns weekday + day on two lines for 7d", () => {
    const r = formatLabel(iso, "7d");
    expect(r.line1.toLowerCase()).toMatch(/^lun\.?/);
    expect(r.line2).toBe("09");
  });

  it("pads single-digit days with a leading zero on 7d", () => {
    const r = formatLabel("2026-03-03T12:00:00.000Z", "7d");
    expect(r.line2).toBe("03");
  });

  it("returns compact DD/MM on a single line for 30d", () => {
    const r = formatLabel(iso, "30d");
    expect(r.line1).toBe("09/03");
    expect(r.line2).toBeUndefined();
  });

  it("pads month and day on 30d", () => {
    const r = formatLabel("2026-01-05T12:00:00.000Z", "30d");
    expect(r.line1).toBe("05/01");
  });

  it("produces a duplicate weekday across an 8-day span — why the chart keys on time, not label", () => {
    // A 7-day window renders 8 daily bars, so the weekday (`line1`) repeats
    // (two Sundays here). Recharts previously keyed the bars on this label and
    // resolved a hovered bar to the FIRST one sharing the weekday, so hovering
    // "Sun 26" showed "Sun 19 / 0 mm". HistoryBarChart now keys the axis on the
    // unique `time`; this guards the invariant that `label` alone is not unique.
    const days = [
      "2026-07-19T12:00:00.000Z", // Sunday
      "2026-07-20T12:00:00.000Z",
      "2026-07-21T12:00:00.000Z",
      "2026-07-22T12:00:00.000Z",
      "2026-07-23T12:00:00.000Z",
      "2026-07-24T12:00:00.000Z",
      "2026-07-25T12:00:00.000Z",
      "2026-07-26T12:00:00.000Z", // Sunday again — duplicate weekday label
    ];
    const labels = days.map((d) => formatLabel(d, "7d").line1);
    expect(new Set(labels).size).toBeLessThan(labels.length);
    expect(new Set(days).size).toBe(days.length);
  });
});

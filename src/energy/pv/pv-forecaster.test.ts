import { describe, expect, it } from "vitest";
import { WINDOW_DAYS, leadBucket } from "./pv-forecaster.js";

describe("leadBucket", () => {
  it("separates what was just said from what was said days ago", () => {
    expect(leadBucket(0)).toBe("0-1h");
    expect(leadBucket(1)).toBe("0-1h");
    expect(leadBucket(3)).toBe("1-6h");
    expect(leadBucket(12)).toBe("6-24h");
    expect(leadBucket(36)).toBe("24-48h");
    expect(leadBucket(96)).toBe("48h+");
  });

  it("puts each boundary in the tighter bucket", () => {
    expect(leadBucket(6)).toBe("1-6h");
    expect(leadBucket(24)).toBe("6-24h");
    expect(leadBucket(48)).toBe("24-48h");
  });

  it("keeps the series count bounded", () => {
    // The whole point of bucketing: a curve refreshed every 30 minutes over five
    // days must not create a new InfluxDB series per poll.
    const buckets = new Set(Array.from({ length: 121 }, (_, h) => leadBucket(h)));
    expect(buckets.size).toBeLessThanOrEqual(5);
  });

  it("never returns an empty label, even for a negative lead", () => {
    expect(leadBucket(-3)).toBe("0-1h");
  });
});

describe("WINDOW_DAYS", () => {
  it("is the window the study measured as beating all-history", () => {
    expect(WINDOW_DAYS).toBe(45);
  });
});

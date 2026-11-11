import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { BilanPoint } from "../../types";
import { changeMarkerLayout, toData } from "./bilan-chart-data";

// Spec 205 — the chart's buckets keyed by local day or month, and the markers.

const point = (time: string): BilanPoint => ({ time, paidHp: 0, paidHc: 0, avoided: 0 });

describe("toData keys", () => {
  let tz: string | undefined;
  beforeEach(() => {
    tz = process.env.TZ;
    process.env.TZ = "Europe/Paris";
  });
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("keys a UTC bucket by its local day in the month view", () => {
    const [d] = toData([point("2026-07-15T22:00:00Z")], "month", "fr-FR");
    expect(d.key).toBe("2026-07-16");
    expect(d.label).toBe("16");
  });

  it("keys a UTC bucket by its local month in the year view", () => {
    const data = toData(
      [point("2025-12-31T23:00:00Z"), point("2026-07-31T22:00:00Z")],
      "year",
      "fr-FR",
    );
    expect(data.map((d) => d.key)).toEqual(["2026-01", "2026-08"]);
  });
});

describe("changeMarkerLayout", () => {
  const months = Array.from({ length: 12 }, (_, i) => ({
    key: `2026-${String(i + 1).padStart(2, "0")}`,
    label: `m${i + 1}`,
    tooltipLabel: "",
    paidHp: 0,
    paidHc: 0,
    avoided: 0,
    previousYearBill: null,
  }));

  it("puts the label right of the line in the left half, left of it in the right half", () => {
    const m = changeMarkerLayout(months, ["2026-02", "2026-12"], 300, 80);
    expect(m).toEqual([
      { label: "m2", side: "right", row: 0 },
      { label: "m12", side: "left", row: 0 },
    ]);
  });

  it("drops a label one line when the previous marker is too close", () => {
    const m = changeMarkerLayout(months, ["2026-07", "2026-08", "2026-12"], 300, 80);
    expect(m.map((x) => x.row)).toEqual([0, 1, 0]);
  });

  it("marks nothing for a change outside the buckets", () => {
    expect(changeMarkerLayout(months, ["2027-01"], 300, 80)).toEqual([]);
  });
});

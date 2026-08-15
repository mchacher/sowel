import { describe, it, expect } from "vitest";
import { firstChartTarget } from "./analyse-nav";

describe("firstChartTarget (#498, point 1)", () => {
  it("redirects the bare workspace to the first saved chart", () => {
    expect(
      firstChartTarget({ isNew: false, loading: false, charts: [{ id: "a" }, { id: "b" }] }),
    ).toBe("/analyse/a");
  });

  it("stays put while the charts are still loading", () => {
    expect(
      firstChartTarget({ isNew: false, loading: true, charts: [{ id: "a" }] }),
    ).toBeNull();
  });

  it("stays put when the user asked for the new-chart workspace", () => {
    expect(
      firstChartTarget({ isNew: true, loading: false, charts: [{ id: "a" }] }),
    ).toBeNull();
  });

  it("stays on the empty workspace when there are no saved charts", () => {
    expect(
      firstChartTarget({ isNew: false, loading: false, charts: [] }),
    ).toBeNull();
  });

  it("prefers ?new over an available chart (explicit intent wins)", () => {
    expect(
      firstChartTarget({ isNew: true, loading: false, charts: [{ id: "a" }] }),
    ).toBeNull();
  });
});

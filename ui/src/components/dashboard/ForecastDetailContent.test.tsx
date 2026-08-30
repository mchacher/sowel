/**
 * Spec 168 — the vertical day list behind the tile.
 *
 * The equipment page scrolls its day cards horizontally. Inside a sheet that
 * is a fixed-width surface on both viewports, that hides the last days behind
 * a gesture nothing announces, so this one stacks.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { ForecastDetailContent } from "./ForecastDetailContent";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";

function binding(alias: string, value: unknown): DataBindingWithValue {
  return {
    id: "b-" + alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + alias,
    deviceId: "d1",
    deviceName: "Open-Meteo",
    key: alias,
    alias,
    type: typeof value === "number" ? "number" : "string",
    category: "generic",
    value,
    lastUpdated: new Date().toISOString(),
    lastChanged: new Date().toISOString(),
    stale: false,
  } as unknown as DataBindingWithValue;
}

function equipmentWith(bindings: DataBindingWithValue[]): EquipmentWithDetails {
  return {
    id: "eq",
    name: "Prévisions Météo",
    type: "weather_forecast",
    zoneId: "z",
    enabled: true,
    status: "online",
    dataBindings: bindings,
    orderBindings: [],
  } as unknown as EquipmentWithDetails;
}

/** The five days as the reference installation publishes them. */
function fiveDays(withConfidence = true): DataBindingWithValue[] {
  const out: DataBindingWithValue[] = [];
  const max = [26, 26, 27, 27, 30];
  const min = [18, 14, 16, 15, 17];
  for (let i = 0; i < 5; i++) {
    const n = i + 1;
    out.push(binding(`j${n}_condition`, "cloudy"));
    out.push(binding(`j${n}_temp_max`, max[i]));
    out.push(binding(`j${n}_temp_min`, min[i]));
    out.push(binding(`j${n}_rain_prob`, i === 0 ? 86 : 0));
    out.push(binding(`j${n}_wind_gusts`, 20 + i));
    if (withConfidence) {
      out.push(binding(`j${n}_confidence`, "medium"));
      out.push(binding(`j${n}_temp_max_spread`, 2.1));
    }
  }
  return out;
}

const rows = (c: HTMLElement) => [...c.querySelectorAll("div.border-b, div.last\\:border-b-0")];

describe("ForecastDetailContent (spec 168)", () => {
  it("renders one row per day, in day order", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(rows(container).length).toBeGreaterThanOrEqual(5);
    // Maxima appear in the published order.
    const text = container.textContent ?? "";
    expect(text.indexOf("26°")).toBeLessThan(text.indexOf("30°"));
  });

  it("shows the confidence wording on each day that has one", () => {
    render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(screen.getAllByText("fairly reliable")).toHaveLength(5);
  });

  it("renders a day with no confidence without a pill", () => {
    // A plugin older than 2.0. An empty or grey badge would read as a verdict,
    // and "we do not know" is not one.
    render(<ForecastDetailContent equipment={equipmentWith(fiveDays(false))} />);
    expect(screen.queryByText("fairly reliable")).toBeNull();
    expect(screen.queryByText("reliable")).toBeNull();
    // The day itself is still there.
    expect(screen.getAllByText("30°").length).toBe(1);
  });

  it("shows the source line when the plugin publishes the model used", () => {
    const bindings = [...fiveDays(), binding("model_used", "median(4)")];
    render(<ForecastDetailContent equipment={equipmentWith(bindings)} />);
    expect(screen.getByText(/median of 4 models/)).toBeTruthy();
  });

  it("omits the source line when it does not", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(container.textContent).not.toMatch(/Source/);
  });

  it("says so rather than rendering an empty list when nothing is bound", () => {
    render(<ForecastDetailContent equipment={equipmentWith([])} />);
    expect(screen.getByText("No forecast available")).toBeTruthy();
  });

  it("does not scroll horizontally, which is the reason it is a list", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });
});

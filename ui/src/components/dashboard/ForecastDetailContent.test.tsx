/**
 * Spec 168 — the five day columns behind the tile (option C2).
 *
 * The equipment page scrolls its day cards horizontally. A sheet cannot: the
 * days you would scroll past are exactly the ones the forecast is least sure
 * about. Same card anatomy, narrowed so all five fit across a 390px sheet.
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

/**
 * A plugin publishing further out than the sheet is laid out for. `j(\d+)` has
 * no upper bound in the parser, so nothing but the sheet stops a seven day feed
 * from squeezing every column.
 */
function sevenDays(): DataBindingWithValue[] {
  const out = fiveDays();
  for (const n of [6, 7]) {
    out.push(binding(`j${n}_condition`, "cloudy"));
    out.push(binding(`j${n}_temp_max`, 31));
    out.push(binding(`j${n}_temp_min`, 19));
    out.push(binding(`j${n}_rain_prob`, 0));
    out.push(binding(`j${n}_wind_gusts`, 25));
    out.push(binding(`j${n}_confidence`, "low"));
    out.push(binding(`j${n}_temp_max_spread`, 5.4));
  }
  return out;
}

/** One column per published day. */
const columns = (c: HTMLElement) => [...c.querySelectorAll("div.flex-1")];

/** The confidence pills, in day order, by their semantic colour class. */
const pills = (c: HTMLElement) =>
  [...c.querySelectorAll("span")]
    .filter((s) => s.className.includes("rounded-full") && s.className.includes("border"))
    .map(
      (s) =>
        [...s.classList].find((k) => /^text-(success|warning|error)$/.test(k)) ?? "",
    );

describe("ForecastDetailContent (spec 168)", () => {
  it("renders one column per day, in day order", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(columns(container)).toHaveLength(5);
    // Maxima appear in the published order.
    const text = container.textContent ?? "";
    expect(text.indexOf("26")).toBeLessThan(text.indexOf("30"));
  });

  it("gives every qualified column the pill of the equipment page", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(pills(container)).toEqual(Array(5).fill("text-warning"));
    expect(screen.getAllByText("fairly reliable")).toHaveLength(5);
  });

  it("shows the wind and not the rain", () => {
    // One metric fits a 68px column, and wind is the one that changes what you
    // do with a shutter or an awning. Rain stays on the tile for tomorrow.
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    const text = container.textContent ?? "";
    expect(text).toContain("20");
    expect(text).not.toContain("86%");
  });

  it("shows the confidence wording on each day that has one", () => {
    render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(screen.getAllByText("fairly reliable")).toHaveLength(5);
  });

  it("gives a day with no confidence no pill at all", () => {
    // A plugin older than 2.0. A grey badge would read as a verdict, and
    // "we do not know" is not one.
    const { container } = render(
      <ForecastDetailContent equipment={equipmentWith(fiveDays(false))} />,
    );
    expect(pills(container)).toEqual([]);
    expect(screen.queryByText("fairly reliable")).toBeNull();
    expect(screen.queryByText("reliable")).toBeNull();
    // The day itself is still there.
    expect(screen.getAllByText("30").length).toBe(1);
  });

  it("reserves the pill slot so the five columns end on one line", () => {
    // Three days qualified, two not: without a reserved slot the two bare
    // columns end higher than the others.
    const bindings = fiveDays();
    const bare = bindings.filter(
      (b) => !["j4_confidence", "j5_confidence"].includes(b.alias),
    );
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(bare)} />);
    const feet = [...container.querySelectorAll("span")].filter((s) =>
      s.className.includes("min-h-["),
    );
    expect(feet).toHaveLength(5);
    expect(pills(container)).toHaveLength(3);
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

  it("keeps five columns when the plugin publishes seven days", () => {
    // The paddings, the type sizes and the pill slot are tuned for five across
    // a 390px phone. At seven each column falls to about 46px and the pill
    // wraps out of the slot held for it, so the sheet clamps rather than trust
    // the feed. `ForecastStrip` held this bound before it was deleted.
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(sevenDays())} />);
    expect(columns(container)).toHaveLength(5);
    expect(pills(container)).toHaveLength(5);
  });

  it("clamps from the near end, so the days kept are the ones nearest today", () => {
    // Day 6 and 7 are the ones to lose: a forecast is least sure furthest out.
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(sevenDays())} />);
    // The j6/j7 maximum (31) never renders; the j5 one (30) does.
    expect(container.textContent).toContain("30");
    expect(container.textContent).not.toContain("31");
  });

  it("does not scroll horizontally, which is the reason the columns shrink", () => {
    const { container } = render(<ForecastDetailContent equipment={equipmentWith(fiveDays())} />);
    expect(container.querySelector(".overflow-x-auto")).toBeNull();
  });
});

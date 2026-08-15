import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { formatTooltipRow, seriesFullLabel, type TooltipSeries } from "./tooltip-format";

// Identity t: returns the i18n key, enough to assert which key is picked.
const t = ((k: string) => k) as unknown as TFunction;

const measurement: TooltipSeries = {
  id: "eq1:temp",
  alias: "temp",
  category: "temperature",
  deviceName: "Thermo",
  sameCategoryCount: 1,
  equipmentName: "Thermostat",
  zoneName: "Salon",
  color: "#123456",
};

const state: TooltipSeries = {
  id: "eq2:state",
  alias: "state",
  category: "light_state",
  deviceName: "Relay",
  sameCategoryCount: 1,
  equipmentName: "Chauffe-eau",
  zoneName: "",
  color: "#abcdef",
};

describe("formatTooltipRow (#498, point 4)", () => {
  it("formats a measurement with its unit and carries the colour", () => {
    const row = formatTooltipRow(measurement, 20.5, undefined, t);
    expect(row?.value).toBe("20.5 °C");
    expect(row?.color).toBe("#123456");
    expect(row?.label.startsWith("Salon / Thermostat /")).toBe(true);
  });

  it("drops a trailing .0 on integer measurements", () => {
    expect(formatTooltipRow(measurement, 20, undefined, t)?.value).toBe("20 °C");
  });

  it("appends the envelope band when the row carries min/max", () => {
    const row = formatTooltipRow(measurement, 20.5, { "eq1:temp:min": 19, "eq1:temp:max": 22 }, t);
    expect(row?.value).toBe("20.5 °C (19 / 22)");
  });

  it("renders a boolean On/Off from the category tick labels", () => {
    expect(formatTooltipRow(state, 1, undefined, t)?.value).toBe("analyse.bool.power.on");
    expect(formatTooltipRow(state, 0, undefined, t)?.value).toBe("analyse.bool.power.off");
  });

  it("renders an aggregated boolean mean as a percentage of active time", () => {
    expect(formatTooltipRow(state, 0.4, undefined, t)?.value).toBe("40% analyse.bool.power.on");
  });

  it("omits the zone from the label when unknown", () => {
    expect(formatTooltipRow(state, 1, undefined, t)?.label.startsWith("Chauffe-eau /")).toBe(true);
  });

  it("returns null for a non-finite value (nothing to show)", () => {
    expect(formatTooltipRow(measurement, undefined, undefined, t)).toBeNull();
    expect(formatTooltipRow(measurement, NaN, undefined, t)).toBeNull();
  });
});

describe("seriesFullLabel", () => {
  it("joins zone / equipment / metric", () => {
    expect(seriesFullLabel(measurement, t).startsWith("Salon / Thermostat /")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  formatBarTooltip,
  formatSeriesTooltip,
  formatTooltipRow,
  formatValueWithUnit,
  seriesFullLabel,
  tooltipName,
  tooltipNumber,
  type TooltipSeries,
} from "./tooltip-format";

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

// The recharts <Tooltip formatter> path (#681). Recharts calls a formatter with
// `(value, name, item, index, payload)` and types value/name wide, so these
// helpers are what stands between the widened signature and the rendered text.
describe("tooltipNumber (#681)", () => {
  it("passes a number through", () => {
    expect(tooltipNumber(20.5)).toBe(20.5);
  });

  it("reads 0 for undefined, matching the previous `value ?? 0` call sites", () => {
    expect(tooltipNumber(undefined)).toBe(0);
    expect(tooltipNumber(null)).toBe(0);
  });

  it("coerces the numeric string recharts may hand over", () => {
    expect(tooltipNumber("42")).toBe(42);
  });

  it("takes the first entry of a range value (ValueType allows an array)", () => {
    expect(tooltipNumber([12, 34])).toBe(12);
  });

  it("reads 0 rather than NaN for a non-numeric value", () => {
    expect(tooltipNumber("n/a")).toBe(0);
    expect(tooltipNumber({})).toBe(0);
  });
});

describe("tooltipName (#681)", () => {
  it("passes a string name through", () => {
    expect(tooltipName("min")).toBe("min");
  });

  it("stringifies a numeric name (NameType allows a number)", () => {
    expect(tooltipName(3)).toBe("3");
  });

  it("reads empty for a missing name", () => {
    expect(tooltipName(undefined)).toBe("");
  });
});

describe("formatBarTooltip (#681)", () => {
  it("formats a plain measurement with its unit and keeps the series label", () => {
    expect(formatBarTooltip(20.5, "°C", "Valeur")).toEqual(["20.5 °C", "Valeur"]);
  });

  it("drops a trailing .0 on an integer", () => {
    expect(formatBarTooltip(20, "°C", "Valeur")).toEqual(["20 °C", "Valeur"]);
  });

  it("converts Wh to kWh above 1 kWh", () => {
    expect(formatBarTooltip(2500, "Wh", "Consommation")[0]).toBe("2.50 kWh");
    expect(formatBarTooltip(15000, "Wh", "Consommation")[0]).toBe("15.0 kWh");
    expect(formatBarTooltip(150000, "Wh", "Consommation")[0]).toBe("150 kWh");
  });

  it("stays in Wh below 1 kWh", () => {
    expect(formatBarTooltip(750, "Wh", "Consommation")[0]).toBe("750 Wh");
  });

  it("renders an undefined value as 0 instead of NaN", () => {
    expect(formatBarTooltip(undefined, "°C", "Valeur")).toEqual(["0 °C", "Valeur"]);
  });
});

describe("formatSeriesTooltip (#681)", () => {
  const plain = { unit: "°C", isPower: false, isDiscrete: false };

  it("formats a measurement with its unit and no row label", () => {
    expect(formatSeriesTooltip(20.5, "value", plain)).toEqual(["20.5 °C", ""]);
  });

  it("labels the min/max envelope rows with their own name", () => {
    expect(formatSeriesTooltip(18, "min", plain)).toEqual(["18 °C", "min"]);
    expect(formatSeriesTooltip(24, "max", plain)).toEqual(["24 °C", "max"]);
  });

  it("renders power in W below 1 kW and in kW above", () => {
    const power = { unit: "W", isPower: true, isDiscrete: false };
    expect(formatSeriesTooltip(750, "value", power)).toEqual(["750 W", "Puissance"]);
    expect(formatSeriesTooltip(2500, "value", power)).toEqual(["2.5 kW", "Puissance"]);
  });

  it("keeps the envelope name on a power series", () => {
    const power = { unit: "W", isPower: true, isDiscrete: false };
    expect(formatSeriesTooltip(2500, "max", power)).toEqual(["2.5 kW", "max"]);
  });

  it("renders a discrete series as ON/OFF", () => {
    const discrete = { unit: undefined, isPower: false, isDiscrete: true };
    expect(formatSeriesTooltip(1, "value", discrete)).toEqual(["ON", ""]);
    expect(formatSeriesTooltip(0, "value", discrete)).toEqual(["OFF", ""]);
  });

  it("renders an undefined value as 0 instead of NaN", () => {
    expect(formatSeriesTooltip(undefined, undefined, plain)).toEqual(["0 °C", ""]);
  });
});

describe("formatValueWithUnit", () => {
  it("renders a bare value when no unit is given", () => {
    expect(formatValueWithUnit(20.5)).toBe("20.5");
  });
});

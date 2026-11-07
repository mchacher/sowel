import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import {
  formatAxisTick,
  formatBarTooltip,
  formatSeriesTooltip,
  formatTooltipRow,
  formatValueWithUnit,
  seriesFullLabel,
  tooltipName,
  tooltipNumber,
  type TooltipSeries,
} from "./tooltip-format";

// Spec 196: values come from lib/format, whose no-break spaces read here as spaces.
function sp<T>(x: T): T {
  if (typeof x === "string") return x.replace(/[\u00A0\u202F]/g, " ") as T;
  if (Array.isArray(x)) return x.map(sp) as T;
  return x;
}

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
    expect(sp(row?.value)).toBe("20.5 °C");
    expect(row?.color).toBe("#123456");
    expect(row?.label.startsWith("Salon / Thermostat /")).toBe(true);
  });

  it("keeps one decimal on a temperature (spec 196, pr3-zero)", () => {
    expect(sp(formatTooltipRow(measurement, 20, undefined, t)?.value)).toBe("20.0 °C");
  });

  it("appends the envelope band when the row carries min/max", () => {
    const row = formatTooltipRow(measurement, 20.5, { "eq1:temp:min": 19, "eq1:temp:max": 22 }, t);
    expect(sp(row?.value)).toBe("20.5 °C (19.0 / 22.0 °C)");
  });

  it("formats the band with the value's own unit and formatter", () => {
    const power: TooltipSeries = { ...measurement, id: "eq3:p", alias: "power", category: "power" };
    const kw = formatTooltipRow(power, 1100, { "eq3:p:min": 1050, "eq3:p:max": 1150 }, t);
    expect(sp(kw?.value)).toBe("1.1 kW (1.1 / 1.2 kW)");
    const mixed = formatTooltipRow(power, 1000, { "eq3:p:min": 950, "eq3:p:max": 1200 }, t);
    expect(sp(mixed?.value)).toBe("1 kW (950 W / 1.2 kW)");
  });

  it("renders a boolean On/Off from the category tick labels", () => {
    expect(sp(formatTooltipRow(state, 1, undefined, t)?.value)).toBe("analyse.bool.power.on");
    expect(sp(formatTooltipRow(state, 0, undefined, t)?.value)).toBe("analyse.bool.power.off");
  });

  it("renders an aggregated boolean mean as a percentage of active time", () => {
    expect(sp(formatTooltipRow(state, 0.4, undefined, t)?.value)).toBe("40% analyse.bool.power.on");
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

  // Spec 196 — a saved chart outliving its equipment showed the equipment's UUID and
  // the raw alias.
  it("names a deleted equipment's series by what it measured, not by an id", () => {
    const orphan = {
      ...measurement,
      alias: "humidity",
      category: "",
      equipmentName: "",
      zoneName: "",
      deleted: true,
    };
    expect(seriesFullLabel(orphan, t)).toBe("analyse.series.deleted · category.humidity");
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
    expect(sp(formatBarTooltip(20.5, "°C", "Valeur"))).toEqual(["20.5 °C", "Valeur"]);
  });

  it("keeps one decimal on a temperature (spec 196, pr3-zero)", () => {
    expect(sp(formatBarTooltip(20, "°C", "Valeur"))).toEqual(["20.0 °C", "Valeur"]);
  });

  it("converts Wh to kWh above 1 kWh", () => {
    expect(sp(formatBarTooltip(2500, "Wh", "Consommation")[0])).toBe("2.5 kWh");
    expect(sp(formatBarTooltip(15000, "Wh", "Consommation")[0])).toBe("15 kWh");
    expect(sp(formatBarTooltip(150000, "Wh", "Consommation")[0])).toBe("150 kWh");
  });

  it("stays in Wh below 1 kWh", () => {
    expect(sp(formatBarTooltip(750, "Wh", "Consommation")[0])).toBe("750 Wh");
  });

  it("renders an undefined value as 0 instead of NaN", () => {
    expect(sp(formatBarTooltip(undefined, "°C", "Valeur"))).toEqual(["0.0 °C", "Valeur"]);
  });
});

describe("formatSeriesTooltip (#681)", () => {
  // French labels, as the UI shows them (spec 196 2a: no hard-coded words).
  const frLabels: Record<string, string> = {
    "category.power": "Puissance",
    "controls.on": "Marche",
    "controls.off": "Arrêt",
  };
  const t = (key: string) => frLabels[key] ?? key;
  const plain = { unit: "°C", isPower: false, isDiscrete: false, t };

  it("formats a measurement with its unit and no row label", () => {
    expect(sp(formatSeriesTooltip(20.5, "value", plain))).toEqual(["20.5 °C", ""]);
  });

  it("labels the min/max envelope rows with their own name", () => {
    expect(sp(formatSeriesTooltip(18, "min", plain))).toEqual(["18.0 °C", "min"]);
    expect(sp(formatSeriesTooltip(24, "max", plain))).toEqual(["24.0 °C", "max"]);
  });

  it("renders power in W below 1 kW and in kW above", () => {
    const power = { unit: "W", isPower: true, isDiscrete: false, t };
    expect(sp(formatSeriesTooltip(750, "value", power))).toEqual(["750 W", "Puissance"]);
    expect(sp(formatSeriesTooltip(2500, "value", power))).toEqual(["2.5 kW", "Puissance"]);
  });

  it("keeps the envelope name on a power series", () => {
    const power = { unit: "W", isPower: true, isDiscrete: false, t };
    expect(sp(formatSeriesTooltip(2500, "max", power))).toEqual(["2.5 kW", "max"]);
  });

  it("renders a discrete series with the translated on/off words", () => {
    const discrete = { unit: undefined, isPower: false, isDiscrete: true, t };
    expect(sp(formatSeriesTooltip(1, "value", discrete))).toEqual(["Marche", ""]);
    expect(sp(formatSeriesTooltip(0, "value", discrete))).toEqual(["Arrêt", ""]);
  });

  it("renders an undefined value as 0 instead of NaN", () => {
    expect(sp(formatSeriesTooltip(undefined, undefined, plain))).toEqual(["0.0 °C", ""]);
  });
});

describe("formatValueWithUnit", () => {
  it("renders a bare value when no unit is given", () => {
    expect(sp(formatValueWithUnit(20.5))).toBe("20.5");
  });
});

describe("formatAxisTick (spec 196): one unit per axis", () => {
  it("reads every tick of a power axis in kW once the axis reaches 1 kW", () => {
    expect([0, 500, 1000, 1500].map((v) => sp(formatAxisTick(v, "W", 1500)))).toEqual([
      "0 kW",
      "0.5 kW",
      "1 kW",
      "1.5 kW",
    ]);
  });

  it("keeps W when the axis stays under 1 kW", () => {
    expect([0, 400, 800].map((v) => sp(formatAxisTick(v, "W", 800)))).toEqual([
      "0 W",
      "400 W",
      "800 W",
    ]);
  });

  it("does the same for energy, and for a kW or Wh series", () => {
    expect(sp(formatAxisTick(0.5, "kW", 2))).toBe("0.5 kW");
    expect(sp(formatAxisTick(500, "Wh", 2000))).toBe("0.5 kWh");
    expect(sp(formatAxisTick(500, "Wh", 800))).toBe("500 Wh");
  });

  it("leaves other units alone, and a unit-less axis bare", () => {
    expect(sp(formatAxisTick(20, "°C", 25))).toBe("20.0 °C");
    expect(sp(formatAxisTick(2500, "", 2500))).toBe("2,500");
  });
});

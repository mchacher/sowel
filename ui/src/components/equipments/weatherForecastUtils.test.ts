import { describe, expect, it } from "vitest";
import type { DataBindingWithValue } from "../../types";
import {
  modelLabel,
  parseForecastDays,
  parseModelUsed,
  CONFIDENCE_STYLES,
  type ForecastConfidence,
} from "./weatherForecastUtils";

function binding(
  alias: string,
  value: unknown,
  type: DataBindingWithValue["type"] = "number",
): DataBindingWithValue {
  return {
    id: "b-" + alias,
    equipmentId: "eq",
    deviceDataId: "dd-" + alias,
    deviceId: "d1",
    deviceName: "Weather Forecast",
    alias,
    key: alias,
    type,
    category: "temperature_outdoor" as DataBindingWithValue["category"],
    value,
    unit: "°C",
    lastUpdated: "2026-08-24 10:00:00Z",
    lastChanged: "2026-08-24 10:00:00Z",
    stale: false,
  };
}

/** What plugin 1.0.0 publishes: five metrics per day, no confidence. */
function legacyBindings(): DataBindingWithValue[] {
  return [
    binding("j1_condition", "sunny", "enum"),
    binding("j1_temp_min", 18),
    binding("j1_temp_max", 30.5),
    binding("j1_rain_prob", 20),
    binding("j1_wind_gusts", 41),
  ];
}

describe("parseForecastDays", () => {
  it("parses the confidence metrics published from plugin 2.0", () => {
    const days = parseForecastDays([
      ...legacyBindings(),
      binding("j1_temp_max_spread", 2.6),
      binding("j1_confidence", "medium", "enum"),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].tempMaxSpread).toBe(2.6);
    expect(days[0].confidence).toBe("medium");
  });

  it("leaves both fields null on plugin 1.0.0 data and keeps every other field", () => {
    const days = parseForecastDays(legacyBindings());
    expect(days[0]).toEqual({
      dayIndex: 1,
      condition: "sunny",
      tempMin: 18,
      tempMax: 30.5,
      rainProb: 20,
      windGusts: 41,
      tempMaxSpread: null,
      confidence: null,
    });
  });

  it("keeps a spread published without a confidence level", () => {
    const days = parseForecastDays([...legacyBindings(), binding("j1_temp_max_spread", 4.2)]);
    expect(days[0].tempMaxSpread).toBe(4.2);
    expect(days[0].confidence).toBeNull();
  });

  it("ignores a non-numeric spread rather than throwing", () => {
    const days = parseForecastDays([
      ...legacyBindings(),
      binding("j1_temp_max_spread", "n/a", "text"),
    ]);
    expect(days[0].tempMaxSpread).toBeNull();
  });

  it("ignores a confidence value outside the known enum", () => {
    const days = parseForecastDays([
      ...legacyBindings(),
      binding("j1_confidence", "excellent", "enum"),
    ]);
    expect(days[0].confidence).toBeNull();
  });

  it("does not confuse temp_max_spread with temp_max", () => {
    const days = parseForecastDays([
      binding("j1_temp_max", 30.5),
      binding("j1_temp_max_spread", 2.6),
    ]);
    expect(days[0].tempMax).toBe(30.5);
    expect(days[0].tempMaxSpread).toBe(2.6);
  });

  it("keeps days sorted and only carries confidence on the days that publish it", () => {
    const days = parseForecastDays([
      binding("j5_temp_max", 25),
      binding("j1_temp_max", 30),
      binding("j1_temp_max_spread", 1.2),
      binding("j3_temp_max", 28),
      binding("j3_temp_max_spread", 5.4),
    ]);
    expect(days.map((d) => d.dayIndex)).toEqual([1, 3, 5]);
    expect(days[2].tempMaxSpread).toBeNull();
  });
});

describe("parseModelUsed", () => {
  it("returns the published model id", () => {
    const bindings = [...legacyBindings(), binding("model_used", "meteofrance_arome_france", "text")];
    expect(parseModelUsed(bindings)).toBe("meteofrance_arome_france");
  });

  it("returns the median notation as published", () => {
    expect(parseModelUsed([binding("model_used", "median(5)", "text")])).toBe("median(5)");
  });

  it("returns null when the binding is absent, i.e. on plugin 1.0.0", () => {
    expect(parseModelUsed(legacyBindings())).toBeNull();
  });

  it("returns null on a non-string value", () => {
    expect(parseModelUsed([binding("model_used", 42)])).toBeNull();
  });

  it("treats the plugin's `none` sentinel as nothing to show", () => {
    expect(parseModelUsed([binding("model_used", "none", "text")])).toBeNull();
    expect(parseModelUsed([binding("model_used", "   ", "text")])).toBeNull();
  });
});

describe("modelLabel", () => {
  it("humanises a known model id with its provider and grid", () => {
    expect(modelLabel("meteofrance_arome_france")).toBe("AROME 2.5 km");
    expect(modelLabel("dmi_harmonie_arome_europe")).toBe("DMI HARMONIE 2 km");
  });

  it("returns an unknown id unchanged rather than guessing", () => {
    expect(modelLabel("some_new_model")).toBe("some_new_model");
  });
});

// Spec 168 — the tile, the sheet and the equipment page render the same three
// bands, so the bands live here and nowhere else.
describe("confidence colour map", () => {
  const levels: ForecastConfidence[] = ["high", "medium", "low"];

  it("gives every level a pill style", () => {
    for (const level of levels) {
      expect(CONFIDENCE_STYLES[level]).toBeTruthy();
    }
  });

  it("keeps the three bands distinguishable from each other", () => {
    // A traffic light where two lamps share a colour is not a traffic light.
    expect(new Set(levels.map((l) => CONFIDENCE_STYLES[l])).size).toBe(3);
  });
});

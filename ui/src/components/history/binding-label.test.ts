import { describe, it, expect } from "vitest";
import { humanBindingLabel, humanBindingLabelFromList } from "./binding-label";
import type { HistoryBindingState } from "../../types";

// Mock t() that mirrors the FR translations the helper relies on.
const t = ((key: string) =>
  ({
    "category.temperature": "Température",
    "category.humidity": "Humidité",
    "category.pressure": "Pression",
    "category.noise": "Bruit",
    "category.co2": "CO₂",
    "category.battery": "Batterie",
    "category.wind": "Vent",
    "category.rain": "Pluie",
    "weather.indoor": "Intérieure",
    "weather.outdoor": "Extérieure",
    "weather.windSpeed": "Vitesse du vent",
    "weather.windDirection": "Direction du vent",
    "weather.gustSpeed": "Rafales",
    "weather.gustDirection": "Direction des rafales",
    "weather.rainCurrent": "Pluie actuelle",
    "weather.rain1h": "Pluie 1h",
    "weather.rain24h": "Pluie 24h",
  })[key] ?? key) as unknown as Parameters<typeof humanBindingLabel>[2];

/** Build a HistoryBindingState quickly. */
function b(
  alias: string,
  category: string,
  deviceName = "",
): HistoryBindingState {
  return {
    bindingId: alias,
    alias,
    category: category as HistoryBindingState["category"],
    deviceName,
    type: "number",
    historize: null,
    effectiveOn: true,
  };
}

describe("humanBindingLabel — Netatmo weather station full set", () => {
  // The exact 16-binding equipment shown in the user's screenshot.
  const all: HistoryBindingState[] = [
    b("temperature", "temperature", "Station Intérieure"),
    b("temperature_2", "temperature_outdoor", "Module Extérieur"),
    b("humidity", "humidity", "Station Intérieure"),
    b("humidity_2", "humidity_outdoor", "Module Extérieur"),
    b("pressure", "pressure", "Station Intérieure"),
    b("noise", "noise", "Station Intérieure"),
    b("co2", "co2", "Station Intérieure"),
    b("wind_strength", "wind", "Anémomètre"),
    b("gust_strength", "wind", "Anémomètre"),
    b("wind_angle", "wind", "Anémomètre"),
    b("gust_angle", "wind", "Anémomètre"),
    b("rain", "rain", "Pluviomètre"),
    b("sum_rain_1", "rain", "Pluviomètre"),
    b("sum_rain_24", "rain", "Pluviomètre"),
    b("battery", "battery", "Module Extérieur"),
    b("battery_2", "battery", "Anémomètre"),
    b("battery_3", "battery", "Pluviomètre"),
  ];

  const labelOf = (alias: string) => {
    const binding = all.find((x) => x.alias === alias)!;
    return humanBindingLabelFromList(binding, all, t);
  };

  it("indoor temperature and humidity are qualified by category (lowercased scope)", () => {
    expect(labelOf("temperature")).toBe("Température intérieure");
    expect(labelOf("humidity")).toBe("Humidité intérieure");
  });

  it("outdoor temperature and humidity are qualified by category (lowercased scope)", () => {
    expect(labelOf("temperature_2")).toBe("Température extérieure");
    expect(labelOf("humidity_2")).toBe("Humidité extérieure");
  });

  it("uses metric-specific labels for wind / gust / rain detail keys", () => {
    expect(labelOf("wind_strength")).toBe("Vitesse du vent");
    expect(labelOf("gust_strength")).toBe("Rafales");
    expect(labelOf("wind_angle")).toBe("Direction du vent");
    expect(labelOf("gust_angle")).toBe("Direction des rafales");
    expect(labelOf("rain")).toBe("Pluie actuelle");
    expect(labelOf("sum_rain_1")).toBe("Pluie 1h");
    expect(labelOf("sum_rain_24")).toBe("Pluie 24h");
  });

  it("falls back to the plain category label for unambiguous single bindings", () => {
    expect(labelOf("pressure")).toBe("Pression");
    expect(labelOf("noise")).toBe("Bruit");
    expect(labelOf("co2")).toBe("CO₂");
  });

  it("uses the device name to disambiguate multi-instance categories (battery)", () => {
    expect(labelOf("battery")).toBe("Batterie Module Extérieur");
    expect(labelOf("battery_2")).toBe("Batterie Anémomètre");
    expect(labelOf("battery_3")).toBe("Batterie Pluviomètre");
  });
});

describe("humanBindingLabel — same-category disambiguation", () => {
  // Real-world case on sowelox: a Netatmo NAMain `temperature` binding and a
  // polytropic PAC `temperature` binding share category=temperature on the
  // same Station Météo equipment. Without disambiguation both labels read
  // "Température intérieure" and the user picks the wrong one in the chart
  // selector.
  const all: HistoryBindingState[] = [
    b("temperature_2", "temperature", "Weather Station"),
    b("insideTemperature", "temperature", "PAC"),
    b("temperature", "temperature_outdoor", "Outdoor Module"),
    b("outsideTemperature", "temperature_outdoor", "PAC"),
  ];
  const labelOf = (alias: string) =>
    humanBindingLabelFromList(all.find((x) => x.alias === alias)!, all, t);

  it("appends the device name when two indoor temperatures coexist", () => {
    expect(labelOf("temperature_2")).toBe("Température intérieure (Weather Station)");
    expect(labelOf("insideTemperature")).toBe("Température intérieure (PAC)");
  });

  it("appends the device name when two outdoor temperatures coexist", () => {
    expect(labelOf("temperature")).toBe("Température extérieure (Outdoor Module)");
    expect(labelOf("outsideTemperature")).toBe("Température extérieure (PAC)");
  });

  it("falls back to bare label when only one of the two exists (no ambiguity)", () => {
    const onlyOne: HistoryBindingState[] = [b("temperature_2", "temperature", "Weather Station")];
    expect(
      humanBindingLabelFromList(onlyOne[0], onlyOne, t),
    ).toBe("Température intérieure");
  });
});

describe("humanBindingLabel — fallback behaviour", () => {
  it("returns the plain category label when only one binding of that category exists, even without deviceName", () => {
    const all = [b("battery", "battery", "")];
    expect(humanBindingLabelFromList(all[0], all, t)).toBe("Batterie");
  });

  it("falls back to the plain category label when multi-instance but no deviceName", () => {
    const all = [b("battery", "battery", ""), b("battery_2", "battery", "")];
    expect(humanBindingLabelFromList(all[0], all, t)).toBe("Batterie");
    expect(humanBindingLabelFromList(all[1], all, t)).toBe("Batterie");
  });

  it("returns the raw category for unknown categories", () => {
    const all = [b("something", "unknown_cat", "")];
    expect(humanBindingLabelFromList(all[0], all, t)).toBe("category.unknown_cat");
  });

  it("low-level humanBindingLabel accepts a pre-computed sameCategoryCount", () => {
    expect(
      humanBindingLabel(
        { alias: "battery", category: "battery", deviceName: "Module Extérieur", sameCategoryCount: 3 },
        t,
      ),
    ).toBe("Batterie Module Extérieur");
    expect(
      humanBindingLabel(
        { alias: "battery", category: "battery", deviceName: "Module Extérieur", sameCategoryCount: 1 },
        t,
      ),
    ).toBe("Batterie");
  });
});

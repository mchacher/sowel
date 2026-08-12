import { describe, it, expect } from "vitest";
import {
  booleanTickLabels,
  familiesCompatible,
  familyOf,
  hasEnvelope,
  isBooleanCategory,
  isCumulativeBarChart,
  isCumulativeChart,
} from "./history-utils";

describe("isCumulativeBarChart", () => {
  it("routes energy bindings to the bar chart", () => {
    expect(isCumulativeBarChart("energy")).toBe(true);
  });

  it("routes all rain bindings to the bar chart (user preference)", () => {
    // Includes the bare `rain` alias (instantaneous mm/h) — kept as bars even
    // though it is conceptually a rate, on explicit user request.
    expect(isCumulativeBarChart("rain")).toBe(true);
  });

  it("routes other categories to the line chart by default", () => {
    expect(isCumulativeBarChart("temperature")).toBe(false);
    expect(isCumulativeBarChart("humidity")).toBe(false);
    expect(isCumulativeBarChart("pressure")).toBe(false);
    expect(isCumulativeBarChart("wind")).toBe(false);
  });
});

describe("familyOf", () => {
  it("classifies continuous measurements", () => {
    expect(familyOf("temperature")).toBe("measurements");
    expect(familyOf("humidity_outdoor")).toBe("measurements");
    expect(familyOf("pressure")).toBe("measurements");
    expect(familyOf("wind")).toBe("measurements");
    expect(familyOf("battery")).toBe("measurements");
  });

  it("classifies cumulative categories", () => {
    expect(familyOf("rain")).toBe("cumulative");
    expect(familyOf("energy")).toBe("cumulative");
  });

  it("classifies boolean/state categories", () => {
    expect(familyOf("motion")).toBe("states");
    expect(familyOf("contact_door")).toBe("states");
    expect(familyOf("water_leak")).toBe("states");
  });

  it("classifies strictly-binary actuator feedback as states (spec 144)", () => {
    expect(familyOf("light_state")).toBe("states");
    expect(familyOf("appliance_state")).toBe("states");
  });

  it("does NOT force cover/gate/lock onto the 0/1 state axis (they can be multi-value; #434 index-encodes them)", () => {
    // Excluded on purpose: a cover's OPEN/CLOSED/STOP is index 0/1/2, which a
    // two-label [0,1] axis would clip and mislabel. They chart as numeric.
    expect(familyOf("cover_state")).toBeNull();
    expect(familyOf("gate_state")).toBeNull();
    expect(familyOf("lock_state")).toBeNull();
  });

  it("returns null for unknown categories", () => {
    expect(familyOf("unknown_category")).toBeNull();
    expect(familyOf("setpoint")).toBeNull();
  });
});

describe("familiesCompatible", () => {
  it("lets measurements and states share a chart", () => {
    expect(familiesCompatible("measurements", "states")).toBe(true);
    expect(familiesCompatible("states", "measurements")).toBe(true);
  });

  it("keeps cumulative alone", () => {
    expect(familiesCompatible("cumulative", "measurements")).toBe(false);
    expect(familiesCompatible("states", "cumulative")).toBe(false);
    expect(familiesCompatible("cumulative", "cumulative")).toBe(true);
  });

  it("accepts unclassified categories anywhere", () => {
    expect(familiesCompatible(null, "cumulative")).toBe(true);
    expect(familiesCompatible("cumulative", null)).toBe(true);
  });
});

describe("isCumulativeChart", () => {
  it("returns true when every series is cumulative", () => {
    expect(isCumulativeChart(["rain"])).toBe(true);
    expect(isCumulativeChart(["rain", "energy"])).toBe(true);
  });

  it("returns false when any series is non-cumulative", () => {
    expect(isCumulativeChart(["rain", "temperature"])).toBe(false);
    expect(isCumulativeChart(["temperature"])).toBe(false);
  });

  it("returns false for an empty list", () => {
    expect(isCumulativeChart([])).toBe(false);
  });
});

describe("hasEnvelope", () => {
  it("flags slow-moving continuous categories for the envelope", () => {
    expect(hasEnvelope("temperature")).toBe(true);
    expect(hasEnvelope("humidity")).toBe(true);
    expect(hasEnvelope("pressure")).toBe(true);
    expect(hasEnvelope("co2")).toBe(true);
  });

  it("excludes fast-varying or stepwise series from the envelope", () => {
    expect(hasEnvelope("wind")).toBe(false);
    expect(hasEnvelope("battery")).toBe(false);
    expect(hasEnvelope("voltage")).toBe(false);
  });
});

describe("isBooleanCategory", () => {
  it("identifies state categories", () => {
    expect(isBooleanCategory("motion")).toBe(true);
    expect(isBooleanCategory("contact_door")).toBe(true);
    expect(isBooleanCategory("contact_window")).toBe(true);
    expect(isBooleanCategory("water_leak")).toBe(true);
    expect(isBooleanCategory("smoke")).toBe(true);
  });

  it("identifies actuator state categories (spec 144)", () => {
    expect(isBooleanCategory("light_state")).toBe(true);
    expect(isBooleanCategory("appliance_state")).toBe(true);
  });

  it("rejects non-state categories", () => {
    expect(isBooleanCategory("temperature")).toBe(false);
    expect(isBooleanCategory("rain")).toBe(false);
  });
});

describe("booleanTickLabels", () => {
  it("returns motion-specific labels", () => {
    expect(booleanTickLabels("motion")).toEqual([
      "analyse.bool.motion.off",
      "analyse.bool.motion.on",
    ]);
  });

  it("returns contact-specific labels for both door and window", () => {
    expect(booleanTickLabels("contact_door")).toEqual([
      "analyse.bool.contact.closed",
      "analyse.bool.contact.open",
    ]);
    expect(booleanTickLabels("contact_window")).toEqual([
      "analyse.bool.contact.closed",
      "analyse.bool.contact.open",
    ]);
  });

  it("returns leak-specific labels", () => {
    expect(booleanTickLabels("water_leak")).toEqual([
      "analyse.bool.leak.dry",
      "analyse.bool.leak.wet",
    ]);
  });

  it("returns smoke-specific labels", () => {
    expect(booleanTickLabels("smoke")).toEqual([
      "analyse.bool.smoke.clear",
      "analyse.bool.smoke.detected",
    ]);
  });

  it("returns power labels for actuator feedback (spec 144)", () => {
    expect(booleanTickLabels("light_state")).toEqual([
      "analyse.bool.power.off",
      "analyse.bool.power.on",
    ]);
    expect(booleanTickLabels("appliance_state")).toEqual([
      "analyse.bool.power.off",
      "analyse.bool.power.on",
    ]);
  });


  it("falls back to generic on/off for unsupported categories", () => {
    expect(booleanTickLabels("unknown")).toEqual([
      "analyse.bool.generic.off",
      "analyse.bool.generic.on",
    ]);
  });
});

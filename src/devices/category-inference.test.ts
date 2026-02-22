import { describe, it, expect } from "vitest";
import { inferCategory, collectProperties } from "./category-inference.js";
import type { Z2MExpose } from "../shared/types.js";

describe("inferCategory", () => {
  it("maps occupancy to motion", () => {
    expect(inferCategory("occupancy", new Set(["occupancy", "battery"]))).toBe("motion");
  });

  it("maps temperature to temperature", () => {
    expect(inferCategory("temperature", new Set(["temperature", "humidity"]))).toBe("temperature");
  });

  it("maps humidity to humidity", () => {
    expect(inferCategory("humidity", new Set(["temperature", "humidity"]))).toBe("humidity");
  });

  it("maps battery to battery", () => {
    expect(inferCategory("battery", new Set(["battery"]))).toBe("battery");
  });

  it("maps illuminance to luminosity", () => {
    expect(inferCategory("illuminance", new Set(["illuminance"]))).toBe("luminosity");
  });

  it("maps illuminance_lux to luminosity", () => {
    expect(inferCategory("illuminance_lux", new Set(["illuminance_lux"]))).toBe("luminosity");
  });

  it("maps brightness to light_brightness", () => {
    expect(inferCategory("brightness", new Set(["brightness", "state"]))).toBe("light_brightness");
  });

  it("maps color_temp to light_color_temp", () => {
    expect(inferCategory("color_temp", new Set(["color_temp"]))).toBe("light_color_temp");
  });

  it("maps position to shutter_position", () => {
    expect(inferCategory("position", new Set(["position"]))).toBe("shutter_position");
  });

  it("maps power to power", () => {
    expect(inferCategory("power", new Set(["power", "energy"]))).toBe("power");
  });

  it("maps energy to energy", () => {
    expect(inferCategory("energy", new Set(["power", "energy"]))).toBe("energy");
  });

  it("maps voltage to voltage", () => {
    expect(inferCategory("voltage", new Set(["voltage"]))).toBe("voltage");
  });

  it("maps water_leak to water_leak", () => {
    expect(inferCategory("water_leak", new Set(["water_leak"]))).toBe("water_leak");
  });

  it("maps contact to contact_door", () => {
    expect(inferCategory("contact", new Set(["contact"]))).toBe("contact_door");
  });

  it("maps unknown properties to generic", () => {
    expect(inferCategory("unknown_prop", new Set(["unknown_prop"]))).toBe("generic");
    expect(inferCategory("linkquality", new Set(["linkquality"]))).toBe("generic");
  });

  describe("state property (context-dependent)", () => {
    it("maps state to light_state when device has brightness", () => {
      expect(inferCategory("state", new Set(["state", "brightness"]))).toBe("light_state");
    });

    it("maps state to light_state when device has color_temp", () => {
      expect(inferCategory("state", new Set(["state", "color_temp"]))).toBe("light_state");
    });

    it("maps state to light_state when parent expose type is light (on/off only)", () => {
      expect(inferCategory("state", new Set(["state"]), "light")).toBe("light_state");
    });

    it("maps state to generic when device has no light properties", () => {
      expect(inferCategory("state", new Set(["state", "power"]))).toBe("generic");
    });

    it("maps state to generic for a switch (no brightness/color)", () => {
      expect(inferCategory("state", new Set(["state"]))).toBe("generic");
    });

    it("maps state to light_state for a switch expose type", () => {
      expect(inferCategory("state", new Set(["state"]), "switch")).toBe("light_state");
    });
  });
});

describe("collectProperties", () => {
  it("collects flat properties", () => {
    const exposes: Z2MExpose[] = [
      { type: "numeric", property: "temperature", access: 1 },
      { type: "numeric", property: "humidity", access: 1 },
    ];
    expect(collectProperties(exposes)).toEqual(new Set(["temperature", "humidity"]));
  });

  it("collects nested properties from features", () => {
    const exposes: Z2MExpose[] = [
      {
        type: "composite",
        property: "light",
        features: [
          { type: "binary", property: "state", access: 3 },
          { type: "numeric", property: "brightness", access: 3 },
        ],
      },
    ];
    const props = collectProperties(exposes);
    expect(props).toContain("light");
    expect(props).toContain("state");
    expect(props).toContain("brightness");
  });

  it("handles exposes without property", () => {
    const exposes: Z2MExpose[] = [{ type: "binary", access: 1 }];
    expect(collectProperties(exposes)).toEqual(new Set());
  });
});

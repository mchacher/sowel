import { describe, it, expect } from "vitest";
import { brightnessPercent, brightnessScale, ZIGBEE_BRIGHTNESS_SCALE } from "./brightness";

describe("brightness scale (issue #933)", () => {
  it("reads the scale the order declares", () => {
    expect(brightnessScale({ min: 0, max: 100 })).toEqual({ min: 0, max: 100 });
  });

  it("falls back to Zigbee's 0–254 when nothing is declared", () => {
    expect(brightnessScale(undefined)).toEqual(ZIGBEE_BRIGHTNESS_SCALE);
    expect(brightnessScale({})).toEqual(ZIGBEE_BRIGHTNESS_SCALE);
    expect(brightnessScale({ max: 254 })).toEqual(ZIGBEE_BRIGHTNESS_SCALE);
  });

  it("falls back on a degenerate declaration", () => {
    expect(brightnessScale({ min: 0, max: 0 })).toEqual(ZIGBEE_BRIGHTNESS_SCALE);
    expect(brightnessScale({ min: 100, max: 1 })).toEqual(ZIGBEE_BRIGHTNESS_SCALE);
  });

  it("a 0–100 dimmer at full brightness reads 100 %, not 39 %", () => {
    expect(brightnessPercent(100, brightnessScale({ min: 0, max: 100 }))).toBe(100);
    expect(brightnessPercent(100, ZIGBEE_BRIGHTNESS_SCALE)).toBe(39);
  });

  it("honours a non-zero minimum and clamps out-of-range values", () => {
    const scale = brightnessScale({ min: 1, max: 101 });
    expect(brightnessPercent(51, scale)).toBe(50);
    expect(brightnessPercent(300, scale)).toBe(100);
    expect(brightnessPercent(-5, scale)).toBe(0);
  });
});

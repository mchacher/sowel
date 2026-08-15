import { describe, it, expect } from "vitest";
import i18n from "../../i18n";
import { formatBooleanSensor, isBooleanActive } from "./sensorUtils";

// Issue #325 — boolean-category sensor values arrive from integrations as
// booleans, ON/OFF strings (any case), 1/0, or OPEN/CLOSED for contacts.
// These pin the shared normalization authority used by both the desktop
// SensorValues and the mobile widget card.

const t = i18n.t.bind(i18n);

describe("isBooleanActive", () => {
  it("recognizes the boolean-ish active shapes on a motion sensor", () => {
    for (const v of [true, "ON", "on", 1, "1", "TRUE"]) {
      expect(isBooleanActive("motion", v), String(v)).toBe(true);
    }
    for (const v of [false, "OFF", "off", 0, "FALSE", "garbage", null, undefined]) {
      expect(isBooleanActive("motion", v), String(v)).toBe(false);
    }
  });

  it("applies the contact polarity (false/OFF/OPEN = open = active)", () => {
    for (const v of [false, "OFF", "off", 0, "OPEN", "open"]) {
      expect(isBooleanActive("contact_door", v), String(v)).toBe(true);
    }
    for (const v of [true, "ON", "CLOSED", "closed", 1, "garbage"]) {
      expect(isBooleanActive("contact_door", v), String(v)).toBe(false);
    }
  });
});

describe("formatBooleanSensor", () => {
  it("labels motion whatever the wire shape", () => {
    const detected = t("category.value.motion.detected") as string;
    const clear = t("category.value.motion.clear") as string;
    expect(formatBooleanSensor("motion", true, t)).toBe(detected);
    expect(formatBooleanSensor("motion", "on", t)).toBe(detected);
    expect(formatBooleanSensor("motion", 1, t)).toBe(detected);
    expect(formatBooleanSensor("motion", "OFF", t)).toBe(clear);
  });

  it("labels contacts with the open/closed polarity, incl. explicit OPEN/CLOSED strings", () => {
    const opened = t("controls.opened") as string;
    const closed = t("controls.closed") as string;
    expect(formatBooleanSensor("contact_door", false, t)).toBe(opened);
    expect(formatBooleanSensor("contact_door", "OPEN", t)).toBe(opened);
    expect(formatBooleanSensor("contact_door", "off", t)).toBe(opened);
    expect(formatBooleanSensor("contact_door", true, t)).toBe(closed);
    expect(formatBooleanSensor("contact_door", "CLOSED", t)).toBe(closed);
    // Unrecognized values keep the historical "closed" fallback — an odd
    // string must never invert the label.
    expect(formatBooleanSensor("contact_door", "weird", t)).toBe(closed);
  });
});

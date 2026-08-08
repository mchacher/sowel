import { describe, it, expect } from "vitest";
import { parseWireValue, resolveWireValue } from "./order-wire-value.js";

describe("resolveWireValue", () => {
  it("maps booleans onto declared wire values", () => {
    expect(resolveWireValue(true, "ON", "OFF")).toBe("ON");
    expect(resolveWireValue(false, "ON", "OFF")).toBe("OFF");
  });

  it("maps the wire values themselves (identity, case-insensitive)", () => {
    expect(resolveWireValue("ON", "ON", "OFF")).toBe("ON");
    expect(resolveWireValue("off", "ON", "OFF")).toBe("OFF");
    expect(resolveWireValue(" On ", "ON", "OFF")).toBe("ON");
  });

  it("accepts common boolean-ish strings and numbers", () => {
    expect(resolveWireValue("true", "ON", "OFF")).toBe("ON");
    expect(resolveWireValue("false", "ON", "OFF")).toBe("OFF");
    expect(resolveWireValue("1", "ON", "OFF")).toBe("ON");
    expect(resolveWireValue("0", "ON", "OFF")).toBe("OFF");
    expect(resolveWireValue(1, "ON", "OFF")).toBe("ON");
    expect(resolveWireValue(0, "ON", "OFF")).toBe("OFF");
  });

  it("supports non-standard wire values", () => {
    expect(resolveWireValue(true, "LOCK", "UNLOCK")).toBe("LOCK");
    expect(resolveWireValue("unlock", "LOCK", "UNLOCK")).toBe("UNLOCK");
    expect(resolveWireValue(false, true, false)).toBe(false);
  });

  it("passes values through when wire values are not declared", () => {
    expect(resolveWireValue(true, undefined, undefined)).toBe(true);
    expect(resolveWireValue("ON", "ON", undefined)).toBe("ON");
    expect(resolveWireValue(false, undefined, "OFF")).toBe(false);
  });

  it("passes non-boolean-ish values through untouched", () => {
    expect(resolveWireValue("TOGGLE", "ON", "OFF")).toBe("TOGGLE");
    expect(resolveWireValue(42, "ON", "OFF")).toBe(42);
    expect(resolveWireValue(null, "ON", "OFF")).toBe(null);
    expect(resolveWireValue({ state: true }, "ON", "OFF")).toEqual({ state: true });
  });
});

describe("parseWireValue", () => {
  it("parses JSON-encoded primitives", () => {
    expect(parseWireValue('"ON"')).toBe("ON");
    expect(parseWireValue("true")).toBe(true);
    expect(parseWireValue("1")).toBe(1);
  });

  it("returns undefined for null/undefined and non-primitive JSON", () => {
    expect(parseWireValue(null)).toBeUndefined();
    expect(parseWireValue(undefined)).toBeUndefined();
    expect(parseWireValue('{"a":1}')).toBeUndefined();
  });

  it("falls back to the raw string for unencoded values", () => {
    expect(parseWireValue("ON")).toBe("ON");
  });
});

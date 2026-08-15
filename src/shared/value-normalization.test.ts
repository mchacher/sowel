import { describe, expect, it } from "vitest";
import { normalizeValue } from "./value-normalization.js";

describe("normalizeValue", () => {
  describe("null/undefined passthrough (any type)", () => {
    it("passes null through unflagged", () => {
      expect(normalizeValue(null, "boolean")).toEqual({ value: null, flagged: false });
      expect(normalizeValue(null, "number")).toEqual({ value: null, flagged: false });
    });
    it("passes undefined through unflagged", () => {
      expect(normalizeValue(undefined, "enum", ["ON", "OFF"])).toEqual({
        value: undefined,
        flagged: false,
      });
    });
  });

  describe("boolean", () => {
    it("keeps native booleans", () => {
      expect(normalizeValue(true, "boolean")).toEqual({ value: true, flagged: false });
      expect(normalizeValue(false, "boolean")).toEqual({ value: false, flagged: false });
    });
    it("coerces truthy vocabularies (trim + case-insensitive)", () => {
      for (const v of ["ON", "on", " On ", "true", "TRUE", "1"]) {
        expect(normalizeValue(v, "boolean")).toEqual({ value: true, flagged: false });
      }
      expect(normalizeValue(1, "boolean")).toEqual({ value: true, flagged: false });
    });
    it("coerces falsy vocabularies", () => {
      for (const v of ["OFF", "off", " Off ", "false", "FALSE", "0"]) {
        expect(normalizeValue(v, "boolean")).toEqual({ value: false, flagged: false });
      }
      expect(normalizeValue(0, "boolean")).toEqual({ value: false, flagged: false });
    });
    it("flags polarity-ambiguous vocabularies and keeps them raw", () => {
      for (const v of ["OPEN", "CLOSED", "DETECTED", "TOGGLE"]) {
        expect(normalizeValue(v, "boolean")).toEqual({ value: v, flagged: true });
      }
    });
    it("flags non-coercible values", () => {
      expect(normalizeValue(2, "boolean")).toEqual({ value: 2, flagged: true });
      expect(normalizeValue({}, "boolean")).toEqual({ value: {}, flagged: true });
    });
  });

  describe("number", () => {
    it("keeps finite numbers", () => {
      expect(normalizeValue(42.5, "number")).toEqual({ value: 42.5, flagged: false });
      expect(normalizeValue(0, "number")).toEqual({ value: 0, flagged: false });
      expect(normalizeValue(-3, "number")).toEqual({ value: -3, flagged: false });
    });
    it("parses numeric strings (trimmed)", () => {
      expect(normalizeValue("42.5", "number")).toEqual({ value: 42.5, flagged: false });
      expect(normalizeValue(" 7 ", "number")).toEqual({ value: 7, flagged: false });
      expect(normalizeValue("-0.5", "number")).toEqual({ value: -0.5, flagged: false });
    });
    it("flags non-numeric input and keeps it raw", () => {
      expect(normalizeValue("abc", "number")).toEqual({ value: "abc", flagged: true });
      expect(normalizeValue("", "number")).toEqual({ value: "", flagged: true });
      expect(normalizeValue(true, "number")).toEqual({ value: true, flagged: true });
      expect(normalizeValue(Number.NaN, "number")).toEqual({
        value: Number.NaN,
        flagged: true,
      });
      expect(normalizeValue(Number.POSITIVE_INFINITY, "number")).toEqual({
        value: Number.POSITIVE_INFINITY,
        flagged: true,
      });
    });
  });

  describe("enum", () => {
    it("recases to the canonical enum value (case-insensitive match)", () => {
      expect(normalizeValue("on", "enum", ["ON", "OFF"])).toEqual({
        value: "ON",
        flagged: false,
      });
      expect(normalizeValue(" Off ", "enum", ["ON", "OFF"])).toEqual({
        value: "OFF",
        flagged: false,
      });
    });
    it("keeps exact matches untouched", () => {
      expect(normalizeValue("heat", "enum", ["heat", "cool"])).toEqual({
        value: "heat",
        flagged: false,
      });
    });
    it("flags values outside the declared enum", () => {
      expect(normalizeValue("HEAT", "enum", ["ON", "OFF"])).toEqual({
        value: "HEAT",
        flagged: true,
      });
    });
    it("passes strings through when no enumValues are declared", () => {
      expect(normalizeValue("anything", "enum")).toEqual({
        value: "anything",
        flagged: false,
      });
      expect(normalizeValue("anything", "enum", [])).toEqual({
        value: "anything",
        flagged: false,
      });
    });
    it("flags non-string values", () => {
      expect(normalizeValue(1, "enum", ["ON", "OFF"])).toEqual({ value: 1, flagged: true });
      expect(normalizeValue(true, "enum", ["ON", "OFF"])).toEqual({
        value: true,
        flagged: true,
      });
    });
  });

  describe("text", () => {
    it("keeps strings", () => {
      expect(normalizeValue("hello", "text")).toEqual({ value: "hello", flagged: false });
    });
    it("stringifies primitives", () => {
      expect(normalizeValue(42, "text")).toEqual({ value: "42", flagged: false });
      expect(normalizeValue(true, "text")).toEqual({ value: "true", flagged: false });
    });
    it("flags objects", () => {
      expect(normalizeValue({ a: 1 }, "text")).toEqual({ value: { a: 1 }, flagged: true });
    });
  });

  describe("json", () => {
    it("passes anything through unflagged", () => {
      const obj = { mode: "ON", time: 3 };
      expect(normalizeValue(obj, "json")).toEqual({ value: obj, flagged: false });
      expect(normalizeValue([1, 2], "json")).toEqual({ value: [1, 2], flagged: false });
      expect(normalizeValue("raw", "json")).toEqual({ value: "raw", flagged: false });
    });
  });
});

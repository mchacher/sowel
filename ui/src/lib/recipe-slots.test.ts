import { describe, it, expect } from "vitest";
import { isSlotDisabled } from "./recipe-slots";
import type { RecipeSlotDef } from "../types";

const kind: RecipeSlotDef = {
  id: "k",
  name: "Kind",
  description: "",
  type: "select",
  required: true,
  defaultValue: "time",
  options: [
    { value: "time", label: "Fixed time" },
    { value: "sunset", label: "Sunset" },
  ],
};
const timeSlot: RecipeSlotDef = {
  id: "t",
  name: "Time",
  description: "",
  type: "time",
  required: false,
  disabledWhen: { slot: "k", equals: ["sunrise", "sunset"] },
};
const offsetSlot: RecipeSlotDef = {
  id: "o",
  name: "Offset",
  description: "",
  type: "number",
  required: false,
  disabledWhen: { slot: "k", equals: "time" },
};
const all = [kind, timeSlot, offsetSlot];

describe("isSlotDisabled", () => {
  it("returns false for a slot without disabledWhen", () => {
    expect(isSlotDisabled(kind, { k: "sunset" }, all)).toBe(false);
  });

  it("disables the time field when kind is sunset", () => {
    expect(isSlotDisabled(timeSlot, { k: "sunset" }, all)).toBe(true);
  });

  it("enables the time field when kind is a fixed time", () => {
    expect(isSlotDisabled(timeSlot, { k: "time" }, all)).toBe(false);
  });

  it("uses the referenced slot's defaultValue when its param is untouched", () => {
    // kind defaults to "time" -> offset (disabled when kind==time) is disabled
    expect(isSlotDisabled(offsetSlot, {}, all)).toBe(true);
    // ...and the time field is enabled by default
    expect(isSlotDisabled(timeSlot, {}, all)).toBe(false);
  });

  it("disables the offset field only for fixed time", () => {
    expect(isSlotDisabled(offsetSlot, { k: "sunset" }, all)).toBe(false);
    expect(isSlotDisabled(offsetSlot, { k: "time" }, all)).toBe(true);
  });
});

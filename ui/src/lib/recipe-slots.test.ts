import { describe, it, expect } from "vitest";
import { isSlotHidden } from "./recipe-slots";
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
  hiddenWhen: { slot: "k", equals: ["sunrise", "sunset"] },
};
const offsetSlot: RecipeSlotDef = {
  id: "o",
  name: "Offset",
  description: "",
  type: "number",
  required: false,
  hiddenWhen: { slot: "k", equals: "time" },
};
const all = [kind, timeSlot, offsetSlot];

describe("isSlotHidden", () => {
  it("returns false for a slot without hiddenWhen", () => {
    expect(isSlotHidden(kind, { k: "sunset" }, all)).toBe(false);
  });

  it("hides the time field when kind is sunset", () => {
    expect(isSlotHidden(timeSlot, { k: "sunset" }, all)).toBe(true);
  });

  it("shows the time field when kind is a fixed time", () => {
    expect(isSlotHidden(timeSlot, { k: "time" }, all)).toBe(false);
  });

  it("uses the referenced slot's defaultValue when its param is untouched", () => {
    // kind defaults to "time" -> offset (hidden when kind==time) is hidden,
    // and the time field is shown.
    expect(isSlotHidden(offsetSlot, {}, all)).toBe(true);
    expect(isSlotHidden(timeSlot, {}, all)).toBe(false);
  });

  it("hides the offset field only for fixed time", () => {
    expect(isSlotHidden(offsetSlot, { k: "sunset" }, all)).toBe(false);
    expect(isSlotHidden(offsetSlot, { k: "time" }, all)).toBe(true);
  });
});

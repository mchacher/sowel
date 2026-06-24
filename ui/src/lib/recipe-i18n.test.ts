import { describe, it, expect } from "vitest";
import { recipeSlotOptionLabel } from "./recipe-i18n";
import type { RecipeInfo, RecipeSlotDef } from "../types";

const slot: RecipeSlotDef = {
  id: "kind",
  name: "Kind",
  description: "Pick a kind",
  type: "select",
  required: true,
  options: [
    { value: "time", label: "Fixed time" },
    { value: "sunset", label: "Sunset" },
  ],
};

function recipe(i18n?: RecipeInfo["i18n"]): RecipeInfo {
  return { id: "r", name: "R", description: "d", slots: [slot], i18n } as RecipeInfo;
}

const FR_I18N: RecipeInfo["i18n"] = {
  fr: {
    name: "R",
    description: "d",
    slots: { kind: { name: "Type", description: "", options: { sunset: "Coucher du soleil" } } },
  },
};

describe("recipeSlotOptionLabel", () => {
  it("returns the per-language i18n label when present", () => {
    expect(recipeSlotOptionLabel(recipe(FR_I18N), slot, "sunset", "fr")).toBe("Coucher du soleil");
  });

  it("falls back to the option's English label when no i18n is provided", () => {
    expect(recipeSlotOptionLabel(recipe(), slot, "sunset", "fr")).toBe("Sunset");
  });

  it("falls back to the English label for a language with no translation", () => {
    expect(recipeSlotOptionLabel(recipe(FR_I18N), slot, "sunset", "de")).toBe("Sunset");
  });

  it("falls back to the option's English label when only some options are translated", () => {
    // `time` has no FR override in FR_I18N → English label.
    expect(recipeSlotOptionLabel(recipe(FR_I18N), slot, "time", "fr")).toBe("Fixed time");
  });

  it("falls back to the raw value when neither i18n nor a matching option label exists", () => {
    expect(recipeSlotOptionLabel(recipe(), slot, "unknown", "fr")).toBe("unknown");
  });
});

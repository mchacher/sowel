import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChefHat } from "lucide-react";
import { recipeIcon, RECIPE_ICONS } from "./recipe-icons";

// Spec 198 — every official recipe shows its own icon on the zone page.

const registry = JSON.parse(
  readFileSync(new URL("../../../plugins/registry.json", import.meta.url), "utf8"),
) as { type?: string; icon?: string; id: string }[];

const recipeIcons = registry
  .filter((p) => p.type === "recipe" && typeof p.icon === "string")
  .map((p) => [p.id, p.icon as string] as const);

describe("recipeIcon", () => {
  it("reads at least one recipe from the registry", () => {
    expect(recipeIcons.length).toBeGreaterThan(0);
  });

  it.each(recipeIcons)("resolves the registry icon of %s (%s)", (_id, icon) => {
    expect(RECIPE_ICONS[icon]).toBeDefined();
    expect(recipeIcon(icon)).toBe(RECIPE_ICONS[icon]);
  });

  it("falls back to the chef hat for an unknown or missing name", () => {
    expect(recipeIcon("NotAnIcon")).toBe(ChefHat);
    expect(recipeIcon("toString")).toBe(ChefHat);
    expect(recipeIcon(undefined)).toBe(ChefHat);
    expect(recipeIcon("")).toBe(ChefHat);
  });
});

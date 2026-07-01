import { describe, it, expect } from "vitest";
import {
  deriveSourceZoneFilter,
  recipeInstanceEquipmentNames,
  recipeInstanceLabel,
} from "./notif-mapping";
import type { EquipmentWithDetails, RecipeInstance, RecipeInfo } from "../types";

const equipments = [
  { id: "eq-washer", zoneId: "zone-cave" },
  { id: "eq-lamp", zoneId: "zone-salon" },
] as unknown as EquipmentWithDetails[];

const recipeInstances = [
  { id: "rec-washer", recipeId: "state-watch", params: { zone: "zone-cave" } },
  { id: "rec-garage", recipeId: "state-watch", params: { zone: "zone-garage" } },
] as unknown as RecipeInstance[];

describe("deriveSourceZoneFilter", () => {
  it("returns the recipe instance's zone (the reported cave bug)", () => {
    expect(
      deriveSourceZoneFilter(
        { sourceType: "recipe", sourceId: "rec-washer" },
        equipments,
        recipeInstances,
      ),
    ).toBe("zone-cave");
  });

  it("returns the equipment's zone", () => {
    expect(
      deriveSourceZoneFilter(
        { sourceType: "equipment", sourceId: "eq-lamp" },
        equipments,
        recipeInstances,
      ),
    ).toBe("zone-salon");
  });

  it("returns empty for a zone source (no filter needed)", () => {
    expect(
      deriveSourceZoneFilter(
        { sourceType: "zone", sourceId: "zone-cave" },
        equipments,
        recipeInstances,
      ),
    ).toBe("");
  });

  it("returns empty when the source cannot be resolved (data not loaded yet)", () => {
    expect(
      deriveSourceZoneFilter(
        { sourceType: "recipe", sourceId: "unknown" },
        equipments,
        recipeInstances,
      ),
    ).toBe("");
    expect(deriveSourceZoneFilter({ sourceType: "equipment", sourceId: "unknown" }, [], [])).toBe(
      "",
    );
  });

  it("returns empty when a recipe instance has no zone param", () => {
    const instances = [{ id: "rec-x", recipeId: "r", params: {} }] as unknown as RecipeInstance[];
    expect(deriveSourceZoneFilter({ sourceType: "recipe", sourceId: "rec-x" }, [], instances)).toBe(
      "",
    );
  });
});

describe("recipeInstanceEquipmentNames / recipeInstanceLabel", () => {
  const eqs = [
    { id: "eq-washer", name: "Machine à laver", zoneId: "zone-cave" },
    { id: "eq-l1", name: "Plafonnier", zoneId: "zone-atelier" },
    { id: "eq-l2", name: "Établi", zoneId: "zone-atelier" },
  ] as unknown as EquipmentWithDetails[];

  const recipes = [
    {
      id: "state-watch",
      name: "State Watch",
      slots: [
        { id: "zone", type: "zone" },
        { id: "equipment", type: "equipment" },
        { id: "dataKey", type: "data-key" },
      ],
    },
    {
      id: "motion-light",
      name: "Motion Light",
      slots: [
        { id: "zone", type: "zone" },
        { id: "lights", type: "equipment", list: true },
      ],
    },
  ] as unknown as RecipeInfo[];

  it("resolves a single equipment slot to its name", () => {
    const inst = {
      id: "i1",
      recipeId: "state-watch",
      params: { zone: "zone-cave", equipment: "eq-washer" },
    } as unknown as RecipeInstance;
    expect(recipeInstanceEquipmentNames(inst, recipes, eqs)).toEqual(["Machine à laver"]);
    expect(recipeInstanceLabel(inst, recipes, eqs)).toBe("State Watch (Machine à laver)");
  });

  it("resolves a list equipment slot to all names, deduped", () => {
    const inst = {
      id: "i2",
      recipeId: "motion-light",
      params: { zone: "zone-atelier", lights: ["eq-l1", "eq-l2", "eq-l1"] },
    } as unknown as RecipeInstance;
    expect(recipeInstanceEquipmentNames(inst, recipes, eqs)).toEqual(["Plafonnier", "Établi"]);
    expect(recipeInstanceLabel(inst, recipes, eqs)).toBe("Motion Light (Plafonnier, Établi)");
  });

  it("falls back to the recipe name when no equipment is bound / unknown recipe", () => {
    const noEq = {
      id: "i3",
      recipeId: "state-watch",
      params: { zone: "zone-cave" },
    } as unknown as RecipeInstance;
    expect(recipeInstanceLabel(noEq, recipes, eqs)).toBe("State Watch");
    const unknown = { id: "i4", recipeId: "ghost", params: {} } as unknown as RecipeInstance;
    expect(recipeInstanceLabel(unknown, recipes, eqs)).toBe("ghost");
  });
});

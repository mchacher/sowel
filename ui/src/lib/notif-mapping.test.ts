import { describe, it, expect } from "vitest";
import { deriveSourceZoneFilter } from "./notif-mapping";
import type { EquipmentWithDetails, RecipeInstance } from "../types";

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

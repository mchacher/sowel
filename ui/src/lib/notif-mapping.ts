import type {
  NotificationPublisherMapping,
  EquipmentWithDetails,
  RecipeInstance,
  RecipeInfo,
} from "../types";

/**
 * The zone dropdown in the notification mapping editor is only a selection aid —
 * it is not stored on the mapping (which keeps sourceType/sourceId/sourceKey).
 * Re-derive it from the mapping's source so re-editing shows the source's zone
 * instead of defaulting to "all zones".
 */
export function deriveSourceZoneFilter(
  mapping: Pick<NotificationPublisherMapping, "sourceType" | "sourceId">,
  equipments: EquipmentWithDetails[],
  recipeInstances: RecipeInstance[],
): string {
  if (mapping.sourceType === "equipment") {
    return equipments.find((e) => e.id === mapping.sourceId)?.zoneId ?? "";
  }
  if (mapping.sourceType === "recipe") {
    const zone = recipeInstances.find((i) => i.id === mapping.sourceId)?.params.zone;
    return typeof zone === "string" ? zone : "";
  }
  return "";
}

/**
 * The equipment(s) a recipe instance targets, resolved to names. Reads the
 * recipe template's `equipment`-typed slots and looks up the ids the instance
 * bound to them. Deduplicated, order-preserving.
 */
export function recipeInstanceEquipmentNames(
  inst: RecipeInstance,
  recipes: RecipeInfo[],
  equipments: EquipmentWithDetails[],
): string[] {
  const recipe = recipes.find((r) => r.id === inst.recipeId);
  if (!recipe) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const slot of recipe.slots) {
    if (slot.type !== "equipment") continue;
    const raw = inst.params[slot.id];
    const ids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const id of ids) {
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      const eq = equipments.find((e) => e.id === id);
      if (eq) names.push(eq.name);
    }
  }
  return names;
}

/**
 * Dropdown label for a recipe instance: the recipe name plus the equipment(s)
 * it applies to, so instances of the same recipe are distinguishable. E.g.
 * "State Watch (Machine à laver)".
 */
export function recipeInstanceLabel(
  inst: RecipeInstance,
  recipes: RecipeInfo[],
  equipments: EquipmentWithDetails[],
): string {
  const base = recipes.find((r) => r.id === inst.recipeId)?.name ?? inst.recipeId;
  const eqNames = recipeInstanceEquipmentNames(inst, recipes, equipments);
  return eqNames.length > 0 ? `${base} (${eqNames.join(", ")})` : base;
}

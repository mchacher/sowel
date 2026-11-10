import type { RecipeActionDef, RecipeInfo, RecipeInstance } from "../types";

/** One mode to show on an equipment card: which instance and recipe, which action, which option. */
export interface EquipmentMode {
  key: string;
  instance: RecipeInstance;
  recipe: RecipeInfo;
  action: RecipeActionDef;
  option: RecipeActionDef["options"][number];
}

/**
 * The modes of the recipes that drive an equipment (spec 201), for its
 * Dashboard card. A recipe names the slots its mode applies to in
 * `action.targets`; nothing is inferred from the other equipment slots, which
 * a recipe may only read (the cocoon buttons of presence-thermostat).
 *
 * One entry per enabled instance and cycle action whose target slot holds the
 * equipment and whose state value is one of the action's options, oldest
 * instance first.
 */
export function modesForEquipment(
  equipmentId: string,
  instances: readonly RecipeInstance[],
  recipes: readonly RecipeInfo[],
): EquipmentMode[] {
  const modes: { mode: EquipmentMode; createdAt: string }[] = [];
  for (const instance of instances) {
    if (!instance.enabled) continue;
    const recipe = recipes.find((r) => r.id === instance.recipeId);
    if (!recipe?.actions) continue;
    for (const action of recipe.actions) {
      if (action.type !== "cycle" || !action.targets?.length) continue;
      const held = action.targets.some((slotId) => {
        const slot = recipe.slots.find((s) => s.id === slotId);
        if (slot?.type !== "equipment") return false;
        const value = instance.params[slotId];
        return Array.isArray(value) ? value.includes(equipmentId) : value === equipmentId;
      });
      if (!held) continue;
      const value = instance.state?.[action.stateKey];
      const option = action.options.find((o) => o.value === value);
      if (!option) continue;
      modes.push({
        mode: { key: `${instance.id}:${action.id}`, instance, recipe, action, option },
        createdAt: instance.createdAt,
      });
    }
  }
  // A stable sort keeps the action order within one instance.
  return modes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((m) => m.mode);
}

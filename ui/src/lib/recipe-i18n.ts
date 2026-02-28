import type { RecipeInfo, RecipeSlotDef } from "../types";

/**
 * Resolve a recipe's translated name for the given language.
 * Falls back to the English name embedded in the recipe definition.
 */
export function recipeName(recipe: RecipeInfo, lang: string): string {
  return recipe.i18n?.[lang]?.name ?? recipe.name;
}

/**
 * Resolve a recipe's translated description for the given language.
 * Falls back to the English description embedded in the recipe definition.
 */
export function recipeDescription(recipe: RecipeInfo, lang: string): string {
  return recipe.i18n?.[lang]?.description ?? recipe.description;
}

/**
 * Resolve a slot's translated name for the given language.
 * Falls back to the English name embedded in the slot definition.
 */
export function recipeSlotName(recipe: RecipeInfo, slot: RecipeSlotDef, lang: string): string {
  return recipe.i18n?.[lang]?.slots?.[slot.id]?.name ?? slot.name;
}

/**
 * Resolve a slot's translated description for the given language.
 * Falls back to the English description embedded in the slot definition.
 */
export function recipeSlotDescription(recipe: RecipeInfo, slot: RecipeSlotDef, lang: string): string {
  return recipe.i18n?.[lang]?.slots?.[slot.id]?.description ?? slot.description;
}

/**
 * Resolve a group's translated label for the given language.
 * Falls back to the group key itself.
 */
export function recipeGroupLabel(recipe: RecipeInfo, groupKey: string, lang: string): string {
  return recipe.i18n?.[lang]?.groups?.[groupKey] ?? groupKey;
}

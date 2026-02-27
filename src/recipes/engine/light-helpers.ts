// ============================================================
// Shared light helpers (used by Motion Light, Switch Light, etc.)
// ============================================================

import type { RecipeContext } from "./recipe.js";

/**
 * Check if any light in the list is currently ON.
 */
export function isAnyLightOn(lightIds: string[], ctx: RecipeContext): boolean {
  for (const lightId of lightIds) {
    const bindings = ctx.equipmentManager.getDataBindingsWithValues(lightId);
    const stateBinding = bindings.find((b) => b.alias === "state" || b.category === "light_state");
    if (stateBinding && (stateBinding.value === true || stateBinding.value === "ON")) {
      return true;
    }
  }
  return false;
}

/**
 * Turn on all lights via their "state" order binding.
 * Returns an array of error messages (empty if all succeeded).
 */
export function turnOnLights(lightIds: string[], ctx: RecipeContext): string[] {
  const errors: string[] = [];
  for (const lightId of lightIds) {
    try {
      ctx.equipmentManager.executeOrder(lightId, "state", "ON");
    } catch (err) {
      errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

/**
 * Turn off all lights via their "state" order binding.
 * Returns an array of error messages (empty if all succeeded).
 */
export function turnOffLights(lightIds: string[], ctx: RecipeContext): string[] {
  const errors: string[] = [];
  for (const lightId of lightIds) {
    try {
      ctx.equipmentManager.executeOrder(lightId, "state", "OFF");
    } catch (err) {
      errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

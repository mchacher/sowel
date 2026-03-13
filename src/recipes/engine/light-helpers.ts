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
    if (
      stateBinding &&
      (stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the actual ON or OFF value from the order binding's enumValues.
 * Falls back to uppercase "ON"/"OFF" (Z2M convention) if no enum match found.
 */
function resolveEnumValue(lightId: string, ctx: RecipeContext, target: "on" | "off"): string {
  const equipment = ctx.equipmentManager.getByIdWithDetails(lightId);
  const stateOrder = equipment?.orderBindings.find((ob) => ob.alias === "state");
  const match = stateOrder?.enumValues?.find((v) => v.toLowerCase() === target);
  return match ?? target.toUpperCase();
}

/**
 * Turn on all lights via their "state" order binding.
 * Returns an array of error messages (empty if all succeeded).
 */
export function turnOnLights(lightIds: string[], ctx: RecipeContext): string[] {
  const errors: string[] = [];
  for (const lightId of lightIds) {
    try {
      ctx.equipmentManager
        .executeOrder(lightId, "state", resolveEnumValue(lightId, ctx, "on"))
        .catch(() => {});
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
      ctx.equipmentManager
        .executeOrder(lightId, "state", resolveEnumValue(lightId, ctx, "off"))
        .catch(() => {});
    } catch (err) {
      errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

/**
 * Set brightness on all lights that have a "brightness" order binding.
 * Silently skips lights without brightness capability (light_onoff).
 * Returns an array of error messages (empty if all succeeded).
 */
export function setLightsBrightness(
  lightIds: string[],
  ctx: RecipeContext,
  brightness: number,
): string[] {
  const errors: string[] = [];
  for (const lightId of lightIds) {
    const equipment = ctx.equipmentManager.getByIdWithDetails(lightId);
    if (!equipment) continue;
    const hasBrightnessOrder = equipment.orderBindings.some((ob) => ob.alias === "brightness");
    if (!hasBrightnessOrder) continue;
    try {
      ctx.equipmentManager.executeOrder(lightId, "brightness", brightness).catch(() => {});
    } catch (err) {
      errors.push(`${lightId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

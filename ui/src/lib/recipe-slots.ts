import type { RecipeSlotDef } from "../types";

/**
 * Whether a recipe-form slot should be greyed out (disabled) given the current
 * param values (spec 126). A slot declares `disabledWhen: { slot, equals }`; it
 * is disabled when the referenced sibling slot's effective value (its current
 * param, or its `defaultValue` when untouched) is one of `equals`.
 */
export function isSlotDisabled(
  slot: RecipeSlotDef,
  params: Record<string, unknown>,
  allSlots: readonly RecipeSlotDef[],
): boolean {
  const rule = slot.disabledWhen;
  if (!rule) return false;
  const ref = allSlots.find((s) => s.id === rule.slot);
  const value = params[rule.slot] ?? ref?.defaultValue;
  const expected = Array.isArray(rule.equals) ? rule.equals : [rule.equals];
  return expected.includes(value as string);
}

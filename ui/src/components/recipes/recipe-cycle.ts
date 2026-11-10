import type { TFunction } from "i18next";
import type { RecipeActionDef, RecipeInfo, RecipeInstance } from "../../types";

type CycleOption = RecipeActionDef["options"][number];

/**
 * The cycle a control walks: the options this instance actually offers, where
 * it stands right now, and where one press takes it — or `null` when there is
 * nothing to cycle (instance off, state key absent, a single option left).
 *
 * Extracted from the pill because the Dashboard tile fires the same cycle from
 * its whole card (spec 171). Two copies of this arithmetic would eventually
 * disagree about what a press sends, and the card would lie about the pill.
 */
export function resolveCycle(
  instance: RecipeInstance,
  action: RecipeActionDef,
): { options: CycleOption[]; value: string; current: CycleOption; next: CycleOption } | null {
  const value = instance.state?.[action.stateKey] as string | undefined;
  if (!value || !instance.enabled) return null;

  // #1210 — an option the recipe marks `requiresParam` is offered only when
  // that parameter is set. Declared by the recipe, never named here.
  const options = action.options.filter(
    (opt) => !opt.requiresParam || isSet(instance.params[opt.requiresParam]),
  );
  if (options.length < 2) return null;

  const currentIndex = options.findIndex((o) => o.value === value);
  return {
    options,
    value,
    current: options[currentIndex >= 0 ? currentIndex : 0],
    next: options[(currentIndex + 1) % options.length],
  };
}

/** An option's label, from the recipe's own i18n pack when it ships one. */
export function cycleOptionLabel(
  recipe: RecipeInfo,
  action: RecipeActionDef,
  option: CycleOption,
  lang: string,
  t: TFunction,
): string {
  const i18nPack = lang && recipe.i18n?.[lang];
  return i18nPack
    ? t(`recipes.actions.${action.id}.${option.value}`, { defaultValue: option.label })
    : option.label;
}

/** Absent, null, an empty string and an empty list are unset; anything else is set. */
function isSet(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

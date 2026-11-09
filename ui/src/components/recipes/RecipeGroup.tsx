import { useTranslation } from "react-i18next";
import type { RecipeInfo, RecipeInstance } from "../../types";
import { recipeName } from "../../lib/recipe-i18n";
import { isInstanceInAlarm } from "../../lib/recipe-rows";
import { RecipeIconTile } from "./RecipeIconTile";
import { RecipeInstanceRow } from "./RecipeInstanceRow";

/**
 * Two or more instances of one recipe in a zone (spec 198): the recipe's name
 * once, then one line per instance with its own switch. The header carries
 * the alarm dot when any of its instances is in alarm.
 */
export function RecipeGroup({
  recipeId,
  instances,
  recipes,
  zoneId,
}: {
  recipeId: string;
  instances: RecipeInstance[];
  recipes: RecipeInfo[];
  zoneId: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const recipe = recipes.find((r) => r.id === recipeId);
  const name = recipe ? recipeName(recipe, lang) : recipeId;
  const alarm = instances.some(isInstanceInAlarm);
  return (
    <div role="group" aria-label={name}>
      <div className="grid grid-cols-[32px_1fr] gap-x-[0.85rem] items-center px-[1.1rem] pt-2.5 pb-1">
        <RecipeIconTile icon={recipe?.icon} enabled alarm={alarm} />
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-body font-medium text-text truncate">{name}</span>
          <span className="text-caption text-text-tertiary flex-shrink-0">
            <span aria-hidden="true">{instances.length}</span>
            <span className="sr-only">
              {t("recipes.instanceCount", { count: instances.length })}
            </span>
          </span>
        </div>
      </div>
      {instances.map((inst) => (
        <RecipeInstanceRow
          key={inst.id}
          instance={inst}
          recipes={recipes}
          zoneId={zoneId}
          variant="child"
        />
      ))}
    </div>
  );
}

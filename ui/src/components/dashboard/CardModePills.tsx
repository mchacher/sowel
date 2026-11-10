import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRecipes } from "../../store/useRecipes";
import { modesForEquipment } from "../../lib/recipe-target-modes";
import { modePillColors } from "../../lib/recipe-mode-colors";
import { cycleOptionLabel } from "../recipes/recipe-cycle";

const SIZE = {
  md: "px-2 py-0.5",
  sm: "px-1.5 leading-4",
} as const;

/**
 * The mode of the recipes driving an equipment, on its Dashboard card
 * (spec 201): « Cocoon » on the stove. Display only; the mode is changed on
 * the zone page or the recipe tile.
 *
 * Placed by its parent's title block (`relative`): just under it, on the
 * left, over the top of the card body, so the title stays centred and whole
 * and the card keeps its height (mockup option B2).
 */
export function CardModePills({
  equipmentId,
  size = "md",
}: {
  equipmentId: string | null;
  size?: keyof typeof SIZE;
}) {
  const { t, i18n } = useTranslation();
  const instances = useRecipes((s) => s.instances);
  const recipes = useRecipes((s) => s.recipes);
  const modes = useMemo(
    () => (equipmentId ? modesForEquipment(equipmentId, instances, recipes) : []),
    [equipmentId, instances, recipes],
  );
  if (modes.length === 0) return null;

  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  return (
    <span className="absolute left-0 top-full mt-0.5 z-10 flex gap-1 pointer-events-none">
      {modes.map(({ key, recipe, action, option }) => {
        const colors = modePillColors(option.value);
        return (
          <span
            key={key}
            data-testid="card-mode-pill"
            className={`inline-flex items-center rounded-full text-micro font-semibold whitespace-nowrap ${SIZE[size]}`}
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {cycleOptionLabel(recipe, action, option, lang, t)}
          </span>
        );
      })}
    </span>
  );
}

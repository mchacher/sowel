import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, X } from "lucide-react";
import { useEquipments } from "../../store/useEquipments";
import { useRecipes } from "../../store/useRecipes";
import { useZones } from "../../store/useZones";
import type { RecipeInfo, ZoneWithChildren } from "../../types";
import { recipeName, recipeDescription } from "../../lib/recipe-i18n";
import { matchesEquipmentType } from "../../lib/recipe-slots";

// ============================================================
// Recipe picker popover — opens from the "+" button in the zone header
// ============================================================

export function RecipePickerPopover({
  recipes,
  zoneId,
  onPick,
  onClose,
}: {
  recipes: RecipeInfo[];
  zoneId: string;
  onPick: (recipeId: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const equipments = useEquipments((s) => s.equipments);
  const instances = useRecipes((s) => s.instances);
  const zoneTree = useZones((s) => s.tree);

  const zoneAndDescendantIds = useMemo(() => {
    const ids = new Set<string>();
    const collect = (nodes: ZoneWithChildren[], inside: boolean): void => {
      for (const n of nodes) {
        const here = inside || n.id === zoneId;
        if (here) ids.add(n.id);
        if (n.children.length > 0) collect(n.children, here);
      }
    };
    collect(zoneTree, false);
    return ids;
  }, [zoneTree, zoneId]);

  const usedLightIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inst of instances) {
      if (inst.params.zone !== zoneId) continue;
      if (typeof inst.params.light === "string") ids.add(inst.params.light);
      if (Array.isArray(inst.params.lights)) {
        for (const id of inst.params.lights) {
          if (typeof id === "string") ids.add(id);
        }
      }
    }
    return ids;
  }, [instances, zoneId]);

  const availableRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      for (const slot of recipe.slots) {
        if (slot.type !== "equipment" || !slot.required) continue;
        const isCrossZone = slot.constraints?.crossZone === true;
        const includeDescendants = slot.constraints?.includeDescendants === true;
        const matches = equipments.some((eq) => {
          if (!isCrossZone) {
            const allowed = includeDescendants
              ? zoneAndDescendantIds.has(eq.zoneId)
              : eq.zoneId === zoneId;
            if (!allowed) return false;
          }
          if (!slot.list && usedLightIds.has(eq.id)) return false;
          if (slot.constraints?.equipmentType) {
            return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
          }
          return true;
        });
        if (!matches) return false;
      }
      return true;
    });
  }, [recipes, equipments, zoneId, zoneAndDescendantIds, usedLightIds]);

  const list = availableRecipes.length === 0 ? (
    <div className="px-3 py-4 text-center text-[12px] text-text-tertiary">
      {t("recipes.noRecipesAvailable")}
    </div>
  ) : (
    availableRecipes.map((recipe) => (
      <button
        key={recipe.id}
        onClick={() => onPick(recipe.id)}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] hover:bg-border-light/60 transition-colors duration-150 text-left"
      >
        <div className="w-7 h-7 rounded-[6px] bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
          <ChefHat size={14} strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-text leading-tight">
            {recipeName(recipe, lang)}
          </div>
          <div
            className="text-[11px] text-text-tertiary leading-snug mt-0.5 overflow-hidden"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
          >
            {recipeDescription(recipe, lang)}
          </div>
        </div>
      </button>
    ))
  );

  return (
    <>
      {/* Desktop side-popover: opens to the right of the "+" button */}
      <div className="hidden sm:block absolute right-0 top-full mt-1 z-20 w-[320px] max-h-[360px] overflow-y-auto bg-surface border border-border rounded-[8px] shadow-lg p-1">
        {list}
      </div>

      {/* Mobile bottom sheet with backdrop */}
      <div className="sm:hidden">
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] flex flex-col bg-surface border-t border-border rounded-t-[16px] shadow-xl">
          <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-border" />
          </div>
          <div className="flex items-center justify-between px-4 pb-2 flex-shrink-0">
            <span className="text-[13px] font-semibold text-text">{t("recipes.addRecipe")}</span>
            <button
              onClick={onClose}
              className="p-1 rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto p-1 pb-[env(safe-area-inset-bottom,0px)]"
            style={{ overscrollBehavior: "contain" }}
          >
            {list}
          </div>
        </div>
      </div>
    </>
  );
}

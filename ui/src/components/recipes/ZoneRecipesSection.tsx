import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, Plus } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useAuth } from "../../store/useAuth";
import { RecipePickerPopover } from "./RecipePickerPopover";
import { RecipeInstanceRow } from "./RecipeInstanceRow";
import { AddRecipeForm } from "./AddRecipeForm";

interface ZoneRecipesSectionProps {
  zoneId: string;
  zoneName: string;
}

export function ZoneRecipesSection({ zoneId, zoneName }: ZoneRecipesSectionProps) {
  const { t } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const recipes = useRecipes((s) => s.recipes);
  const instances = useRecipes((s) => s.instances);
  const fetchRecipes = useRecipes((s) => s.fetchRecipes);
  const fetchInstances = useRecipes((s) => s.fetchInstances);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedRecipeId, setPickedRecipeId] = useState<string | null>(null);
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRecipes();
    fetchInstances();
  }, [fetchRecipes, fetchInstances]);

  // Close popover on outside click
  useEffect(() => {
    if (!showPicker) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showPicker]);

  // Filter instances that belong to this zone
  const zoneInstances = useMemo(() => {
    return instances.filter((inst) => inst.params.zone === zoneId);
  }, [instances, zoneId]);

  const handlePickRecipe = (recipeId: string) => {
    setShowPicker(false);
    setPickedRecipeId(recipeId);
  };

  if (recipes.length === 0 && zoneInstances.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-[0.55rem] px-[1.1rem] py-[0.4rem] min-h-[36px] bg-[var(--n-25)] border-t border-b border-border-light">
        <span className="text-text-tertiary opacity-70 flex-shrink-0">
          <ChefHat size={14} strokeWidth={1.5} />
        </span>
        <span className="text-[10.4px] font-semibold text-text-tertiary uppercase tracking-[0.14em]">
          {t("recipes.title")}
        </span>
        <span className="text-[10.9px] text-text-tertiary opacity-65 ml-auto tabular-nums font-mono">
          {zoneInstances.length}
        </span>
        {isAdmin && (
        <div ref={pickerWrapRef} className="relative ml-2">
          <button
            onClick={() => setShowPicker((v) => !v)}
            className="w-[22px] h-[22px] inline-flex items-center justify-center rounded-[4px] border border-border-light text-text-tertiary hover:text-primary hover:bg-primary-light hover:border-primary-mid transition-colors duration-150"
            title={t("recipes.addRecipe")}
          >
            <Plus size={11} strokeWidth={2} />
          </button>
          {showPicker && (
            <RecipePickerPopover
              recipes={recipes}
              zoneId={zoneId}
              onPick={handlePickRecipe}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
        )}
      </div>

      {zoneInstances.length > 0 && (
        <div className="divide-y divide-border-light">
          {zoneInstances.map((inst) => (
            <RecipeInstanceRow key={inst.id} instance={inst} recipes={recipes} zoneId={zoneId} />
          ))}
        </div>
      )}

      {zoneInstances.length === 0 && !pickedRecipeId && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-[12px] text-text-tertiary">
          <span>{t("recipes.noActiveRecipes", { name: zoneName })}</span>
          {isAdmin && (
            <button
              onClick={() => setShowPicker(true)}
              className="text-primary hover:text-primary-hover transition-colors duration-150"
            >
              {t("recipes.addRecipe")}
            </button>
          )}
        </div>
      )}

      {pickedRecipeId && (
        <AddRecipeForm
          zoneId={zoneId}
          recipes={recipes}
          initialRecipeId={pickedRecipeId}
          onClose={() => setPickedRecipeId(null)}
        />
      )}
    </div>
  );
}

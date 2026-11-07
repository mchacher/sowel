import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useAuth } from "../../store/useAuth";
import { RecipePickerPopover } from "./RecipePickerPopover";
import { RecipeInstanceRow } from "./RecipeInstanceRow";
import { AddRecipeForm } from "./AddRecipeForm";
import { SliceAddButton, SliceHeader } from "../home/Panel";

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
      <SliceHeader
        icon={<ChefHat size={16} strokeWidth={1.5} />}
        label={t("recipes.title")}
        count={zoneInstances.length}
        action={
          isAdmin ? (
            <div ref={pickerWrapRef} className="relative">
              <SliceAddButton onClick={() => setShowPicker((v) => !v)} title={t("recipes.addRecipe")} />
              {showPicker && (
                <RecipePickerPopover
                  recipes={recipes}
                  zoneId={zoneId}
                  onPick={handlePickRecipe}
                  onClose={() => setShowPicker(false)}
                />
              )}
            </div>
          ) : undefined
        }
      />

      {zoneInstances.length > 0 && (
        <div className="slice-rows">
          {zoneInstances.map((inst) => (
            <RecipeInstanceRow key={inst.id} instance={inst} recipes={recipes} zoneId={zoneId} />
          ))}
        </div>
      )}

      {zoneInstances.length === 0 && !pickedRecipeId && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-caption text-text-tertiary">
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

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import type { RecipeInfo, RecipeInstance, EquipmentWithDetails } from "../../types";
import { recipeName, recipeSlotName } from "../../lib/recipe-i18n";
import { matchesEquipmentType } from "../../lib/recipe-slots";
import { EquipmentOptions } from "./recipe-form-fields";
import { useZoneOptions } from "./useZoneOptions";

// ============================================================
// Duplicate recipe modal
// ============================================================

export function DuplicateRecipeModal({
  instance,
  recipe,
  sourceZoneId,
  onClose,
}: {
  instance: RecipeInstance;
  recipe: RecipeInfo;
  sourceZoneId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const zoneTree = useZones((s) => s.tree);
  const equipments = useEquipments((s) => s.equipments);
  const createInstance = useRecipes((s) => s.createInstance);
  const [targetZoneId, setTargetZoneId] = useState("");
  const [equipmentMap, setEquipmentMap] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Flatten zone tree to a flat list, each zone qualified by its ancestors
  const { allZones, zoneChains } = useZoneOptions(zoneTree);

  // Equipment slots that need remapping
  const equipmentSlots = useMemo(() => {
    return recipe.slots.filter(
      (s) => s.type === "equipment" && instance.params[s.id],
    );
  }, [recipe.slots, instance.params]);

  // Other zones (exclude current)
  const otherZones = useMemo(() => {
    return allZones.filter((z) => z.id !== sourceZoneId);
  }, [allZones, sourceZoneId]);

  // Reset equipment map when target zone changes
  useEffect(() => {
    if (!targetZoneId) {
      setEquipmentMap({});
      return;
    }
    const map: Record<string, string> = {};
    for (const slot of equipmentSlots) {
      // Auto-select if only one compatible equipment exists
      const compatible = equipments.filter((eq) => {
        if (eq.zoneId !== targetZoneId) return false;
        if (slot.constraints?.equipmentType) {
          return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
        }
        return true;
      });
      if (compatible.length === 1) {
        // For list slots, pick the single one; for single slots, auto-select
        map[slot.id] = compatible[0].id;
      }
    }
    setEquipmentMap(map);
    setError("");
  }, [targetZoneId, equipmentSlots, equipments]);

  const getCompatibleEquipments = (slotId: string): EquipmentWithDetails[] => {
    const slot = recipe.slots.find((s) => s.id === slotId);
    if (!slot || !targetZoneId) return [];
    return equipments.filter((eq) => {
      if (eq.zoneId !== targetZoneId) return false;
      if (slot.constraints?.equipmentType) {
        return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
      }
      return true;
    });
  };

  const handleSubmit = async () => {
    setError("");

    // Validate all required equipment slots are mapped
    for (const slot of equipmentSlots) {
      if (slot.required && !equipmentMap[slot.id]) {
        setError(t("recipes.slotRequired", { name: recipeSlotName(recipe, slot, lang) }));
        return;
      }
    }

    setSubmitting(true);

    // Build new params: copy all, replace zone + equipment IDs
    const newParams: Record<string, unknown> = {};
    for (const slot of recipe.slots) {
      if (slot.id === "zone") {
        newParams.zone = targetZoneId;
      } else if (slot.type === "equipment" && equipmentMap[slot.id]) {
        // For list slots, wrap in array
        const sourceVal = instance.params[slot.id];
        if (Array.isArray(sourceVal)) {
          newParams[slot.id] = [equipmentMap[slot.id]];
        } else {
          newParams[slot.id] = equipmentMap[slot.id];
        }
      } else {
        newParams[slot.id] = instance.params[slot.id];
      }
    }

    try {
      await createInstance(instance.recipeId, newParams);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-[14px] border border-border shadow-xl w-full max-w-[400px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h2 className="text-[16px] font-semibold text-text">
            {t("recipes.duplicateTitle")}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-tertiary hover:text-text-secondary rounded-[4px] hover:bg-border-light"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Source summary */}
          <div className="text-[12px] text-text-tertiary">
            {recipeName(recipe, lang)}
          </div>

          {/* Target zone picker */}
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-widest mb-1">
              {t("recipes.targetZone")}
            </label>
            <select
              value={targetZoneId}
              onChange={(e) => setTargetZoneId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {otherZones.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
            </select>
          </div>

          {/* Equipment mapping */}
          {targetZoneId && equipmentSlots.map((slot) => {
            const compatible = getCompatibleEquipments(slot.id);
            return (
              <div key={slot.id}>
                <label className="block text-[11px] text-text-tertiary uppercase tracking-widest mb-1">
                  {recipeSlotName(recipe, slot, lang)}
                </label>
                {compatible.length === 0 ? (
                  <p className="text-[12px] text-error">{t("recipes.noCompatibleEquipment")}</p>
                ) : (
                  <select
                    value={equipmentMap[slot.id] ?? ""}
                    onChange={(e) => setEquipmentMap({ ...equipmentMap, [slot.id]: e.target.value })}
                    className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                  >
                    {compatible.length > 1 && <option value="">{t("common.select")}</option>}
                    <EquipmentOptions equipments={compatible} zoneChains={zoneChains} />
                  </select>
                )}
              </div>
            );
          })}

          {error && <p className="text-[12px] text-error">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-light">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!targetZoneId || submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {t("recipes.duplicateAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

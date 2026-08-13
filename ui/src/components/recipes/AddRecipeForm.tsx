import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Minus, X, Loader2 } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import type { RecipeInfo, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { recipeName, recipeDescription, recipeSlotName, recipeSlotDescription, recipeGroupLabel, recipeSlotOptionLabel } from "../../lib/recipe-i18n";
import { isSlotHidden, matchesEquipmentType } from "../../lib/recipe-slots";
import { groupSlots, isGroupRequired, getGroupKeys, durationToMinutes } from "./recipe-slot-helpers";
import {
  EquipmentOptions,
  MultiSelectChips,
  DurationInput,
  TimeInput,
  SingleEquipmentZonePicker,
  EquipmentListPicker,
  EquipmentCheckboxList,
} from "./recipe-form-fields";
import { useZoneOptions } from "./useZoneOptions";

// ============================================================
// Add recipe wizard (step 1: choose recipe, step 2: configure)
// ============================================================

export function AddRecipeForm({
  zoneId,
  recipes,
  initialRecipeId,
  onClose,
}: {
  zoneId: string;
  recipes: RecipeInfo[];
  initialRecipeId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const createInstance = useRecipes((s) => s.createInstance);
  const instances = useRecipes((s) => s.instances);
  const equipments = useEquipments((s) => s.equipments);
  const zoneAggregation = useZoneAggregation((s) => s.data);
  const zoneTree = useZones((s) => s.tree);
  const selectedRecipeId = initialRecipeId;
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  // Flatten zone tree for equipment list picker
  const { allZones, zoneChains } = useZoneOptions(zoneTree);

  // Set of {zoneId} ∪ {descendantIds(zoneId)} used by slots with constraints.includeDescendants.
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

  // Light IDs already managed by a recipe instance in this zone
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

  /** Equipment types that are global (not zone-scoped) — always shown regardless of zone. */
  const GLOBAL_EQUIPMENT_TYPES = new Set(["weather", "weather_forecast"]);

  // Filter equipments matching slot constraints, excluding already-used lights
  const getEquipmentOptions = (slotId: string): EquipmentWithDetails[] => {
    const slot = selectedRecipe?.slots.find((s) => s.id === slotId);
    if (!slot) return [];

    const isGlobalSlot = slot.constraints?.equipmentType &&
      (Array.isArray(slot.constraints.equipmentType)
        ? slot.constraints.equipmentType.some((t) => GLOBAL_EQUIPMENT_TYPES.has(t))
        : GLOBAL_EQUIPMENT_TYPES.has(slot.constraints.equipmentType));
    const isCrossZone = slot.constraints?.crossZone === true;
    const includeDescendants = slot.constraints?.includeDescendants === true;

    return equipments.filter((eq) => {
      if (!isGlobalSlot && !isCrossZone) {
        const allowed = includeDescendants
          ? zoneAndDescendantIds.has(eq.zoneId)
          : eq.zoneId === zoneId;
        if (!allowed) return false;
      }
      if (slot.type === "equipment" && !slot.list && usedLightIds.has(eq.id)) return false;
      if (slot.constraints?.equipmentType) {
        return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
      }
      return true;
    });
  };

  // Hide luxThreshold when zone has no lux sensor
  const shouldShowSlot = (slotId: string): boolean => {
    if (slotId === "luxThreshold") {
      const agg = zoneAggregation[zoneId];
      return agg?.luminosity !== undefined && agg?.luminosity !== null;
    }
    if (slotId === "buttons") {
      return equipments.some((eq) => eq.type === "button");
    }
    return true;
  };

  // Initialize default params when recipe is selected
  useEffect(() => {
    if (!selectedRecipe) return;
    const defaults: Record<string, string> = {};
    for (const slot of selectedRecipe.slots) {
      if (slot.id === "zone") {
        defaults[slot.id] = zoneId;
      } else if (slot.defaultValue !== undefined) {
        defaults[slot.id] = String(slot.defaultValue);
      } else {
        defaults[slot.id] = "";
      }
    }
    setParams(defaults); // eslint-disable-line react-hooks/set-state-in-effect -- sync defaults when recipe selection changes
    setError("");
    // Show required groups by default, hide optional ones
    const requiredGroups = new Set<string>();
    for (const gk of getGroupKeys(selectedRecipe.slots)) {
      if (isGroupRequired(gk, selectedRecipe.slots)) requiredGroups.add(gk);
    }
    setVisibleGroups(requiredGroups); // eslint-disable-line react-hooks/set-state-in-effect -- sync with recipe selection
  }, [selectedRecipeId, selectedRecipe, zoneId]);

  const handleSubmit = async () => {
    if (!selectedRecipe) return;
    setError("");
    setSubmitting(true);

    const finalParams: Record<string, unknown> = {};
    for (const slot of selectedRecipe.slots) {
      const value = params[slot.id];
      if (slot.required && !value) {
        setError(t("recipes.slotRequired", { name: recipeSlotName(selectedRecipe, slot, lang) }));
        setSubmitting(false);
        return;
      }
      if (slot.type === "boolean") {
        finalParams[slot.id] = value === "true";
      } else if (slot.list) {
        finalParams[slot.id] = value ? value.split(",").filter(Boolean) : [];
      } else {
        finalParams[slot.id] = value;
      }
    }

    try {
      await createInstance(selectedRecipeId, finalParams);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-border-light px-4 py-3 bg-border-light/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-medium text-text">
          {selectedRecipe ? recipeName(selectedRecipe, lang) : ""}
        </span>
        <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text transition-colors duration-150">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {selectedRecipe && (
        <>
          <p className="text-[11px] text-text-tertiary mb-3">{recipeDescription(selectedRecipe, lang)}</p>

          {(() => {
            const filteredSlots = selectedRecipe.slots.filter((slot) => slot.id !== "zone" && shouldShowSlot(slot.id));
            const chunks = groupSlots(filteredSlots);
            const allGroupKeys = getGroupKeys(selectedRecipe.slots);
            const hiddenGroups = allGroupKeys.filter((gk) => !visibleGroups.has(gk));
            return (
              <>
                {chunks.map((chunk) => {
                  // Grouped slots — render as compact inline row
                  if (chunk.group) {
                    if (!visibleGroups.has(chunk.group)) return null;
                    const groupKey = chunk.group;
                    return (
                      <div key={groupKey} className="mb-2.5 pl-2 border-l-2 border-accent/40">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] uppercase tracking-widest text-accent">{recipeGroupLabel(selectedRecipe, groupKey, lang)}</span>
                          {!isGroupRequired(groupKey, selectedRecipe.slots) && <button
                            type="button"
                            onClick={() => {
                              const next = { ...params };
                              for (const s of chunk.slots) next[s.id] = "";
                              setParams(next);
                              setVisibleGroups((prev) => { const n = new Set(prev); n.delete(groupKey); return n; });
                            }}
                            className="p-0.5 rounded text-text-tertiary hover:text-error hover:bg-error/5 transition-colors duration-150"
                            title={t("common.delete")}
                          >
                            <Minus size={14} strokeWidth={1.5} />
                          </button>}
                        </div>
                        {/* Full-width equipment list slots — cross-zone picker */}
                        {chunk.slots.filter((s) => s.type === "equipment" && s.list).map((slot) => (
                          <EquipmentListPicker
                            key={slot.id}
                            slot={slot}
                            value={params[slot.id] ?? ""}
                            onChange={(v) => setParams({ ...params, [slot.id]: v })}
                            equipments={equipments}
                            zones={allZones}
                            recipe={selectedRecipe}
                            lang={lang}
                          />
                        ))}
                        {/* Compact grid for non-list slots */}
                        {(() => {
                          const compactSlots = chunk.slots.filter((s) => !((s.type === "equipment" || s.type === "select") && s.list) && !isSlotHidden(s, params, selectedRecipe.slots));
                          if (compactSlots.length === 0) return null;
                          const n = compactSlots.length;
                          const cols = n <= 3 ? n : n % 3 === 0 ? 3 : 2;
                          // Equal-width columns so a dropdown + its value field
                          // (or two time pickers) sit side by side at the same
                          // size and labels never wrap into a narrow column.
                          return (
                            <div className={`grid gap-1.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                              {compactSlots.map((slot) => (
                                <div key={slot.id}>
                                  <label className="block text-[10px] tracking-wider mb-0.5 text-text-tertiary">
                                    {recipeSlotName(selectedRecipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                                  </label>
                                  {slot.type === "equipment" ? (
                                    <select
                                      value={params[slot.id] ?? ""}
                                      onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                                      className="w-full px-2 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                                    >
                                      <option value="">{t("common.select")}</option>
                                      <EquipmentOptions equipments={getEquipmentOptions(slot.id)} zoneChains={zoneChains} />
                                    </select>
                                  ) : slot.type === "data-key" ? (
                                    (() => {
                                      const eqSlot = selectedRecipe?.slots.find((s) => s.type === "equipment" && !s.list);
                                      const eqId = eqSlot ? params[eqSlot.id] : undefined;
                                      const eq = eqId ? equipments.find((e) => e.id === eqId) : undefined;
                                      const bindings = eq?.dataBindings ?? [];
                                      return (
                                        <select
                                          value={params[slot.id] ?? ""}
                                          onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                                          className="w-full px-2 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                                        >
                                          <option value="">{t("common.select")}</option>
                                          {bindings.map((b) => (
                                            <option key={b.alias} value={b.alias}>{b.alias}</option>
                                          ))}
                                        </select>
                                      );
                                    })()
                                  ) : slot.type === "select" ? (
                                    <select
                                      value={String(params[slot.id] ?? slot.defaultValue ?? "")}
                                      onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                                      className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                                    >
                                      {(slot.options ?? []).map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {recipeSlotOptionLabel(selectedRecipe, slot, o.value, lang)}
                                        </option>
                                      ))}
                                    </select>
                                  ) : slot.type === "time" ? (
                                    <TimeInput
                                      value={params[slot.id] ?? ""}
                                      onChange={(v) => setParams({ ...params, [slot.id]: v })}
                                    />
                                  ) : (
                                    <input
                                      type={slot.type === "number" ? "number" : "text"}
                                      min={slot.constraints?.min}
                                      max={slot.constraints?.max}
                                      value={params[slot.id] ?? ""}
                                      onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                                      placeholder={slot.constraints?.max ? `1-${slot.constraints.max}` : ""}
                                      className="w-full px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {/* Full-width multi-select slots (e.g. weekdays) — rendered as chips */}
                        {chunk.slots.filter((s) => s.type === "select" && s.list && !isSlotHidden(s, params, selectedRecipe.slots)).map((slot) => (
                          <div key={slot.id} className="mt-1.5">
                            <label className="block text-[10px] tracking-wider mb-1 text-text-tertiary">
                              {recipeSlotName(selectedRecipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                            </label>
                            <MultiSelectChips
                              slot={slot}
                              value={params[slot.id] ?? ""}
                              onChange={(v) => setParams({ ...params, [slot.id]: v })}
                              recipe={selectedRecipe}
                              lang={lang}
                            />
                            <p className="text-[10px] text-text-tertiary mt-0.5">{recipeSlotDescription(selectedRecipe, slot, lang)}</p>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  // Ungrouped — render each slot individually
                  return chunk.slots.map((slot) => isSlotHidden(slot, params, selectedRecipe.slots) ? null : (
                    <div key={slot.id} className="mb-3">
                      {slot.type === "boolean" ? (
                        <label className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150">
                          <input
                            type="checkbox"
                            checked={params[slot.id] === "true"}
                            onChange={(e) => setParams({ ...params, [slot.id]: e.target.checked ? "true" : "false" })}
                            className="accent-primary"
                          />
                          {recipeSlotName(selectedRecipe, slot, lang)}
                        </label>
                      ) : (
                      <>
                      <label className="block text-[11px] text-text-tertiary uppercase tracking-widest mb-1">
                        {recipeSlotName(selectedRecipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                      </label>
                      {slot.type === "equipment" && slot.list ? (
                        <EquipmentCheckboxList
                          equipments={getEquipmentOptions(slot.id)}
                          zoneChains={zoneChains}
                          value={params[slot.id] ?? ""}
                          onChange={(v) => setParams({ ...params, [slot.id]: v })}
                        />
                      ) : slot.type === "equipment" ? (
                        slot.constraints?.crossZone === true ||
                        slot.constraints?.includeDescendants === true ? (
                          <SingleEquipmentZonePicker
                            value={params[slot.id] ?? ""}
                            onChange={(v) => setParams({ ...params, [slot.id]: v })}
                            equipments={getEquipmentOptions(slot.id)}
                            zones={allZones}
                          />
                        ) : (
                          <select
                            value={params[slot.id] ?? ""}
                            onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                            className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                          >
                            <option value="">{t("common.select")}</option>
                            <EquipmentOptions equipments={getEquipmentOptions(slot.id)} zoneChains={zoneChains} />
                          </select>
                        )
                      ) : slot.type === "data-key" ? (
                        (() => {
                          const eqSlot = selectedRecipe?.slots.find((s) => s.type === "equipment" && !s.list);
                          const eqId = eqSlot ? params[eqSlot.id] : undefined;
                          const eq = eqId ? equipments.find((e) => e.id === eqId) : undefined;
                          const bindings = eq?.dataBindings ?? [];
                          return (
                            <select
                              value={params[slot.id] ?? ""}
                              onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                            >
                              <option value="">{t("common.select")}</option>
                              {bindings.map((b) => (
                                <option key={b.alias} value={b.alias}>{b.alias}</option>
                              ))}
                            </select>
                          );
                        })()
                      ) : slot.type === "duration" ? (
                        <DurationInput
                          value={params[slot.id] ?? ""}
                          onChange={(v) => setParams({ ...params, [slot.id]: v })}
                          placeholder={slot.defaultValue ? String(durationToMinutes(String(slot.defaultValue))) : undefined}
                        />
                      ) : slot.type === "select" ? (
                        slot.list ? (
                          <MultiSelectChips
                            slot={slot}
                            value={params[slot.id] ?? ""}
                            onChange={(v) => setParams({ ...params, [slot.id]: v })}
                            recipe={selectedRecipe}
                            lang={lang}
                          />
                        ) : (
                        <select
                          value={String(params[slot.id] ?? slot.defaultValue ?? "")}
                          onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                          className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                        >
                          {(slot.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {recipeSlotOptionLabel(selectedRecipe, slot, o.value, lang)}
                            </option>
                          ))}
                        </select>
                        )
                      ) : slot.type === "time" ? (
                        <TimeInput
                          value={params[slot.id] ?? ""}
                          onChange={(v) => setParams({ ...params, [slot.id]: v })}
                          placeholder={slot.defaultValue ? String(slot.defaultValue) : undefined}
                        />
                      ) : (
                        <input
                          type={slot.type === "number" ? "number" : "text"}
                          min={slot.constraints?.min}
                          max={slot.constraints?.max}
                          value={params[slot.id] ?? ""}
                          onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                          placeholder={slot.defaultValue ? String(slot.defaultValue) : recipeSlotDescription(selectedRecipe, slot, lang)}
                          className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                        />
                      )}
                      <p className="text-[11px] text-text-tertiary mt-0.5">{recipeSlotDescription(selectedRecipe, slot, lang)}</p>
                      </>
                      )}
                    </div>
                  ));
                })}
                {/* Add group buttons */}
                {hiddenGroups.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2.5">
                    {hiddenGroups.map((gk) => (
                      <button
                        key={gk}
                        type="button"
                        onClick={() => {
                          setVisibleGroups((prev) => new Set([...prev, gk]));
                        }}
                        className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover transition-colors duration-150"
                      >
                        <Plus size={14} strokeWidth={1.5} />
                        {recipeGroupLabel(selectedRecipe, gk, lang)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            );
          })()}

          {error && (
            <p className="text-[12px] text-error mb-3">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("common.create")}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-border-light text-text-secondary text-[13px] font-medium rounded-[6px] hover:bg-border transition-colors duration-150"
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

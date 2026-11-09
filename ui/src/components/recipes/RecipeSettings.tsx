import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Copy, Loader2, Minus, Plus, Trash2, X } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import type {
  RecipeInfo,
  RecipeInstance,
  EquipmentWithDetails,
  ZoneWithChildren,
} from "../../types";
import {
  recipeName,
  recipeSlotName,
  recipeSlotDescription,
  recipeGroupLabel,
  recipeSlotOptionLabel,
} from "../../lib/recipe-i18n";
import { isSlotHidden, matchesEquipmentType } from "../../lib/recipe-slots";
import {
  groupSlots,
  isGroupFilled,
  isGroupRequired,
  getGroupKeys,
  durationToMinutes,
} from "./recipe-slot-helpers";
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
import { RecipeIconTile } from "./RecipeIconTile";
import { useIsMobile } from "../../hooks/useIsMobile";
import { FIELD_LABEL_UNTONED } from "../ui/text-roles";
import { apiErrorText } from "../../lib/api-error";

/** The slot values as the form edits them: strings, a list joined by commas. */
function initialParams(recipe: RecipeInfo, instance: RecipeInstance): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, val] of Object.entries(instance.params)) {
    params[key] = Array.isArray(val) ? val.join(",") : String(val ?? "");
  }
  // Slots added by a newer recipe version get their default.
  for (const slot of recipe.slots) {
    if (!(slot.id in params)) {
      params[slot.id] = slot.defaultValue !== undefined ? String(slot.defaultValue) : "";
    }
  }
  return params;
}

/**
 * A recipe instance's settings (spec 198): a 720 px dialog on a computer, a
 * full-screen page on a phone. The slot groups are sections; with more than
 * two, a rail on the left lists them. The fields, their validation and the
 * save call are those of the former inline form.
 */
export function RecipeSettings({
  instance,
  recipe,
  zoneId,
  context,
  alarm,
  onClose,
  onDuplicate,
  onDelete,
  deleting,
}: {
  instance: RecipeInstance;
  recipe: RecipeInfo;
  zoneId: string;
  /** The instance's second line, to name it under the title. */
  context: string;
  alarm: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const isMobile = useIsMobile();
  const updateInstance = useRecipes((s) => s.updateInstance);
  const allInstances = useRecipes((s) => s.instances);
  const equipments = useEquipments((s) => s.equipments);
  const zoneAggregation = useZoneAggregation((s) => s.data);
  const zoneTree = useZones((s) => s.tree);
  const { allZones, zoneChains } = useZoneOptions(zoneTree);
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
  const [editParams, setEditParams] = useState<Record<string, string>>(() =>
    initialParams(recipe, instance),
  );
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  // Required groups and groups that already hold data are shown; the others
  // wait behind their « + » button.
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(() => {
    const params = initialParams(recipe, instance);
    return new Set(
      getGroupKeys(recipe.slots).filter(
        (gk) => isGroupRequired(gk, recipe.slots) || isGroupFilled(gk, recipe.slots, params),
      ),
    );
  });
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isSlotChanged = (slotId: string): boolean => {
    const val = instance.params[slotId];
    const original = Array.isArray(val) ? val.join(",") : String(val ?? "");
    return (editParams[slotId] ?? "") !== original;
  };

  const changedCount = useMemo(() => {
    let n = 0;
    for (const slot of recipe.slots) {
      if (slot.id === "zone") continue;
      const val = instance.params[slot.id];
      const original = Array.isArray(val) ? val.join(",") : String(val ?? "");
      if ((editParams[slot.id] ?? "") !== original) n++;
    }
    return n;
  }, [editParams, instance.params, recipe]);
  const hasChanges = changedCount > 0;

  const handleSave = async () => {
    if (!recipe) return;
    setEditError("");
    setSaving(true);

    const finalParams: Record<string, unknown> = {};
    for (const slot of recipe.slots) {
      const value = editParams[slot.id];
      if (slot.required && !value) {
        setEditError(t("recipes.slotRequired", { name: recipeSlotName(recipe, slot, lang) }));
        setSaving(false);
        return;
      }
      // Convert comma-separated string back to array for list slots
      if (slot.type === "boolean") {
        finalParams[slot.id] = value === "true";
      } else if (slot.list) {
        finalParams[slot.id] = value ? value.split(",").filter(Boolean) : [];
      } else {
        finalParams[slot.id] = value;
      }
    }

    try {
      await updateInstance(instance.id, finalParams);
      onClose();
    } catch (err) {
      setEditError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  // Light IDs used by other recipe instances in this zone (exclude current instance)
  const usedLightIds = useMemo(() => {
    const ids = new Set<string>();
    for (const inst of allInstances) {
      if (inst.id === instance.id) continue;
      if (inst.params.zone !== zoneId) continue;
      // Support both legacy "light" (string) and new "lights" (array)
      if (typeof inst.params.light === "string") ids.add(inst.params.light);
      if (Array.isArray(inst.params.lights)) {
        for (const id of inst.params.lights) {
          if (typeof id === "string") ids.add(id);
        }
      }
    }
    return ids;
  }, [allInstances, zoneId, instance.id]);

  /** Equipment types that are global (not zone-scoped) — always shown regardless of zone. */
  const GLOBAL_EQUIPMENT_TYPES = new Set(["weather", "weather_forecast"]);

  const getEquipmentOptions = (slotId: string): EquipmentWithDetails[] => {
    const slot = recipe?.slots.find((s) => s.id === slotId);
    if (!slot) return [];

    // Check if this slot targets a global equipment type or opts in to cross-zone selection.
    const isGlobalSlot =
      slot.constraints?.equipmentType &&
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

  const domPrefix = `recipe-settings-${instance.id}`;
  const sectionDomId = (key: string) => `${domPrefix}-${key}`;

  // The sections the rail lists, in the body's order.
  const filteredSlots = recipe.slots.filter(
    (slot) => slot.id !== "zone" && shouldShowSlot(slot.id),
  );
  // Each ungrouped slot is a chunk of its own: a run of them is one « Général »
  // section, which the rail points at its first chunk.
  const sections: { key: string; label: string; changed: boolean }[] = [];
  groupSlots(filteredSlots).forEach((chunk, i, chunks) => {
    const changed = chunk.slots.some((sl) => isSlotChanged(sl.id));
    if (chunk.group) {
      if (visibleGroups.has(chunk.group)) {
        sections.push({
          key: chunk.group,
          label: recipeGroupLabel(recipe, chunk.group, lang),
          changed,
        });
      }
      return;
    }
    if (i > 0 && chunks[i - 1].group === null) {
      const run = sections[sections.length - 1];
      if (run) run.changed = run.changed || changed;
      return;
    }
    sections.push({ key: `general-${i}`, label: t("recipes.settingsGeneral"), changed });
  });
  const showRail = !isMobile && sections.length > 2;

  const goTo = (key: string) => {
    setActiveSection(key);
    document
      .getElementById(sectionDomId(key))
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const fields = (
    <>
      {(() => {
        const filteredSlots = recipe.slots.filter(
          (slot) => slot.id !== "zone" && shouldShowSlot(slot.id),
        );
        const chunks = groupSlots(filteredSlots);
        const allGroupKeys = getGroupKeys(recipe.slots);
        const hiddenGroups = allGroupKeys.filter((gk) => !visibleGroups.has(gk));
        return (
          <>
            {chunks.map((chunk, chunkIndex) => {
              // Grouped slots — render as compact inline row
              if (chunk.group) {
                if (!visibleGroups.has(chunk.group)) return null;
                const groupKey = chunk.group;
                return (
                  <section
                    key={groupKey}
                    id={sectionDomId(groupKey)}
                    aria-label={recipeGroupLabel(recipe, groupKey, lang)}
                    className="mb-4 scroll-mt-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-small font-semibold text-text">
                        {recipeGroupLabel(recipe, groupKey, lang)}
                      </h3>
                      {!isGroupRequired(groupKey, recipe.slots) && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...editParams };
                            for (const s of chunk.slots) next[s.id] = "";
                            setEditParams(next);
                            setVisibleGroups((prev) => {
                              const n = new Set(prev);
                              n.delete(groupKey);
                              return n;
                            });
                          }}
                          className="p-0.5 rounded-sm text-text-tertiary hover:text-error hover:bg-error/5 transition-colors duration-150"
                          title={t("common.delete")}
                        >
                          <Minus size={14} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                    {/* Full-width equipment list slots — cross-zone picker */}
                    {chunk.slots
                      .filter((s) => s.type === "equipment" && s.list)
                      .map((slot) => (
                        <EquipmentListPicker
                          key={slot.id}
                          slot={slot}
                          value={editParams[slot.id] ?? ""}
                          onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                          equipments={equipments}
                          zones={allZones}
                          recipe={recipe}
                          lang={lang}
                          labelClassName={`${FIELD_LABEL_UNTONED} ${isSlotChanged(slot.id) ? "text-primary" : "text-text-secondary"}`}
                        />
                      ))}
                    {/* Compact grid for non-list slots */}
                    {(() => {
                      const compactSlots = chunk.slots.filter(
                        (s) =>
                          !((s.type === "equipment" || s.type === "select") && s.list) &&
                          !isSlotHidden(s, editParams, recipe.slots),
                      );
                      if (compactSlots.length === 0) return null;
                      const cols = compactSlots.length <= 3 ? compactSlots.length : 2;
                      return (
                        <div
                          className={`grid gap-1.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}
                        >
                          {compactSlots.map((slot) => (
                            <div key={slot.id}>
                              <label
                                className={`${FIELD_LABEL_UNTONED} ${isSlotChanged(slot.id) ? "text-primary" : "text-text-secondary"}`}
                              >
                                {recipeSlotName(recipe, slot, lang)}
                                {slot.required && <span className="text-error ml-0.5">*</span>}
                              </label>
                              {slot.type === "equipment" ? (
                                <select
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(e) =>
                                    setEditParams({
                                      ...editParams,
                                      [slot.id]: e.target.value,
                                    })
                                  }
                                  className="w-full px-2 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                >
                                  <option value="">{t("common.select")}</option>
                                  <EquipmentOptions
                                    equipments={getEquipmentOptions(slot.id)}
                                    zoneChains={zoneChains}
                                  />
                                </select>
                              ) : slot.type === "data-key" ? (
                                (() => {
                                  const eqSlot = recipe?.slots.find(
                                    (s) => s.type === "equipment" && !s.list,
                                  );
                                  const eqId = eqSlot ? editParams[eqSlot.id] : undefined;
                                  const eq = eqId
                                    ? equipments.find((e) => e.id === eqId)
                                    : undefined;
                                  const bindings = eq?.dataBindings ?? [];
                                  return (
                                    <select
                                      value={editParams[slot.id] ?? ""}
                                      onChange={(e) =>
                                        setEditParams({
                                          ...editParams,
                                          [slot.id]: e.target.value,
                                        })
                                      }
                                      className="w-full px-2 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                    >
                                      <option value="">{t("common.select")}</option>
                                      {bindings.map((b) => (
                                        <option key={b.alias} value={b.alias}>
                                          {b.alias}
                                        </option>
                                      ))}
                                    </select>
                                  );
                                })()
                              ) : slot.type === "select" ? (
                                <select
                                  value={String(editParams[slot.id] ?? slot.defaultValue ?? "")}
                                  onChange={(e) =>
                                    setEditParams({
                                      ...editParams,
                                      [slot.id]: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                >
                                  {(slot.options ?? []).map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {recipeSlotOptionLabel(recipe, slot, o.value, lang)}
                                    </option>
                                  ))}
                                </select>
                              ) : slot.type === "time" ? (
                                <TimeInput
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                />
                              ) : (
                                <input
                                  type={slot.type === "number" ? "number" : "text"}
                                  min={slot.constraints?.min}
                                  max={slot.constraints?.max}
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(e) =>
                                    setEditParams({
                                      ...editParams,
                                      [slot.id]: e.target.value,
                                    })
                                  }
                                  placeholder={
                                    slot.constraints?.max ? `1-${slot.constraints.max}` : ""
                                  }
                                  className="w-full px-2 py-1.5 text-small border border-border bg-surface rounded-sm text-text placeholder:text-text-tertiary"
                                />
                              )}
                              <p className="text-caption text-text-tertiary mt-0.5">
                                {recipeSlotDescription(recipe, slot, lang)}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    {/* Full-width multi-select slots (e.g. weekdays) — rendered as chips */}
                    {chunk.slots
                      .filter(
                        (s) =>
                          s.type === "select" &&
                          s.list &&
                          !isSlotHidden(s, editParams, recipe.slots),
                      )
                      .map((slot) => (
                        <div key={slot.id} className="mt-1.5">
                          <label
                            className={`${FIELD_LABEL_UNTONED} ${isSlotChanged(slot.id) ? "text-primary" : "text-text-secondary"}`}
                          >
                            {recipeSlotName(recipe, slot, lang)}
                            {slot.required && <span className="text-error ml-0.5">*</span>}
                          </label>
                          <MultiSelectChips
                            slot={slot}
                            value={editParams[slot.id] ?? ""}
                            onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                            recipe={recipe}
                            lang={lang}
                          />
                          <p className="text-caption text-text-tertiary mt-0.5">
                            {recipeSlotDescription(recipe, slot, lang)}
                          </p>
                        </div>
                      ))}
                  </section>
                );
              }
              // Ungrouped — render each slot individually (original logic)
              return (
                <section
                  key={`general-${chunkIndex}`}
                  id={sectionDomId(`general-${chunkIndex}`)}
                  className="scroll-mt-3"
                >
                  {chunk.slots.map((slot) =>
                    isSlotHidden(slot, editParams, recipe.slots) ? null : (
                      <div
                        key={slot.id}
                        className={`mb-2.5 pl-2 border-l-2 transition-colors duration-150 ${isSlotChanged(slot.id) ? "border-primary" : "border-transparent"}`}
                      >
                        {slot.type === "boolean" ? (
                          <label className="flex items-center gap-2 px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150">
                            <input
                              type="checkbox"
                              checked={editParams[slot.id] === "true"}
                              onChange={(e) =>
                                setEditParams({
                                  ...editParams,
                                  [slot.id]: e.target.checked ? "true" : "false",
                                })
                              }
                            />
                            {recipeSlotName(recipe, slot, lang)}
                          </label>
                        ) : (
                          <>
                            <label
                              className={`${FIELD_LABEL_UNTONED} ${isSlotChanged(slot.id) ? "text-primary" : "text-text-secondary"}`}
                            >
                              {recipeSlotName(recipe, slot, lang)}
                              {slot.required && <span className="text-error ml-0.5">*</span>}
                            </label>
                            {slot.type === "equipment" && slot.list ? (
                              <EquipmentCheckboxList
                                equipments={getEquipmentOptions(slot.id)}
                                zoneChains={zoneChains}
                                value={editParams[slot.id] ?? ""}
                                onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                              />
                            ) : slot.type === "equipment" ? (
                              slot.constraints?.crossZone === true ||
                              slot.constraints?.includeDescendants === true ? (
                                <SingleEquipmentZonePicker
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                  equipments={getEquipmentOptions(slot.id)}
                                  zones={allZones}
                                />
                              ) : (
                                <select
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(e) =>
                                    setEditParams({ ...editParams, [slot.id]: e.target.value })
                                  }
                                  className="w-full px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                >
                                  <option value="">{t("common.select")}</option>
                                  <EquipmentOptions
                                    equipments={getEquipmentOptions(slot.id)}
                                    zoneChains={zoneChains}
                                  />
                                </select>
                              )
                            ) : slot.type === "data-key" ? (
                              (() => {
                                const eqSlot = recipe?.slots.find(
                                  (s) => s.type === "equipment" && !s.list,
                                );
                                const eqId = eqSlot ? editParams[eqSlot.id] : undefined;
                                const eq = eqId ? equipments.find((e) => e.id === eqId) : undefined;
                                const bindings = eq?.dataBindings ?? [];
                                return (
                                  <select
                                    value={editParams[slot.id] ?? ""}
                                    onChange={(e) =>
                                      setEditParams({ ...editParams, [slot.id]: e.target.value })
                                    }
                                    className="w-full px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                  >
                                    <option value="">{t("common.select")}</option>
                                    {bindings.map((b) => (
                                      <option key={b.alias} value={b.alias}>
                                        {b.alias}
                                      </option>
                                    ))}
                                  </select>
                                );
                              })()
                            ) : slot.type === "duration" ? (
                              <DurationInput
                                value={editParams[slot.id] ?? ""}
                                onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                placeholder={
                                  slot.defaultValue
                                    ? String(durationToMinutes(String(slot.defaultValue)))
                                    : undefined
                                }
                              />
                            ) : slot.type === "select" ? (
                              slot.list ? (
                                <MultiSelectChips
                                  slot={slot}
                                  value={editParams[slot.id] ?? ""}
                                  onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                  recipe={recipe}
                                  lang={lang}
                                />
                              ) : (
                                <select
                                  value={String(editParams[slot.id] ?? slot.defaultValue ?? "")}
                                  onChange={(e) =>
                                    setEditParams({ ...editParams, [slot.id]: e.target.value })
                                  }
                                  className="w-full px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text"
                                >
                                  {(slot.options ?? []).map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {recipeSlotOptionLabel(recipe, slot, o.value, lang)}
                                    </option>
                                  ))}
                                </select>
                              )
                            ) : slot.type === "time" ? (
                              <TimeInput
                                value={editParams[slot.id] ?? ""}
                                onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                placeholder={
                                  slot.defaultValue ? String(slot.defaultValue) : undefined
                                }
                              />
                            ) : (
                              <input
                                type={slot.type === "number" ? "number" : "text"}
                                min={slot.constraints?.min}
                                max={slot.constraints?.max}
                                value={editParams[slot.id] ?? ""}
                                onChange={(e) =>
                                  setEditParams({ ...editParams, [slot.id]: e.target.value })
                                }
                                placeholder={
                                  slot.defaultValue
                                    ? String(slot.defaultValue)
                                    : recipeSlotDescription(recipe, slot, lang)
                                }
                                className="w-full px-3 py-1.5 text-small border border-border bg-surface rounded-sm text-text placeholder:text-text-tertiary"
                              />
                            )}
                            <p className="text-caption text-text-tertiary mt-0.5">
                              {recipeSlotDescription(recipe, slot, lang)}
                            </p>
                          </>
                        )}
                      </div>
                    ),
                  )}
                </section>
              );
            })}
            {/* Add group button */}
            {hiddenGroups.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2.5">
                {hiddenGroups.map((gk) => (
                  <button
                    key={gk}
                    type="button"
                    onClick={() => {
                      setVisibleGroups((prev) => new Set([...prev, gk]));
                    }}
                    className="flex items-center gap-1.5 text-caption text-primary hover:text-primary-hover transition-colors duration-150"
                  >
                    <Plus size={14} strokeWidth={1.5} />
                    {recipeGroupLabel(recipe, gk, lang)}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      })()}
      {editError && <p className="text-caption text-error mt-2">{editError}</p>}
    </>
  );

  const name = recipeName(recipe, lang);
  const saveButton = (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving || !hasChanges}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary-fill text-white text-caption font-medium rounded-sm hover:bg-primary-fill-hover transition-colors duration-150 disabled:opacity-40 disabled:hover:bg-primary-fill"
    >
      {saving ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Check size={12} strokeWidth={1.5} aria-hidden="true" />
      )}
      {t("common.save")}
    </button>
  );
  const cancelButton = (
    <button
      type="button"
      onClick={onClose}
      className="inline-flex items-center justify-center px-3 py-1.5 bg-border-light text-text-secondary text-caption font-medium rounded-sm hover:bg-border transition-colors duration-150"
    >
      {t("common.cancel")}
    </button>
  );
  const subtitle: ReactNode = (
    <span className={alarm ? "text-error" : ""}>{context ? `${name}, ${context}` : name}</span>
  );

  if (isMobile) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("recipes.settingsOf", { name })}
        className="fixed inset-0 z-50 bg-surface flex flex-col"
      >
        <div className="grid grid-cols-[44px_1fr_44px] items-center border-b border-border-light pt-[env(safe-area-inset-top)]">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.back")}
            className="w-11 h-11 flex items-center justify-center text-primary"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
          <div className="text-center min-w-0 py-2">
            <h2 className="text-lead font-semibold text-text">{t("recipes.settings")}</h2>
            <p className="text-caption text-text-secondary truncate">{subtitle}</p>
          </div>
          <span />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{fields}</div>
        <div className="grid grid-cols-2 gap-2.5 border-t border-border-light px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] [&>button]:min-h-11 [&>button]:text-body">
          {cancelButton}
          {saveButton}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("recipes.settingsOf", { name })}
        className="bg-surface rounded-lg shadow-lg w-full max-w-[720px] max-h-[min(720px,100%)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-[36px_1fr_auto] gap-x-3 items-center px-5 py-4 border-b border-border-light">
          <RecipeIconTile
            icon={recipe.icon}
            enabled={instance.enabled}
            alarm={alarm}
            className="row-span-2"
          />
          <h2 className="text-lead font-semibold text-text">{t("recipes.settings")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="row-span-2 w-8 h-8 rounded-sm flex items-center justify-center text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
          <p className="text-small text-text-secondary truncate min-w-0">{subtitle}</p>
        </div>
        <div
          className={`flex-1 min-h-0 grid ${showRail ? "grid-cols-[168px_1fr]" : "grid-cols-1"}`}
        >
          {showRail && (
            <nav
              aria-label={t("recipes.settingsSections")}
              className="border-r border-border-light p-2 overflow-y-auto flex flex-col gap-0.5"
            >
              {sections.map((sec) => (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => goTo(sec.key)}
                  aria-current={activeSection === sec.key ? "true" : undefined}
                  className={`flex items-center justify-between gap-2 text-left text-small px-2.5 py-1.5 rounded-sm transition-colors duration-150 ${
                    activeSection === sec.key
                      ? "bg-primary-light text-primary font-medium"
                      : "text-text-secondary hover:bg-border-light/40"
                  }`}
                >
                  <span className="truncate">{sec.label}</span>
                  {sec.changed && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
                      role="img"
                      aria-label={t("recipes.settingsChanged")}
                    />
                  )}
                </button>
              ))}
            </nav>
          )}
          <div className="overflow-y-auto px-5 py-4 min-h-0">{fields}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-border-light">
          {/* Duplicate / delete: config and destructive, desktop only, away from Save. */}
          <button
            type="button"
            onClick={onDuplicate}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-caption font-medium text-text-secondary rounded-sm hover:text-primary hover:bg-primary/5 transition-colors duration-150"
          >
            <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
            {t("recipes.duplicateAction")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-caption font-medium text-error rounded-sm hover:bg-error/5 transition-colors duration-150 disabled:opacity-50"
          >
            <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
            {t("common.delete")}
          </button>
          <span className="flex-1" />
          <span className="text-caption text-text-tertiary">
            {hasChanges
              ? t("recipes.settingsChangeCount", { count: changedCount })
              : t("recipes.settingsNoChange")}
          </span>
          {cancelButton}
          {saveButton}
        </div>
      </div>
    </div>,
    document.body,
  );
}

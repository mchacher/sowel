import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, Plus, Minus, Trash2, ScrollText, Loader2, Check, Copy, ShieldOff } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { formatTime } from "../../lib/format";
import { recipeName, recipeSlotName, recipeSlotDescription, recipeGroupLabel, recipeSlotOptionLabel } from "../../lib/recipe-i18n";
import { isSlotHidden, matchesEquipmentType } from "../../lib/recipe-slots";
import { groupSlots, isGroupFilled, isGroupRequired, getGroupKeys, durationToMinutes } from "./recipe-slot-helpers";
import {
  EquipmentOptions,
  MultiSelectChips,
  CountdownTimer,
  ModeCyclePill,
  DurationInput,
  TimeInput,
  SingleEquipmentZonePicker,
  EquipmentListPicker,
  EquipmentCheckboxList,
} from "./recipe-form-fields";
import { useZoneOptions } from "./useZoneOptions";
import { DuplicateRecipeModal } from "./DuplicateRecipeModal";
import { BottomSheet } from "../dashboard/BottomSheet";
import { useIsMobile } from "../../hooks/useIsMobile";

// ============================================================
// Instance row
// ============================================================

export function RecipeInstanceRow({
  instance,
  recipes,
  zoneId,
}: {
  instance: RecipeInstance;
  recipes: RecipeInfo[];
  zoneId: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const isMobile = useIsMobile();
  const deleteInstance = useRecipes((s) => s.deleteInstance);
  const updateInstance = useRecipes((s) => s.updateInstance);
  const enableInstance = useRecipes((s) => s.enableInstance);
  const disableInstance = useRecipes((s) => s.disableInstance);
  const sendAction = useRecipes((s) => s.sendAction);
  const getLog = useRecipes((s) => s.getLog);
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
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState<RecipeLogEntry[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());

  const recipe = recipes.find((r) => r.id === instance.recipeId);
  const displayName = recipe ? recipeName(recipe, lang) : instance.recipeId;

  const handleDelete = async () => {
    if (!confirm(t("recipes.deleteConfirm"))) return;
    setDeleting(true);
    try {
      await deleteInstance(instance.id);
    } catch {
      setDeleting(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    try {
      if (instance.enabled) {
        await disableInstance(instance.id);
      } else {
        await enableInstance(instance.id);
      }
    } catch {
      // ignore — store refresh will reflect actual state
    } finally {
      setToggling(false);
    }
  };

  const handleShowLog = async () => {
    if (showLog) {
      setShowLog(false);
      return;
    }
    const entries = await getLog(instance.id);
    setLogs(entries);
    setShowLog(true);
  };

  // Auto-refresh logs every 5s when the log panel is open
  useEffect(() => {
    if (!showLog) return;
    const id = setInterval(async () => {
      try {
        const entries = await getLog(instance.id);
        setLogs(entries);
      } catch {
        // Silent — don't break the UI if log fetch fails
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [showLog, instance.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSlotChanged = (slotId: string): boolean => {
    const val = instance.params[slotId];
    const original = Array.isArray(val) ? val.join(",") : String(val ?? "");
    return (editParams[slotId] ?? "") !== original;
  };

  const hasChanges = useMemo(() => {
    if (!editing || !recipe) return false;
    for (const slot of recipe.slots) {
      if (slot.id === "zone") continue;
      const val = instance.params[slot.id];
      const original = Array.isArray(val) ? val.join(",") : String(val ?? "");
      if ((editParams[slot.id] ?? "") !== original) return true;
    }
    return false;
  }, [editing, editParams, instance.params, recipe]);

  const handleStartEdit = () => {
    if (editing) {
      setEditing(false);
      setEditError("");
      return;
    }
    const params: Record<string, string> = {};
    // Initialize from existing instance params
    for (const [key, val] of Object.entries(instance.params)) {
      params[key] = Array.isArray(val) ? val.join(",") : String(val ?? "");
    }
    // Ensure all recipe slots have a value (for new slots not yet in params)
    if (recipe) {
      for (const slot of recipe.slots) {
        if (!(slot.id in params)) {
          params[slot.id] = slot.defaultValue !== undefined ? String(slot.defaultValue) : "";
        }
      }
    }
    setEditParams(params);
    setEditError("");
    // Initialize visible groups: show required groups + groups that already have data
    if (recipe) {
      const filled = new Set<string>();
      for (const gk of getGroupKeys(recipe.slots)) {
        if (isGroupRequired(gk, recipe.slots) || isGroupFilled(gk, recipe.slots, params)) filled.add(gk);
      }
      setVisibleGroups(filled);
    }
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditError("");
  };

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
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Unknown error");
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

  // (paramsSummary removed per spec 100 — recipe row keeps name + actions only, no description line)

  // Shared log list body — rendered inline on desktop and inside a bottom sheet
  // on the PWA/mobile (#615). Kept in one place so both stay in sync.
  const logBody =
    logs.length === 0 ? (
      <p className="text-[11px] text-text-tertiary text-center py-2">{t("common.noLogs")}</p>
    ) : (
      <div className="space-y-0.5">
        {logs.map((log) => (
          <div key={log.id} className="flex gap-2 text-[11px] font-mono">
            <span className="text-text-tertiary whitespace-nowrap">{formatTime(log.timestamp)}</span>
            <span
              className={
                log.level === "error"
                  ? "text-error"
                  : log.level === "warn"
                    ? "text-warning"
                    : "text-text-secondary"
              }
            >
              {log.message}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <div className={instance.enabled ? "" : "opacity-50"}>
      <div className="grid grid-cols-[32px_1fr_auto] gap-x-[0.85rem] gap-y-0 items-center px-[1.1rem] py-[0.35rem] min-h-[52px] border-t border-border-light">
        {/* Icon — spans both rows (mock .recipe__icon { grid-row: 1 / span 2 }) */}
        <div className={`row-span-2 self-center w-8 h-8 rounded-md flex items-center justify-center ${instance.enabled ? "bg-primary/10" : "bg-background"}`}>
          <ChefHat size={15} strokeWidth={1.5} className={instance.enabled ? "text-primary" : "text-text-tertiary"} />
        </div>
        {/* Row 1 col 2: name + inline pills */}
        <div className="col-start-2 row-start-1 flex items-center gap-2 min-w-0">
          <button
            onClick={isAdmin ? handleStartEdit : undefined}
            className={`flex-1 min-w-0 text-left transition-opacity duration-150 ${isAdmin ? "hover:opacity-70 cursor-pointer" : "cursor-default"}`}
            title={isAdmin ? "Edit" : undefined}
          >
            <div className="text-[14px] font-medium text-text truncate">
              {displayName}
            </div>
            {/* Optional recipe-provided status line (spec: state.summary).
                A recipe sets it to surface live context (e.g. a pool pump's
                "Filtration 2,1/9,6 h · heures creuses"). Absent → unchanged. */}
            {typeof instance.state?.summary === "string" &&
              instance.state.summary.length > 0 &&
              instance.enabled && (
                <div className="text-[11px] text-text-tertiary truncate mt-0.5">
                  {instance.state.summary}
                </div>
              )}
          </button>
          {!!instance.state?.timerExpiresAt && instance.enabled && (
            <CountdownTimer expiresAt={instance.state.timerExpiresAt as string} />
          )}
          {!!instance.state?.overrideMode && instance.enabled && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0"
              style={{ backgroundColor: "var(--color-accent-light)", color: "var(--color-accent)" }}
              title={t("recipes.overrideActive", "Override active")}
            >
              <ShieldOff size={10} strokeWidth={2} />
              Override
            </span>
          )}
          {recipe?.actions?.filter((a) => a.type === "cycle").map((action) => (
            <ModeCyclePill
              key={action.id}
              instance={instance}
              recipe={recipe}
              action={action}
              lang={lang}
              sendAction={sendAction}
            />
          ))}
        </div>
        {/* Row 1 col 3: toggle (admin only — enable/disable is config) */}
        {isAdmin && (
        <button
          onClick={handleToggleEnabled}
          disabled={toggling}
          className="col-start-3 row-start-1 relative w-8 h-[18px] rounded-full transition-colors duration-200 disabled:opacity-50 cursor-pointer disabled:cursor-default justify-self-end"
          style={{ backgroundColor: instance.enabled ? "var(--color-primary)" : "var(--color-border)" }}
          title={instance.enabled ? t("recipes.disable") : t("recipes.enable")}
          role="switch"
          aria-checked={instance.enabled}
        >
          <span
            className="absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform duration-200"
            style={{ transform: instance.enabled ? "translateX(14px)" : "translateX(0)" }}
          />
        </button>
        )}
        {/* Row 2: compact action buttons — admin only. The log button stays
            visible on mobile (read-only, opens a bottom sheet on the PWA, #615);
            duplicate / delete are config/destructive and stay desktop-only. */}
        {isAdmin && (
        <div className="col-start-2 col-span-2 row-start-2 flex items-center gap-[2px]">
          <button
            onClick={handleShowLog}
            className="w-8 h-8 sm:w-[22px] sm:h-[20px] inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
            title={t("recipes.viewLog")}
          >
            <ScrollText className="w-3.5 h-3.5 sm:w-3 sm:h-3" strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setShowDuplicate(true)}
            className="w-[22px] h-[20px] hidden sm:inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
            title={t("recipes.duplicate")}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-[22px] h-[20px] hidden sm:inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-error hover:bg-error/5 transition-colors duration-150 disabled:opacity-50"
            title={t("common.delete")}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
        )}
      </div>

      {/* Duplicate modal */}
      {showDuplicate && recipe && (
        <DuplicateRecipeModal
          instance={instance}
          recipe={recipe}
          sourceZoneId={zoneId}
          onClose={() => setShowDuplicate(false)}
        />
      )}

      {/* Edit form */}
      {editing && recipe && (
        <div className="px-4 pb-3">
          <div className="bg-border-light/20 border border-border-light rounded-[6px] p-3">
            {(() => {
              const filteredSlots = recipe.slots.filter((slot) => slot.id !== "zone" && shouldShowSlot(slot.id));
              const chunks = groupSlots(filteredSlots);
              const allGroupKeys = getGroupKeys(recipe.slots);
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
                            <span className="text-[11px] uppercase tracking-widest text-accent">{recipeGroupLabel(recipe, groupKey, lang)}</span>
                            {!isGroupRequired(groupKey, recipe.slots) && <button
                              type="button"
                              onClick={() => {
                                const next = { ...editParams };
                                for (const s of chunk.slots) next[s.id] = "";
                                setEditParams(next);
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
                              value={editParams[slot.id] ?? ""}
                              onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                              equipments={equipments}
                              zones={allZones}
                              recipe={recipe}
                              lang={lang}
                              labelClassName={`block text-[10px] tracking-wider mb-0.5 ${isSlotChanged(slot.id) ? "text-success" : "text-text-tertiary"}`}
                            />
                          ))}
                          {/* Compact grid for non-list slots */}
                          {(() => {
                            const compactSlots = chunk.slots.filter((s) => !((s.type === "equipment" || s.type === "select") && s.list) && !isSlotHidden(s, editParams, recipe.slots));
                            if (compactSlots.length === 0) return null;
                            const cols = compactSlots.length <= 3 ? compactSlots.length : 2;
                            return (
                              <div className={`grid gap-1.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                                {compactSlots.map((slot) => (
                                  <div key={slot.id}>
                                    <label className={`block text-[10px] tracking-wider mb-0.5 ${isSlotChanged(slot.id) ? "text-success" : "text-text-tertiary"}`}>
                                      {recipeSlotName(recipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                                    </label>
                                    {slot.type === "equipment" ? (
                                      <select
                                        value={editParams[slot.id] ?? ""}
                                        onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                                        className="w-full px-2 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                                      >
                                        <option value="">{t("common.select")}</option>
                                        <EquipmentOptions equipments={getEquipmentOptions(slot.id)} zoneChains={zoneChains} />
                                      </select>
                                    ) : slot.type === "data-key" ? (
                                      (() => {
                                        const eqSlot = recipe?.slots.find((s) => s.type === "equipment" && !s.list);
                                        const eqId = eqSlot ? editParams[eqSlot.id] : undefined;
                                        const eq = eqId ? equipments.find((e) => e.id === eqId) : undefined;
                                        const bindings = eq?.dataBindings ?? [];
                                        return (
                                          <select
                                            value={editParams[slot.id] ?? ""}
                                            onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
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
                                        value={String(editParams[slot.id] ?? slot.defaultValue ?? "")}
                                        onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                                        className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
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
                                        onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                                        placeholder={slot.constraints?.max ? `1-${slot.constraints.max}` : ""}
                                        className="w-full px-2 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                                      />
                                    )}
                                    <p className="text-[10px] text-text-tertiary mt-0.5">{recipeSlotDescription(recipe, slot, lang)}</p>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {/* Full-width multi-select slots (e.g. weekdays) — rendered as chips */}
                          {chunk.slots.filter((s) => s.type === "select" && s.list && !isSlotHidden(s, editParams, recipe.slots)).map((slot) => (
                            <div key={slot.id} className="mt-1.5">
                              <label className={`block text-[10px] tracking-wider mb-1 ${isSlotChanged(slot.id) ? "text-success" : "text-text-tertiary"}`}>
                                {recipeSlotName(recipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                              </label>
                              <MultiSelectChips
                                slot={slot}
                                value={editParams[slot.id] ?? ""}
                                onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                recipe={recipe}
                                lang={lang}
                              />
                              <p className="text-[10px] text-text-tertiary mt-0.5">{recipeSlotDescription(recipe, slot, lang)}</p>
                            </div>
                          ))}
                        </div>
                      );
                    }
                    // Ungrouped — render each slot individually (original logic)
                    return chunk.slots.map((slot) => isSlotHidden(slot, editParams, recipe.slots) ? null : (
                      <div key={slot.id} className={`mb-2.5 pl-2 border-l-2 transition-colors duration-150 ${isSlotChanged(slot.id) ? "border-success" : "border-transparent"}`}>
                        {slot.type === "boolean" ? (
                          <label className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150">
                            <input
                              type="checkbox"
                              checked={editParams[slot.id] === "true"}
                              onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.checked ? "true" : "false" })}
                              className="accent-primary"
                            />
                            {recipeSlotName(recipe, slot, lang)}
                          </label>
                        ) : (
                        <>
                        <label className={`block text-[11px] uppercase tracking-widest mb-1 ${isSlotChanged(slot.id) ? "text-success" : "text-text-tertiary"}`}>
                          {recipeSlotName(recipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
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
                              onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                            >
                              <option value="">{t("common.select")}</option>
                              <EquipmentOptions equipments={getEquipmentOptions(slot.id)} zoneChains={zoneChains} />
                            </select>
                          )
                        ) : slot.type === "data-key" ? (
                          (() => {
                            const eqSlot = recipe?.slots.find((s) => s.type === "equipment" && !s.list);
                            const eqId = eqSlot ? editParams[eqSlot.id] : undefined;
                            const eq = eqId ? equipments.find((e) => e.id === eqId) : undefined;
                            const bindings = eq?.dataBindings ?? [];
                            return (
                              <select
                                value={editParams[slot.id] ?? ""}
                                onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
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
                            value={editParams[slot.id] ?? ""}
                            onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                            placeholder={slot.defaultValue ? String(durationToMinutes(String(slot.defaultValue))) : undefined}
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
                            onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                            className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
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
                            placeholder={slot.defaultValue ? String(slot.defaultValue) : undefined}
                          />
                        ) : (
                          <input
                            type={slot.type === "number" ? "number" : "text"}
                            min={slot.constraints?.min}
                            max={slot.constraints?.max}
                            value={editParams[slot.id] ?? ""}
                            onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                            placeholder={slot.defaultValue ? String(slot.defaultValue) : recipeSlotDescription(recipe, slot, lang)}
                            className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                          />
                        )}
                        <p className="text-[11px] text-text-tertiary mt-0.5">{recipeSlotDescription(recipe, slot, lang)}</p>
                        </>
                        )}
                      </div>
                    ));
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
                          className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover transition-colors duration-150"
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
            {editError && (
              <p className="text-[12px] text-error mb-2">{editError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-[12px] font-medium rounded-[6px] transition-colors duration-150 disabled:opacity-40 ${
                  hasChanges ? "bg-success hover:brightness-110" : "bg-primary"
                }`}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={1.5} />}
                {t("common.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 bg-border-light text-text-secondary text-[12px] font-medium rounded-[6px] hover:bg-border transition-colors duration-150"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log panel — inline on desktop, a bottom sheet on the PWA/mobile (#615). */}
      {showLog && !isMobile && (
        <div className="px-4 pb-3">
          <div className="bg-border-light/40 rounded-[6px] p-2 max-h-[200px] overflow-y-auto">
            {logBody}
          </div>
        </div>
      )}
      <BottomSheet
        open={showLog && isMobile}
        onClose={() => setShowLog(false)}
        title={t("recipes.viewLog")}
        icon={<ScrollText size={18} strokeWidth={1.5} className="text-primary" />}
      >
        {logBody}
      </BottomSheet>
    </div>
  );
}

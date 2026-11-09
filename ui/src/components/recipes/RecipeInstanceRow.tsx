import { useState, useMemo, useId } from "react";
import { MarqueeName } from "../ui/MarqueeName";
import { useTranslation } from "react-i18next";
import { Plus, Minus, Trash2, Loader2, Check, Copy, ShieldOff, Settings } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
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
import {
  isSlotHidden,
  matchesEquipmentType,
  instanceEquipmentNames,
  shortNameList,
} from "../../lib/recipe-slots";
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
  CountdownTimer,
  ModeCyclePill,
  DurationInput,
  TimeInput,
  SingleEquipmentZonePicker,
  EquipmentListPicker,
  EquipmentCheckboxList,
} from "./recipe-form-fields";
import { resolveCycle } from "./recipe-cycle";
import { RecipeIconTile } from "./RecipeIconTile";
import { RecipeJournal } from "./RecipeJournal";
import { instanceContextLine, instanceSummary, isInstanceInAlarm } from "../../lib/recipe-rows";
import { useZoneOptions } from "./useZoneOptions";
import { DuplicateRecipeModal } from "./DuplicateRecipeModal";
import { BottomSheet } from "../dashboard/BottomSheet";
import { useIsMobile } from "../../hooks/useIsMobile";
import { FIELD_LABEL_UNTONED } from "../ui/text-roles";
import { Switch } from "../ui/Switch";
import { apiErrorText } from "../../lib/api-error";

// ============================================================
// Instance row
// ============================================================

export function RecipeInstanceRow({
  instance,
  recipes,
  zoneId,
  variant = "row",
}: {
  instance: RecipeInstance;
  recipes: RecipeInfo[];
  zoneId: string;
  /** "child": one line inside a group of the same recipe (spec 198). */
  variant?: "row" | "child";
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
  // What this instance acts on (#1165): the equipment of the recipe's first
  // equipment slot, so instances of one recipe can be told apart. Identity,
  // not state: shown on a disabled instance too.
  const equipmentNames = useMemo(
    () => (recipe ? instanceEquipmentNames(recipe.slots, instance.params, equipments) : []),
    [recipe, instance.params, equipments],
  );
  const equipmentList = shortNameList(equipmentNames);

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

  // The journal fetches and refreshes itself while shown (RecipeJournal).
  // The journal alone (spec 198): opening it closes the edit form.
  const handleShowLog = () => {
    if (!showLog) setEditing(false);
    setShowLog(!showLog);
  };

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
        if (isGroupRequired(gk, recipe.slots) || isGroupFilled(gk, recipe.slots, params))
          filled.add(gk);
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

  // Live pills (#1161), on the second line next to the context (spec 198).
  const showTimer = !!instance.state?.timerExpiresAt && instance.enabled;
  const showOverride = !!instance.state?.overrideMode && instance.enabled;
  const cycleActions =
    recipe?.actions?.filter((a) => a.type === "cycle" && resolveCycle(instance, a) !== null) ?? [];
  const hasPills = showTimer || showOverride || cycleActions.length > 0;

  // Spec 198 — the second line: « equipment, summary », red while in alarm
  // (the words are the recipe's own: state-watch says « en alarme »).
  const alarm = isInstanceInAlarm(instance);
  const summary = instance.enabled ? instanceSummary(instance) : "";
  const contextText = instanceContextLine(
    equipmentList.more > 0 ? `${equipmentList.text} +${equipmentList.more}` : equipmentList.text,
    summary,
  );
  // On hover, the whole equipment list (#1165), then the summary.
  const contextTitle = instanceContextLine(equipmentNames.join(", "), summary);
  const contextId = useId();

  const handleOpenSettings = () => {
    setShowLog(false);
    if (!editing) handleStartEdit();
  };

  const settingsButton = isAdmin && recipe && (
    <button
      type="button"
      onClick={handleOpenSettings}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-caption font-medium text-primary hover:bg-primary/8 transition-colors duration-150"
    >
      <Settings size={13} strokeWidth={1.5} aria-hidden="true" />
      {t("recipes.settings")}
    </button>
  );

  const pills = hasPills && (
    <span className="relative flex items-center gap-1.5 flex-shrink-0">
      {showTimer && <CountdownTimer expiresAt={instance.state?.timerExpiresAt as string} />}
      {showOverride && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-micro font-medium flex-shrink-0"
          style={{
            backgroundColor: "var(--color-primary-light)",
            color: "var(--color-primary)",
          }}
          title={t("recipes.overrideActive", "Override active")}
        >
          <ShieldOff size={10} strokeWidth={2} />
          {t("recipes.overrideBadge")}
        </span>
      )}
      {recipe &&
        cycleActions.map((action) => (
          <ModeCyclePill
            key={action.id}
            instance={instance}
            recipe={recipe}
            action={action}
            lang={lang}
            sendAction={sendAction}
            // A taller hit area on a phone without changing the pill's look.
            className="relative after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] sm:after:hidden"
          />
        ))}
    </span>
  );

  // Names, count and summary in their own spans: the names truncate first and
  // the count is never cut from the names it counts (#1165).
  const contextSpans = contextText ? (
    <span className="flex min-w-0" title={contextTitle}>
      {equipmentList.text && <span className="truncate">{equipmentList.text}</span>}
      {equipmentList.more > 0 && (
        <span className="flex-shrink-0 whitespace-pre"> +{equipmentList.more}</span>
      )}
      {summary && (
        <span className="truncate flex-shrink-[0.5]">
          {equipmentList.text ? `, ${summary}` : summary}
        </span>
      )}
    </span>
  ) : null;

  const toggle = isAdmin && (
    <Switch
      checked={instance.enabled}
      onChange={() => void handleToggleEnabled()}
      disabled={toggling}
      title={instance.enabled ? t("recipes.disable") : t("recipes.enable")}
      label={instance.enabled ? t("recipes.disable") : t("recipes.enable")}
      // Above the stretched button, so it keeps its own click.
      className={`relative ${variant === "row" ? "col-start-3 row-start-1 row-span-2 justify-self-end" : ""}`}
    />
  );

  const open = showLog || editing;
  // The row opens through one real button whose ::after covers the whole row
  // (equipment-row pattern): no interactive element nests in another, and the
  // switch and the pills, positioned after it, stay clickable (spec 198).
  const opener =
    "text-left min-w-0 cursor-pointer after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary";
  const rowSurface = `relative transition-colors duration-150 hover:bg-border-light/40 ${open ? "bg-border-light/40" : ""}`;
  // A child line lines its text up with the name of the group above it.
  const childIndent = "pl-[calc(1.1rem+32px+0.85rem)]";

  return (
    <div className={instance.enabled ? "" : "opacity-50"}>
      {variant === "row" ? (
        <div
          className={`grid grid-cols-[32px_1fr_auto] gap-x-[0.85rem] gap-y-0.5 items-center px-[1.1rem] py-2 min-h-[52px] ${rowSurface}`}
        >
          <RecipeIconTile
            icon={recipe?.icon}
            enabled={instance.enabled}
            alarm={alarm}
            className="row-span-2 self-center"
          />
          {/* The name owns line 1 (#1161); a name too long scrolls once (#1163). */}
          <button
            type="button"
            aria-expanded={showLog}
            aria-describedby={contextText ? contextId : undefined}
            onClick={handleShowLog}
            className={`col-start-2 row-start-1 ${opener}`}
          >
            <MarqueeName text={displayName} className="text-body font-medium text-text" />
          </button>
          {toggle}
          <div
            className={`col-start-2 row-start-2 flex items-center gap-x-2 min-w-0 text-caption ${alarm ? "text-error font-medium" : "text-text-secondary"}`}
          >
            {contextSpans && (
              <span id={contextId} className="flex min-w-0">
                {contextSpans}
              </span>
            )}
            {pills}
          </div>
        </div>
      ) : (
        <div
          className={`grid grid-cols-[1fr_auto] gap-x-[0.85rem] items-center pr-[1.1rem] ${childIndent} py-1 min-h-11 sm:min-h-9 ${rowSurface}`}
        >
          <div
            className={`flex items-center gap-x-2 min-w-0 text-small ${alarm ? "text-error font-medium" : "text-text-secondary"}`}
          >
            <button
              type="button"
              aria-expanded={showLog}
              onClick={handleShowLog}
              className={`flex ${opener}`}
            >
              {contextSpans ?? <span className="truncate">{displayName}</span>}
            </button>
            {pills}
          </div>
          {toggle}
        </div>
      )}

      {/* Journal — inline on desktop, a bottom sheet on the PWA/mobile (#615). */}
      {showLog && !isMobile && (
        <div className={`pb-3 pr-[1.1rem] ${childIndent}`}>
          <div className="bg-border-light/40 rounded-sm px-2.5 pt-1.5 pb-2 max-h-[260px] overflow-y-auto">
            <RecipeJournal instanceId={instance.id} action={settingsButton} />
          </div>
        </div>
      )}
      <BottomSheet
        open={showLog && isMobile}
        onClose={() => setShowLog(false)}
        title={displayName}
        icon={<RecipeIconTile icon={recipe?.icon} enabled={instance.enabled} alarm={alarm} />}
      >
        {/* The sheet names the instance: its second line under the title (spec 198). */}
        {contextText && (
          <p className={`text-small -mt-1 mb-2 ${alarm ? "text-error" : "text-text-secondary"}`}>
            {contextText}
          </p>
        )}
        {showLog && isMobile && <RecipeJournal instanceId={instance.id} action={settingsButton} />}
      </BottomSheet>

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
          <div className="bg-background rounded-md p-3">
            {(() => {
              const filteredSlots = recipe.slots.filter(
                (slot) => slot.id !== "zone" && shouldShowSlot(slot.id),
              );
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
                        <div key={groupKey} className="mb-2.5 pl-2 border-l-2 border-border">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-small font-medium text-text-secondary">
                              {recipeGroupLabel(recipe, groupKey, lang)}
                            </span>
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
                                      {slot.required && (
                                        <span className="text-error ml-0.5">*</span>
                                      )}
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
                                        value={String(
                                          editParams[slot.id] ?? slot.defaultValue ?? "",
                                        )}
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
                                        onChange={(v) =>
                                          setEditParams({ ...editParams, [slot.id]: v })
                                        }
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
                        </div>
                      );
                    }
                    // Ungrouped — render each slot individually (original logic)
                    return chunk.slots.map((slot) =>
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
                                  const eq = eqId
                                    ? equipments.find((e) => e.id === eqId)
                                    : undefined;
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
            {editError && <p className="text-caption text-error mb-2">{editError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-caption font-medium rounded-sm transition-colors duration-150 disabled:opacity-40 ${
                  hasChanges ? "bg-primary-fill hover:bg-primary-fill-hover" : "bg-primary-fill"
                }`}
              >
                {saving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} strokeWidth={1.5} />
                )}
                {t("common.save")}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 bg-border-light text-text-secondary text-caption font-medium rounded-sm hover:bg-border transition-colors duration-150"
              >
                {t("common.cancel")}
              </button>
              {/* Duplicate / delete are config and destructive: desktop only, as before. */}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShowDuplicate(true)}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 text-caption font-medium text-text-secondary rounded-sm hover:text-primary hover:bg-primary/5 transition-colors duration-150"
              >
                <Copy size={12} strokeWidth={1.5} aria-hidden="true" />
                {t("recipes.duplicateAction")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 text-caption font-medium text-error rounded-sm hover:bg-error/5 transition-colors duration-150 disabled:opacity-50"
              >
                <Trash2 size={12} strokeWidth={1.5} aria-hidden="true" />
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

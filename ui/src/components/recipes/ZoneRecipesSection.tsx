import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, Plus, Minus, Trash2, ScrollText, X, Loader2, ChevronLeft, ChevronRight, Timer, Check, Copy, ShieldOff } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry, RecipeActionDef, EquipmentWithDetails, Zone, ZoneWithChildren } from "../../types";
import type { EquipmentType } from "../../types";
import { formatTime } from "../../lib/format";
import { recipeName, recipeDescription, recipeSlotName, recipeSlotDescription, recipeGroupLabel } from "../../lib/recipe-i18n";
import type { RecipeSlotDef } from "../../types";


function matchesEquipmentType(eqType: string, constraint: EquipmentType | EquipmentType[]): boolean {
  const types = Array.isArray(constraint) ? constraint : [constraint];
  return types.some((t) => t === eqType);
}

/** A chunk is either a single ungrouped slot or a group of slots sharing the same group key. */
interface SlotChunk {
  group: string | null;
  slots: RecipeSlotDef[];
}

/** Group consecutive slots by their `group` field. Ungrouped slots become individual chunks. */
function groupSlots(slots: RecipeSlotDef[]): SlotChunk[] {
  const chunks: SlotChunk[] = [];
  for (const slot of slots) {
    const group = slot.group ?? null;
    const last = chunks[chunks.length - 1];
    if (last && last.group === group && group !== null) {
      last.slots.push(slot);
    } else {
      chunks.push({ group, slots: [slot] });
    }
  }
  return chunks;
}

/** Check if a group has meaningful data — the first slot in the group must have a value. */
function isGroupFilled(group: string, allSlots: RecipeSlotDef[], paramsRecord: Record<string, string>): boolean {
  const firstSlot = allSlots.find((s) => s.group === group);
  if (!firstSlot) return false;
  return (paramsRecord[firstSlot.id] ?? "") !== "";
}

/** Check if a group contains at least one required slot — such groups are always visible. */
function isGroupRequired(group: string, allSlots: RecipeSlotDef[]): boolean {
  return allSlots.some((s) => s.group === group && s.required);
}

/** Get all unique group keys from slots. */
function getGroupKeys(slots: RecipeSlotDef[]): string[] {
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.group) seen.add(slot.group);
  }
  return [...seen];
}

interface ZoneRecipesSectionProps {
  zoneId: string;
  zoneName: string;
}

export function ZoneRecipesSection({ zoneId, zoneName }: ZoneRecipesSectionProps) {
  const { t } = useTranslation();
  const recipes = useRecipes((s) => s.recipes);
  const instances = useRecipes((s) => s.instances);
  const fetchRecipes = useRecipes((s) => s.fetchRecipes);
  const fetchInstances = useRecipes((s) => s.fetchInstances);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchRecipes();
    fetchInstances();
  }, [fetchRecipes, fetchInstances]);

  // Filter instances that belong to this zone
  const zoneInstances = useMemo(() => {
    return instances.filter((inst) => inst.params.zone === zoneId);
  }, [instances, zoneId]);

  if (recipes.length === 0 && zoneInstances.length === 0) return null;

  return (
    <div className="rounded-[10px] border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1 bg-accent/8">
        <span className="text-accent">
          <ChefHat size={14} strokeWidth={1.5} />
        </span>
        <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {t("recipes.title")}
        </span>
        <span className="text-[11px] text-text-tertiary ml-auto tabular-nums">
          {zoneInstances.length}
        </span>
        <button
          onClick={() => setShowForm(true)}
          className="ml-2 p-1 rounded-[4px] text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
          title={t("recipes.addRecipe")}
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </div>

      {zoneInstances.length > 0 && (
        <div className="divide-y divide-border-light">
          {zoneInstances.map((inst) => (
            <RecipeInstanceRow key={inst.id} instance={inst} recipes={recipes} zoneId={zoneId} />
          ))}
        </div>
      )}

      {zoneInstances.length === 0 && !showForm && (
        <div className="flex items-center justify-center gap-2 px-4 py-3 text-[12px] text-text-tertiary">
          <span>{t("recipes.noActiveRecipes", { name: zoneName })}</span>
          <button
            onClick={() => setShowForm(true)}
            className="text-primary hover:text-primary-hover transition-colors duration-150"
          >
            {t("recipes.addRecipe")}
          </button>
        </div>
      )}

      {showForm && (
        <AddRecipeForm
          zoneId={zoneId}
          recipes={recipes}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Mode cycle pill (for recipe actions with type "cycle")
// ============================================================

const MODE_PILL_COLORS: Record<string, { bg: string; text: string }> = {
  eco: { bg: "var(--color-success-light, #dcfce7)", text: "var(--color-success, #16a34a)" },
  comfort: { bg: "var(--color-primary-light)", text: "var(--color-primary)" },
  cocoon: { bg: "var(--color-accent-light)", text: "var(--color-accent)" },
  night: { bg: "#ede9fe", text: "#7c3aed" },
};
const DEFAULT_PILL = { bg: "var(--color-border-light)", text: "var(--color-text-secondary)" };

function ModeCyclePill({
  instance,
  recipe,
  action,
  lang,
  sendAction,
}: {
  instance: RecipeInstance;
  recipe: RecipeInfo;
  action: RecipeActionDef;
  lang: string;
  sendAction: (instanceId: string, action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);

  const currentValue = instance.state?.[action.stateKey] as string | undefined;
  if (!currentValue || !instance.enabled) return null;

  // Filter options: hide cocoon/night if their temp is not configured
  const availableOptions = action.options.filter((opt) => {
    if (opt.value === "cocoon" && !instance.params.cocoonTemp) return false;
    if (opt.value === "night" && !instance.params.nightTemp) return false;
    return true;
  });
  if (availableOptions.length < 2) return null;

  const currentIndex = availableOptions.findIndex((o) => o.value === currentValue);
  const nextIndex = (currentIndex + 1) % availableOptions.length;
  const nextOption = availableOptions[nextIndex];
  const currentOption = availableOptions[currentIndex >= 0 ? currentIndex : 0];

  const colors = MODE_PILL_COLORS[currentValue] ?? DEFAULT_PILL;

  // Resolve label with i18n
  const i18nPack = lang && recipe.i18n?.[lang];
  const displayLabel = i18nPack
    ? t(`recipes.actions.${action.id}.${currentValue}`, { defaultValue: currentOption.label })
    : currentOption.label;

  const handleClick = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sendAction(instance.id, action.id, { mode: nextOption.value });
    } catch {
      // ignore — state refreshed via WebSocket
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={sending}
      className="inline-flex items-center gap-1 px-2 py-[1.5px] rounded-full text-[10px] leading-tight font-semibold transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default hover:brightness-95 active:scale-95 flex-shrink-0"
      style={{ backgroundColor: colors.bg, color: colors.text }}
      title={t("recipes.actions.cycleTo", { mode: nextOption.label, defaultValue: `Click to switch to ${nextOption.label}` })}
    >
      {displayLabel}
    </button>
  );
}

// ============================================================
// Instance row
// ============================================================

function RecipeInstanceRow({
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
  const allZones = useMemo(() => {
    const flat: { id: string; name: string }[] = [];
    const walk = (nodes: ZoneWithChildren[]) => {
      for (const n of nodes) { flat.push({ id: n.id, name: n.name }); if (n.children.length > 0) walk(n.children); }
    };
    walk(zoneTree);
    return flat;
  }, [zoneTree]);
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

    // Check if this slot targets a global equipment type
    const isGlobalSlot = slot.constraints?.equipmentType &&
      (Array.isArray(slot.constraints.equipmentType)
        ? slot.constraints.equipmentType.some((t) => GLOBAL_EQUIPMENT_TYPES.has(t))
        : GLOBAL_EQUIPMENT_TYPES.has(slot.constraints.equipmentType));

    return equipments.filter((eq) => {
      if (!isGlobalSlot && eq.zoneId !== zoneId) return false;
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

  // Build a human-readable summary of params
  const paramsSummary = useMemo(() => {
    if (!recipe) return "";
    const parts: string[] = [];
    const renderedGroups = new Set<string>();

    for (const slot of recipe.slots) {
      if (slot.id === "zone") continue;

      // Grouped slots: render the group once as "GroupLabel: val1 (val2, val3)"
      if (slot.group) {
        if (renderedGroups.has(slot.group)) continue;
        renderedGroups.add(slot.group);

        const groupSlots = recipe.slots.filter((s) => s.group === slot.group);

        // Skip the group if its first slot is empty (incomplete group)
        const firstVal = instance.params[groupSlots[0]?.id];
        if (firstVal === undefined || firstVal === null || firstVal === "") continue;

        const groupValues = groupSlots
          .map((s) => {
            const v = instance.params[s.id];
            if (v === undefined || v === null || v === "") return null;
            if (s.type === "equipment") {
              const eq = equipments.find((e) => e.id === v);
              return eq?.name ?? String(v);
            }
            return String(v);
          })
          .filter(Boolean) as string[];

        if (groupValues.length === 0) continue;

        const groupLabel = recipeGroupLabel(recipe, slot.group, lang);
        if (groupValues.length === 1) {
          parts.push(`${groupLabel}: ${groupValues[0]}`);
        } else {
          parts.push(`${groupLabel}: ${groupValues[0]} (${groupValues.slice(1).join(", ")})`);
        }
        continue;
      }

      // Ungrouped slots: render individually
      const val = instance.params[slot.id];
      if (val === undefined || val === null || val === "" || val === "false") continue;
      if (slot.type === "equipment" && Array.isArray(val)) {
        const names = val
          .map((id: string) => equipments.find((e) => e.id === id)?.name ?? id)
          .join(", ");
        parts.push(names);
      } else if (slot.type === "equipment") {
        const eq = equipments.find((e) => e.id === val);
        parts.push(eq?.name ?? String(val));
      } else if (slot.type === "boolean") {
        if (val === "true" || val === true) {
          parts.push(recipeSlotName(recipe, slot, lang));
        }
      } else {
        parts.push(`${recipeSlotName(recipe, slot, lang)}: ${String(val)}`);
      }
    }
    return parts.join(" · ");
  }, [instance.params, recipe, equipments, lang]);

  return (
    <div className={instance.enabled ? "" : "opacity-50"}>
      <div className="px-4 py-2.5">
        {/* Row 1: icon + name + toggle */}
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-[6px] flex items-center justify-center flex-shrink-0 ${instance.enabled ? "bg-accent/10" : "bg-border-light"}`}>
            <ChefHat size={14} strokeWidth={1.5} className={instance.enabled ? "text-accent" : "text-text-tertiary"} />
          </div>
          <button
            onClick={handleStartEdit}
            className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity duration-150"
            title="Edit"
          >
            <div className="text-[13px] font-medium text-text truncate">
              {displayName}
            </div>
            {paramsSummary && (
              <div className="text-[11px] text-text-tertiary truncate">
                {paramsSummary}
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
          <button
            onClick={handleToggleEnabled}
            disabled={toggling}
            className="relative w-8 h-[18px] rounded-full transition-colors duration-200 disabled:opacity-50 flex-shrink-0 cursor-pointer disabled:cursor-default"
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
        </div>
        {/* Row 2: action buttons — desktop only */}
        <div className="hidden sm:flex items-center gap-1 mt-1.5 ml-10">
          <button
            onClick={handleShowLog}
            className="p-1.5 rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
            title={t("recipes.viewLog")}
          >
            <ScrollText size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setShowDuplicate(true)}
            className="p-1.5 rounded-[4px] text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
            title={t("recipes.duplicate")}
          >
            <Copy size={14} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-[4px] text-text-tertiary hover:text-error hover:bg-error/5 transition-colors duration-150 disabled:opacity-50"
            title={t("common.delete")}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        </div>
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
                            <span className="text-[11px] uppercase tracking-wider text-accent">{recipeGroupLabel(recipe, groupKey, lang)}</span>
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
                            const compactSlots = chunk.slots.filter((s) => !(s.type === "equipment" && s.list));
                            if (compactSlots.length === 0) return null;
                            const cols = Math.min(compactSlots.length, 3);
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
                                        {getEquipmentOptions(slot.id).map((eq) => (
                                          <option key={eq.id} value={eq.id}>{eq.name}</option>
                                        ))}
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
                                    ) : slot.type === "time" ? (
                                      <TimeInput
                                        value={editParams[slot.id] ?? ""}
                                        onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                                      />
                                    ) : (
                                      <input
                                        type="text"
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
                        </div>
                      );
                    }
                    // Ungrouped — render each slot individually (original logic)
                    return chunk.slots.map((slot) => (
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
                        <label className={`block text-[11px] uppercase tracking-wider mb-1 ${isSlotChanged(slot.id) ? "text-success" : "text-text-tertiary"}`}>
                          {recipeSlotName(recipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                        </label>
                        {slot.type === "equipment" && slot.list ? (
                          <div className="space-y-1">
                            {getEquipmentOptions(slot.id).map((eq) => {
                              const selected = (editParams[slot.id] ?? "").split(",").filter(Boolean);
                              const checked = selected.includes(eq.id);
                              return (
                                <label key={eq.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = checked
                                        ? selected.filter((id) => id !== eq.id)
                                        : [...selected, eq.id];
                                      setEditParams({ ...editParams, [slot.id]: next.join(",") });
                                    }}
                                    className="accent-primary"
                                  />
                                  {eq.name}
                                </label>
                              );
                            })}
                          </div>
                        ) : slot.type === "equipment" ? (
                          <select
                            value={editParams[slot.id] ?? ""}
                            onChange={(e) => setEditParams({ ...editParams, [slot.id]: e.target.value })}
                            className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                          >
                            <option value="">{t("common.select")}</option>
                            {getEquipmentOptions(slot.id).map((eq) => (
                              <option key={eq.id} value={eq.id}>{eq.name}</option>
                            ))}
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
                        ) : slot.type === "time" ? (
                          <TimeInput
                            value={editParams[slot.id] ?? ""}
                            onChange={(v) => setEditParams({ ...editParams, [slot.id]: v })}
                            placeholder={slot.defaultValue ? String(slot.defaultValue) : undefined}
                          />
                        ) : (
                          <input
                            type="text"
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

      {/* Log panel */}
      {showLog && (
        <div className="px-4 pb-3">
          <div className="bg-border-light/40 rounded-[6px] p-2 max-h-[200px] overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-[11px] text-text-tertiary text-center py-2">{t("common.noLogs")}</p>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2 text-[11px] font-mono">
                    <span className="text-text-tertiary whitespace-nowrap">
                      {formatTime(log.timestamp)}
                    </span>
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Duplicate recipe modal
// ============================================================

function DuplicateRecipeModal({
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

  // Flatten zone tree to a flat list
  const allZones = useMemo(() => {
    const flat: Zone[] = [];
    const walk = (nodes: ZoneWithChildren[]) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children.length > 0) walk(n.children);
      }
    };
    walk(zoneTree);
    return flat;
  }, [zoneTree]);

  // Equipment slots that need remapping
  const equipmentSlots = useMemo(() => {
    return recipe.slots.filter(
      (s) => s.type === "equipment" && instance.params[s.id],
    );
  }, [recipe.slots, instance.params]);

  // Other zones (exclude current)
  const otherZones = useMemo(() => {
    return allZones.filter((z: Zone) => z.id !== sourceZoneId);
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
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("recipes.targetZone")}
            </label>
            <select
              value={targetZoneId}
              onChange={(e) => setTargetZoneId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {otherZones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          {/* Equipment mapping */}
          {targetZoneId && equipmentSlots.map((slot) => {
            const compatible = getCompatibleEquipments(slot.id);
            return (
              <div key={slot.id}>
                <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
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
                    {compatible.map((eq) => (
                      <option key={eq.id} value={eq.id}>{eq.name}</option>
                    ))}
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

// ============================================================
// Countdown timer — shows remaining time before auto-off
// ============================================================

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => computeRemaining(expiresAt));

  useEffect(() => {
    setRemaining(computeRemaining(expiresAt)); // eslint-disable-line react-hooks/set-state-in-effect -- sync initial remaining before starting interval
    const id = setInterval(() => setRemaining(computeRemaining(expiresAt)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining <= 0) return null;

  return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-accent tabular-nums flex-shrink-0">
      <Timer size={12} strokeWidth={1.5} />
      {formatCountdown(remaining)}
    </span>
  );
}

function computeRemaining(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${sec > 0 ? String(sec).padStart(2, "0") + "s" : ""}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, "0")}`;
}

// ============================================================
// Duration input — numeric field with "min" suffix
// ============================================================

/** Parse a duration string ("10m", "30s", "1h") to minutes. Returns NaN if invalid. */
function durationToMinutes(value: string): number {
  if (!value) return NaN;
  const match = value.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) return NaN;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return num / 60;
    case "m": return num;
    case "h": return num * 60;
    default: return NaN;
  }
}

function DurationInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (durationStr: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  // Convert stored "Xm" to numeric minutes for display
  const minutes = durationToMinutes(value);
  const displayValue = !isNaN(minutes) ? String(minutes) : "";

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        value={displayValue}
        onChange={(e) => {
          const num = e.target.value;
          if (num === "") {
            onChange("");
          } else {
            onChange(`${num}m`);
          }
        }}
        placeholder={placeholder ?? "10"}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
      />
      <span className="text-[12px] text-text-tertiary font-medium">{t("time.min")}</span>
    </div>
  );
}

// ============================================================
// Time input — native time picker for HH:MM
// ============================================================

function TimeInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (timeStr: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="time"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "08:00"}
      className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
    />
  );
}

// ============================================================
// Equipment list picker — zone + equipment + add button
// ============================================================

function EquipmentListPicker({
  slot,
  value,
  onChange,
  equipments,
  zones,
  recipe,
  lang,
  labelClassName,
}: {
  slot: RecipeSlotDef;
  value: string;
  onChange: (value: string) => void;
  equipments: EquipmentWithDetails[];
  zones: { id: string; name: string }[];
  recipe: RecipeInfo;
  lang: string;
  labelClassName?: string;
}) {
  const { t } = useTranslation();
  const [pickerZoneId, setPickerZoneId] = useState("");

  const selectedIds = value.split(",").filter(Boolean);

  const matchesConstraint = (eq: EquipmentWithDetails) => {
    if (!slot.constraints?.equipmentType) return true;
    return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
  };

  // Zones that have matching, non-selected equipments
  const zonesWithOptions = useMemo(() => {
    return zones.filter((z) =>
      equipments.some((eq) => eq.zoneId === z.id && !selectedIds.includes(eq.id) && matchesConstraint(eq))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, equipments, selectedIds, slot.constraints?.equipmentType]);

  // Equipments in picked zone matching constraints
  const pickerOptions = useMemo(() => {
    if (!pickerZoneId) return [];
    return equipments.filter((eq) =>
      eq.zoneId === pickerZoneId && !selectedIds.includes(eq.id) && matchesConstraint(eq)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerZoneId, equipments, selectedIds, slot.constraints?.equipmentType]);

  const handleRemove = (eqId: string) => {
    const next = selectedIds.filter((id) => id !== eqId);
    onChange(next.join(","));
  };

  return (
    <div className="mb-1.5">
      <label className={labelClassName ?? "block text-[10px] tracking-wider mb-0.5 text-text-tertiary"}>
        {recipeSlotName(recipe, slot, lang)}
      </label>

      {/* Selected items */}
      {selectedIds.map((id) => {
        const eq = equipments.find((e) => e.id === id);
        const zone = eq ? zones.find((z) => z.id === eq.zoneId) : null;
        return (
          <div key={id} className="flex items-center gap-2 px-2 py-1 mb-1 text-[13px] bg-surface border border-border rounded-[6px]">
            <span className="flex-1 text-text truncate">{eq?.name ?? id}</span>
            {zone && <span className="text-[11px] text-text-tertiary shrink-0">{zone.name}</span>}
            <button type="button" onClick={() => handleRemove(id)} className="p-0.5 text-text-tertiary hover:text-error transition-colors">
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}

      {/* Add row: zone + equipment + button */}
      {zonesWithOptions.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select
            value={pickerZoneId}
            onChange={(e) => setPickerZoneId(e.target.value)}
            className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text"
          >
            <option value="">Zone…</option>
            {zonesWithOptions.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
          <select
            value=""
            onChange={(e) => {
              const eqId = e.target.value;
              if (eqId) {
                const next = [...selectedIds, eqId];
                onChange(next.join(","));
                const remaining = pickerOptions.filter((eq) => eq.id !== eqId);
                if (remaining.length === 0) setPickerZoneId("");
              }
            }}
            disabled={!pickerZoneId}
            className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text disabled:opacity-40"
          >
            <option value="">{t("common.select")}</option>
            {pickerOptions.map((eq) => (
              <option key={eq.id} value={eq.id}>{eq.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Add recipe wizard (step 1: choose recipe, step 2: configure)
// ============================================================

type WizardStep = "choose" | "configure";

function AddRecipeForm({
  zoneId,
  recipes,
  onClose,
}: {
  zoneId: string;
  recipes: RecipeInfo[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const createInstance = useRecipes((s) => s.createInstance);
  const instances = useRecipes((s) => s.instances);
  const equipments = useEquipments((s) => s.equipments);
  const zoneAggregation = useZoneAggregation((s) => s.data);
  const zoneTree = useZones((s) => s.tree);
  const [step, setStep] = useState<WizardStep>("choose");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [visibleGroups, setVisibleGroups] = useState<Set<string>>(new Set());

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  // Flatten zone tree for equipment list picker
  const allZones = useMemo(() => {
    const flat: { id: string; name: string }[] = [];
    const walk = (nodes: ZoneWithChildren[]) => {
      for (const n of nodes) { flat.push({ id: n.id, name: n.name }); if (n.children.length > 0) walk(n.children); }
    };
    walk(zoneTree);
    return flat;
  }, [zoneTree]);

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

    return equipments.filter((eq) => {
      if (!isGlobalSlot && eq.zoneId !== zoneId) return false;
      if (slot.type === "equipment" && !slot.list && usedLightIds.has(eq.id)) return false;
      if (slot.constraints?.equipmentType) {
        return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
      }
      return true;
    });
  };

  // Check if a recipe has available equipment slots (to disable recipes with no free lights)
  const hasAvailableEquipments = (recipe: RecipeInfo): boolean => {
    for (const slot of recipe.slots) {
      if (slot.type !== "equipment") continue;
      if (!slot.required) continue; // optional equipment slots don't block creation
      const available = equipments.filter((eq) => {
        if (eq.zoneId !== zoneId) return false;
        if (!slot.list && usedLightIds.has(eq.id)) return false;
        if (slot.constraints?.equipmentType) {
          return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
        }
        return true;
      });
      if (available.length === 0) return false;
    }
    return true;
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

  const handleSelectRecipe = (recipeId: string) => {
    setSelectedRecipeId(recipeId);
    setStep("configure");
  };

  const handleBack = () => {
    setStep("choose");
    setSelectedRecipeId("");
    setError("");
  };

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
        <div className="flex items-center gap-2">
          {step === "configure" && (
            <button
              onClick={handleBack}
              className="p-1 rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
            </button>
          )}
          <span className="text-[13px] font-medium text-text">
            {step === "choose" ? t("recipes.chooseRecipe") : selectedRecipe ? recipeName(selectedRecipe, lang) : ""}
          </span>
        </div>
        <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text transition-colors duration-150">
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-3">
        <div className={`h-1 flex-1 rounded-full ${step === "choose" ? "bg-primary" : "bg-primary/30"}`} />
        <div className={`h-1 flex-1 rounded-full ${step === "configure" ? "bg-primary" : "bg-border-light"}`} />
      </div>

      {/* Step 1: Choose recipe */}
      {step === "choose" && (() => {
        const allUnavailable = recipes.length > 0 && recipes.every((r) => !hasAvailableEquipments(r));

        if (allUnavailable) {
          return (
            <div className="text-center py-4">
              <p className="text-[13px] text-text-secondary">
                {t("recipes.allLightsManaged")}
              </p>
              <p className="text-[11px] text-text-tertiary mt-1">
                {t("recipes.deleteSuggestion")}
              </p>
              <button
                onClick={onClose}
                className="mt-3 px-4 py-1.5 bg-border-light text-text-secondary text-[12px] font-medium rounded-[6px] hover:bg-border transition-colors duration-150"
              >
                {t("common.close")}
              </button>
            </div>
          );
        }

        return (
          <div className="space-y-2">
            {recipes.map((recipe) => {
              const available = hasAvailableEquipments(recipe);
              return (
                <button
                  key={recipe.id}
                  onClick={() => available && handleSelectRecipe(recipe.id)}
                  disabled={!available}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[8px] border transition-all duration-150 text-left group ${
                    available
                      ? "border-border hover:border-primary/40 hover:bg-primary/5"
                      : "border-border-light opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-[6px] flex items-center justify-center flex-shrink-0 transition-colors duration-150 ${
                    available ? "bg-accent/10 group-hover:bg-accent/15" : "bg-border-light"
                  }`}>
                    <ChefHat size={16} strokeWidth={1.5} className={available ? "text-accent" : "text-text-tertiary"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text">
                      {recipeName(recipe, lang)}
                    </div>
                    <div className="text-[11px] text-text-tertiary line-clamp-1">
                      {available ? recipeDescription(recipe, lang) : t("recipes.allLightsManagedShort")}
                    </div>
                  </div>
                  {available && (
                    <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary group-hover:text-primary flex-shrink-0 transition-colors duration-150" />
                  )}
                </button>
              );
            })}
            {recipes.length === 0 && (
              <p className="text-[13px] text-text-tertiary text-center py-4">
                {t("recipes.noRecipesAvailable")}
              </p>
            )}
          </div>
        );
      })()}

      {/* Step 2: Configure parameters */}
      {step === "configure" && selectedRecipe && (
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
                          <span className="text-[11px] uppercase tracking-wider text-accent">{recipeGroupLabel(selectedRecipe, groupKey, lang)}</span>
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
                          const compactSlots = chunk.slots.filter((s) => !(s.type === "equipment" && s.list));
                          if (compactSlots.length === 0) return null;
                          const n = compactSlots.length;
                          const cols = n <= 3 ? n : n % 3 === 0 ? 3 : 2;
                          return (
                            <div className={`grid gap-1.5 ${cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-[1fr_auto]" : "grid-cols-3"}`}>
                              {compactSlots.map((slot) => (
                                <div key={slot.id} className={slot.type === "number" ? "w-[100px]" : ""}>
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
                                      {getEquipmentOptions(slot.id).map((eq) => (
                                        <option key={eq.id} value={eq.id}>{eq.name}</option>
                                      ))}
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
                                  ) : slot.type === "time" ? (
                                    <TimeInput
                                      value={params[slot.id] ?? ""}
                                      onChange={(v) => setParams({ ...params, [slot.id]: v })}
                                    />
                                  ) : (
                                    <input
                                      type="text"
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
                      </div>
                    );
                  }
                  // Ungrouped — render each slot individually
                  return chunk.slots.map((slot) => (
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
                      <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                        {recipeSlotName(selectedRecipe, slot, lang)}{slot.required && <span className="text-error ml-0.5">*</span>}
                      </label>
                      {slot.type === "equipment" && slot.list ? (
                        <div className="space-y-1">
                          {getEquipmentOptions(slot.id).map((eq) => {
                            const selected = (params[slot.id] ?? "").split(",").filter(Boolean);
                            const checked = selected.includes(eq.id);
                            return (
                              <label key={eq.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = checked
                                      ? selected.filter((id) => id !== eq.id)
                                      : [...selected, eq.id];
                                    setParams({ ...params, [slot.id]: next.join(",") });
                                  }}
                                  className="accent-primary"
                                />
                                {eq.name}
                              </label>
                            );
                          })}
                        </div>
                      ) : slot.type === "equipment" ? (
                        <select
                          value={params[slot.id] ?? ""}
                          onChange={(e) => setParams({ ...params, [slot.id]: e.target.value })}
                          className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                        >
                          <option value="">{t("common.select")}</option>
                          {getEquipmentOptions(slot.id).map((eq) => (
                            <option key={eq.id} value={eq.id}>{eq.name}</option>
                          ))}
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
                      ) : slot.type === "time" ? (
                        <TimeInput
                          value={params[slot.id] ?? ""}
                          onChange={(v) => setParams({ ...params, [slot.id]: v })}
                          placeholder={slot.defaultValue ? String(slot.defaultValue) : undefined}
                        />
                      ) : (
                        <input
                          type="text"
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

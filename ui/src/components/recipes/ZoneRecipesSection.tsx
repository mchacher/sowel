import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, Plus, Minus, Trash2, ScrollText, X, Loader2, Timer, Check, Copy, ShieldOff } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import { useZones } from "../../store/useZones";
import { useZoneAggregation } from "../../store/useZoneAggregation";
import { useAuth } from "../../store/useAuth";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry, RecipeActionDef, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { formatTime } from "../../lib/format";
import { recipeName, recipeDescription, recipeSlotName, recipeSlotDescription, recipeGroupLabel, recipeSlotOptionLabel } from "../../lib/recipe-i18n";
import { isSlotHidden, matchesEquipmentType, equipmentCandidates } from "../../lib/recipe-slots";
import { flattenZonesWithPath, zoneChainMap, equipmentLabelMap, type ZoneOption } from "../../lib/zone-path";
import type { RecipeSlotDef } from "../../types";

/**
 * `<option>` list of an equipment dropdown (spec 139). Integrations name every
 * sensor alike ("Température"), so a bare name does not say which room it is
 * in; the zone is appended only to the names that actually repeat in this
 * list, since a compact dropdown truncates whatever it cannot fit.
 */
function EquipmentOptions({
  equipments,
  zoneChains,
}: {
  equipments: EquipmentWithDetails[];
  zoneChains: Map<string, string[]>;
}) {
  const labels = equipmentLabelMap(equipments, zoneChains);
  return (
    <>
      {equipments.map((eq) => (
        <option key={eq.id} value={eq.id}>
          {labels.get(eq.id) ?? eq.name}
        </option>
      ))}
    </>
  );
}


/** Multi-select renderer for a `select` slot with `list: true`: one toggle chip
 *  per option. Stores the selected option values as a comma-joined string, the
 *  same convention used by equipment-list slots (e.g. "mon,tue,thu,fri"). An
 *  empty value means "nothing selected" — recipes read that as their default. */
function MultiSelectChips({
  slot,
  value,
  onChange,
  recipe,
  lang,
}: {
  slot: RecipeSlotDef;
  value: string;
  onChange: (value: string) => void;
  recipe: RecipeInfo;
  lang: string;
}) {
  const selected = value.split(",").filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {(slot.options ?? []).map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              const next = on
                ? selected.filter((v) => v !== o.value)
                : [...selected, o.value];
              onChange(next.join(","));
            }}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-[6px] border transition-colors duration-150 ${
              on
                ? "bg-primary border-primary text-white"
                : "bg-surface border-border text-text-secondary hover:border-primary"
            }`}
          >
            {recipeSlotOptionLabel(recipe, slot, o.value, lang)}
          </button>
        );
      })}
    </div>
  );
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

// ============================================================
// Recipe picker popover — opens from the "+" button in the zone header
// ============================================================

function RecipePickerPopover({
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
  const isAdmin = useAuth((s) => s.user?.role === "admin");
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
  const allZones = useMemo(() => flattenZonesWithPath(zoneTree), [zoneTree]);
  const zoneChains = useMemo(() => zoneChainMap(allZones), [allZones]);
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
        {/* Row 2: compact action buttons — admin only (log / duplicate / delete are config) */}
        {isAdmin && (
        <div className="col-start-2 col-span-2 row-start-2 hidden sm:flex items-center gap-[2px]">
          <button
            onClick={handleShowLog}
            className="w-[22px] h-[20px] inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
            title={t("recipes.viewLog")}
          >
            <ScrollText size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setShowDuplicate(true)}
            className="w-[22px] h-[20px] inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
            title={t("recipes.duplicate")}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-[22px] h-[20px] inline-flex items-center justify-center rounded-[4px] text-text-tertiary hover:text-error hover:bg-error/5 transition-colors duration-150 disabled:opacity-50"
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

  // Flatten zone tree to a flat list, each zone qualified by its ancestors
  const allZones = useMemo(() => flattenZonesWithPath(zoneTree), [zoneTree]);
  const zoneChains = useMemo(() => zoneChainMap(allZones), [allZones]);

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
// Single equipment picker with zone-first selection — used for slots
// with constraints.crossZone or includeDescendants
// ============================================================

/**
 * Zone dropdown then equipment dropdown, for a single-equipment slot whose scope
 * is wider than the recipe's own zone (`crossZone` / `includeDescendants`).
 *
 * `equipments` arrives already filtered against the slot's constraints by the
 * caller's `getEquipmentOptions`, so this picker only ever splits that list by
 * zone.
 */
function SingleEquipmentZonePicker({
  value,
  onChange,
  equipments,
  zones,
}: {
  value: string;
  onChange: (value: string) => void;
  equipments: EquipmentWithDetails[];
  zones: ZoneOption[];
}) {
  const { t } = useTranslation();

  const selectedEq = value ? equipments.find((e) => e.id === value) : undefined;
  const [pickerZoneId, setPickerZoneId] = useState<string>(selectedEq?.zoneId ?? "");

  // Zones that have at least one equipment to offer.
  const zonesWithOptions = useMemo(
    () => zones.filter((z) => equipmentCandidates(equipments, z.id).length > 0),
    [zones, equipments],
  );

  const pickerOptions = useMemo(
    () => equipmentCandidates(equipments, pickerZoneId),
    [pickerZoneId, equipments],
  );

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={pickerZoneId}
        onChange={(e) => {
          const zid = e.target.value;
          setPickerZoneId(zid);
          const candidates = equipmentCandidates(equipments, zid);
          // A zone holding a single candidate has already made the choice —
          // opening a one-entry dropdown would only confirm it.
          if (candidates.length === 1) onChange(candidates[0].id);
          // Otherwise clear the equipment if it no longer belongs to the zone.
          else if (selectedEq && selectedEq.zoneId !== zid) onChange("");
        }}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
      >
        <option value="">Zone…</option>
        {zonesWithOptions.map((z) => (
          <option key={z.id} value={z.id}>
            {z.label}
          </option>
        ))}
      </select>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!pickerZoneId}
        className="flex-1 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text disabled:opacity-40"
      >
        <option value="">{t("common.select")}</option>
        {pickerOptions.map((eq) => (
          <option key={eq.id} value={eq.id}>
            {eq.name}
          </option>
        ))}
      </select>
    </div>
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
  zones: ZoneOption[];
  recipe: RecipeInfo;
  lang: string;
  labelClassName?: string;
}) {
  const { t } = useTranslation();
  const [pickerZoneId, setPickerZoneId] = useState("");

  const selectedIds = useMemo(() => value.split(",").filter(Boolean), [value]);
  const constraint = slot.constraints?.equipmentType;

  // Zones that still have something to offer: matching and not already picked.
  const zonesWithOptions = useMemo(
    () =>
      zones.filter(
        (z) => equipmentCandidates(equipments, z.id, { constraint, excludeIds: selectedIds }).length > 0,
      ),
    [zones, equipments, selectedIds, constraint],
  );

  const pickerOptions = useMemo(
    () => equipmentCandidates(equipments, pickerZoneId, { constraint, excludeIds: selectedIds }),
    [pickerZoneId, equipments, selectedIds, constraint],
  );

  const handleRemove = (eqId: string) => {
    const next = selectedIds.filter((id) => id !== eqId);
    onChange(next.join(","));
  };

  return (
    <div className="mb-1.5">
      <label className={labelClassName ?? "block text-[10px] tracking-wider mb-0.5 text-text-tertiary"}>
        {recipeSlotName(recipe, slot, lang)}
      </label>

      {/* Selected items — zone then equipment, the reading order of the two
          dropdowns underneath, so a chip lines up with the row that made it. */}
      {selectedIds.map((id) => {
        const eq = equipments.find((e) => e.id === id);
        const zone = eq ? zones.find((z) => z.id === eq.zoneId) : null;
        return (
          <div key={id} className="flex items-center gap-2 px-2 py-1 mb-1 text-[13px] bg-surface border border-border rounded-[6px]">
            {zone && <span className="min-w-0 text-[11px] text-text-tertiary truncate">{zone.label}</span>}
            <span className="flex-1 min-w-0 text-text truncate">{eq?.name ?? id}</span>
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
            onChange={(e) => {
              const zid = e.target.value;
              const candidates = equipmentCandidates(equipments, zid, { constraint, excludeIds: selectedIds });
              // One candidate left in that zone: add it and drop back to the
              // zone dropdown, exactly where picking it by hand would land.
              if (candidates.length === 1) {
                onChange([...selectedIds, candidates[0].id].join(","));
                setPickerZoneId("");
              } else {
                setPickerZoneId(zid);
              }
            }}
            className="flex-1 px-2 py-1 text-[13px] bg-surface border border-border rounded-[6px] text-text"
          >
            <option value="">Zone…</option>
            {zonesWithOptions.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
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


/**
 * Checkbox list of an equipment-list slot (spec 139). Real markup here, so the
 * zone rides as secondary text instead of being glued into the name — and only
 * for the names that repeat in this list.
 */
function EquipmentCheckboxList({
  equipments,
  zoneChains,
  value,
  onChange,
}: {
  equipments: EquipmentWithDetails[];
  zoneChains: Map<string, string[]>;
  value: string;
  onChange: (value: string) => void;
}) {
  const labels = equipmentLabelMap(equipments, zoneChains);
  const selected = value.split(",").filter(Boolean);

  return (
    <div className="space-y-1">
      {equipments.map((eq) => {
        const checked = selected.includes(eq.id);
        const label = labels.get(eq.id) ?? eq.name;
        const zone = label === eq.name ? null : label.slice(eq.name.length + 3);
        return (
          <label
            key={eq.id}
            className="flex items-center gap-2 px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text cursor-pointer hover:bg-border-light/30 transition-colors duration-150"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(
                  (checked ? selected.filter((id) => id !== eq.id) : [...selected, eq.id]).join(","),
                )
              }
              className="accent-primary"
            />
            <span className="truncate">{eq.name}</span>
            {zone && (
              <span className="ml-auto text-[11px] text-text-tertiary truncate">{zone}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

// ============================================================
// Add recipe wizard (step 1: choose recipe, step 2: configure)
// ============================================================

function AddRecipeForm({
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
  const allZones = useMemo(() => flattenZonesWithPath(zoneTree), [zoneTree]);
  const zoneChains = useMemo(() => zoneChainMap(allZones), [allZones]);

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

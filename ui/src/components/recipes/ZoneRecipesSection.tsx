import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChefHat, Plus, Trash2, ScrollText, X, Loader2, ChevronLeft, ChevronRight, Timer, Check } from "lucide-react";
import { useRecipes } from "../../store/useRecipes";
import { useEquipments } from "../../store/useEquipments";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry, EquipmentWithDetails } from "../../types";
import type { EquipmentType } from "../../types";
import { formatTime } from "../../lib/format";
import { recipeName, recipeDescription, recipeSlotName, recipeSlotDescription } from "../../lib/recipe-i18n";

function matchesEquipmentType(eqType: string, constraint: EquipmentType | EquipmentType[]): boolean {
  const types = Array.isArray(constraint) ? constraint : [constraint];
  return types.some((t) => t === eqType);
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
  const getLog = useRecipes((s) => s.getLog);
  const allInstances = useRecipes((s) => s.instances);
  const equipments = useEquipments((s) => s.equipments);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState<RecipeLogEntry[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editParams, setEditParams] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

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

  const handleStartEdit = () => {
    const params: Record<string, string> = {};
    for (const [key, val] of Object.entries(instance.params)) {
      // Store array values as comma-separated for the form
      params[key] = Array.isArray(val) ? val.join(",") : String(val ?? "");
    }
    setEditParams(params);
    setEditError("");
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
      if (slot.list && value) {
        finalParams[slot.id] = value.split(",").filter(Boolean);
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

  const getEquipmentOptions = (slotId: string): EquipmentWithDetails[] => {
    const slot = recipe?.slots.find((s) => s.id === slotId);
    if (!slot) return [];
    return equipments.filter((eq) => {
      if (eq.zoneId !== zoneId) return false;
      if (slot.type === "equipment" && !slot.list && usedLightIds.has(eq.id)) return false;
      if (slot.constraints?.equipmentType) {
        return matchesEquipmentType(eq.type, slot.constraints.equipmentType);
      }
      return true;
    });
  };

  // Build a human-readable summary of params
  const paramsSummary = useMemo(() => {
    if (!recipe) return "";
    const parts: string[] = [];
    for (const slot of recipe.slots) {
      if (slot.id === "zone") continue;
      const val = instance.params[slot.id];
      if (val === undefined || val === null || val === "") continue;
      if (slot.type === "equipment" && Array.isArray(val)) {
        const names = val
          .map((id: string) => equipments.find((e) => e.id === id)?.name ?? id)
          .join(", ");
        parts.push(names);
      } else if (slot.type === "equipment") {
        const eq = equipments.find((e) => e.id === val);
        parts.push(eq?.name ?? String(val));
      } else {
        parts.push(`${recipeSlotName(recipe, slot, lang)}: ${String(val)}`);
      }
    }
    return parts.join(" · ");
  }, [instance.params, recipe, equipments, lang]);

  return (
    <div className={instance.enabled ? "" : "opacity-50"}>
      <div className="flex items-center gap-3 px-4 py-2.5">
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
        <button
          onClick={handleShowLog}
          className="p-1.5 rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
          title={t("recipes.viewLog")}
        >
          <ScrollText size={14} strokeWidth={1.5} />
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

      {/* Edit form */}
      {editing && recipe && (
        <div className="px-4 pb-3">
          <div className="bg-border-light/20 border border-border-light rounded-[6px] p-3">
            {recipe.slots
              .filter((slot) => slot.id !== "zone")
              .map((slot) => (
                <div key={slot.id} className="mb-2.5">
                  <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                    {recipeSlotName(recipe, slot, lang)}
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
                </div>
              ))}
            {editError && (
              <p className="text-[12px] text-error mb-2">{editError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-[12px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
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
  const [step, setStep] = useState<WizardStep>("choose");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

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

  // Filter equipments for current zone matching slot constraints, excluding already-used lights
  const getEquipmentOptions = (slotId: string): EquipmentWithDetails[] => {
    const slot = selectedRecipe?.slots.find((s) => s.id === slotId);
    if (!slot) return [];
    return equipments.filter((eq) => {
      if (eq.zoneId !== zoneId) return false;
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
      if (slot.list && value) {
        finalParams[slot.id] = value.split(",").filter(Boolean);
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

          {selectedRecipe.slots
            .filter((slot) => slot.id !== "zone")
            .map((slot) => (
              <div key={slot.id} className="mb-3">
                <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                  {recipeSlotName(selectedRecipe, slot, lang)}
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
              </div>
            ))}

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

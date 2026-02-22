import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Trash2, Plus } from "lucide-react";
import { getButtonActionBindings, addButtonActionBinding, removeButtonActionBinding } from "../../api";
import { useModes } from "../../store/useModes";
import { useEquipments } from "../../store/useEquipments";
import { useRecipes } from "../../store/useRecipes";
import type { ButtonActionBinding, ButtonEffectType } from "../../types";

const BUTTON_ACTIONS = ["single", "double", "hold"] as const;

interface ButtonActionsSectionProps {
  equipmentId: string;
}

export function ButtonActionsSection({ equipmentId }: ButtonActionsSectionProps) {
  const { t } = useTranslation();
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);
  const equipments = useEquipments((s) => s.equipments);
  const instances = useRecipes((s) => s.instances);

  const [bindings, setBindings] = useState<ButtonActionBinding[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchBindings = useCallback(async () => {
    try {
      const data = await getButtonActionBindings(equipmentId);
      setBindings(data);
    } catch {
      setBindings([]);
    }
  }, [equipmentId]);

  useEffect(() => {
    fetchBindings();
    fetchModes();
  }, [fetchBindings, fetchModes]);

  const handleRemove = async (bindingId: string) => {
    await removeButtonActionBinding(equipmentId, bindingId);
    await fetchBindings();
  };

  const handleAdd = async (data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> }) => {
    await addButtonActionBinding(equipmentId, data);
    setShowAddForm(false);
    await fetchBindings();
  };

  // Group bindings by action value
  const grouped = new Map<string, ButtonActionBinding[]>();
  for (const b of bindings) {
    const list = grouped.get(b.actionValue) ?? [];
    list.push(b);
    grouped.set(b.actionValue, list);
  }

  const getEffectLabel = (binding: ButtonActionBinding): string => {
    switch (binding.effectType) {
      case "mode_activate": {
        const mode = modes.find((m) => m.id === binding.config.modeId);
        return `${t("buttonActions.effectType.mode_activate")} → ${mode?.name ?? String(binding.config.modeId)}`;
      }
      case "mode_toggle": {
        const modeA = modes.find((m) => m.id === binding.config.modeAId);
        const modeB = modes.find((m) => m.id === binding.config.modeBId);
        return `${t("buttonActions.effectType.mode_toggle")} → ${modeA?.name ?? "?"} / ${modeB?.name ?? "?"}`;
      }
      case "equipment_order": {
        const eq = equipments.find((e) => e.id === binding.config.equipmentId);
        return `${t("buttonActions.effectType.equipment_order")} → ${eq?.name ?? String(binding.config.equipmentId)} · ${String(binding.config.orderAlias)} = ${JSON.stringify(binding.config.value)}`;
      }
      case "recipe_toggle": {
        const inst = instances.find((i) => i.id === binding.config.instanceId);
        const label = binding.config.enabled ? t("common.on") : t("common.off");
        return `${t("buttonActions.effectType.recipe_toggle")} → ${inst?.recipeId ?? String(binding.config.instanceId)} ${label}`;
      }
      default:
        return binding.effectType;
    }
  };

  const getActionLabel = (actionValue: string): string => {
    const key = `buttonActions.action.${actionValue}`;
    const translated = t(key);
    return translated !== key ? translated : actionValue;
  };

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-text flex items-center gap-2">
          <Zap size={16} strokeWidth={1.5} className="text-accent" />
          {t("buttonActions.title")}
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary border border-primary/30 rounded-[4px] hover:bg-primary-light transition-colors duration-150"
        >
          <Plus size={11} strokeWidth={1.5} />
          {t("buttonActions.addEffect")}
        </button>
      </div>

      {bindings.length === 0 && !showAddForm && (
        <p className="text-[13px] text-text-tertiary">{t("buttonActions.noEffects")}</p>
      )}

      {BUTTON_ACTIONS.map((actionValue) => {
        const actionBindings = grouped.get(actionValue);
        if (!actionBindings) return null;
        return (
          <div key={actionValue} className="mb-3">
            <div className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
              {getActionLabel(actionValue)}
            </div>
            <div className="space-y-1.5">
              {actionBindings.map((binding) => (
                <div
                  key={binding.id}
                  className="flex items-center gap-2 px-3 py-2 bg-background rounded-[6px] border border-border-light"
                >
                  <Zap size={12} strokeWidth={1.5} className="text-accent flex-shrink-0" />
                  <span className="text-[12px] text-text flex-1 truncate">
                    {getEffectLabel(binding)}
                  </span>
                  <button
                    onClick={() => handleRemove(binding.id)}
                    className="p-1 text-text-tertiary hover:text-error transition-colors"
                  >
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Show bindings with non-standard action values */}
      {[...grouped.entries()]
        .filter(([key]) => !BUTTON_ACTIONS.includes(key as typeof BUTTON_ACTIONS[number]))
        .map(([actionValue, actionBindings]) => (
          <div key={actionValue} className="mb-3">
            <div className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5">
              {actionValue}
            </div>
            <div className="space-y-1.5">
              {actionBindings.map((binding) => (
                <div
                  key={binding.id}
                  className="flex items-center gap-2 px-3 py-2 bg-background rounded-[6px] border border-border-light"
                >
                  <Zap size={12} strokeWidth={1.5} className="text-accent flex-shrink-0" />
                  <span className="text-[12px] text-text flex-1 truncate">
                    {getEffectLabel(binding)}
                  </span>
                  <button
                    onClick={() => handleRemove(binding.id)}
                    className="p-1 text-text-tertiary hover:text-error transition-colors"
                  >
                    <Trash2 size={12} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

      {showAddForm && (
        <AddEffectForm
          modes={modes}
          equipments={equipments}
          instances={instances}
          onSubmit={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
}

function AddEffectForm({
  modes,
  equipments,
  instances,
  onSubmit,
  onCancel,
}: {
  modes: { id: string; name: string; active: boolean }[];
  equipments: { id: string; name: string; type: string; orderBindings: { alias: string }[] }[];
  instances: { id: string; recipeId: string }[];
  onSubmit: (data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [actionValue, setActionValue] = useState("single");
  const [effectType, setEffectType] = useState<ButtonEffectType>("mode_activate");
  const [saving, setSaving] = useState(false);

  // mode_activate
  const [modeId, setModeId] = useState("");
  // mode_toggle
  const [modeAId, setModeAId] = useState("");
  const [modeBId, setModeBId] = useState("");
  // equipment_order
  const [targetEquipmentId, setTargetEquipmentId] = useState("");
  const [orderAlias, setOrderAlias] = useState("");
  const [orderValue, setOrderValue] = useState("");
  // recipe_toggle
  const [instanceId, setInstanceId] = useState("");
  const [enabled, setEnabled] = useState(true);

  const canSubmit = () => {
    switch (effectType) {
      case "mode_activate": return !!modeId;
      case "mode_toggle": return !!modeAId && !!modeBId;
      case "equipment_order": return !!targetEquipmentId && !!orderAlias;
      case "recipe_toggle": return !!instanceId;
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;
    setSaving(true);
    try {
      let config: Record<string, unknown> = {};
      switch (effectType) {
        case "mode_activate":
          config = { modeId };
          break;
        case "mode_toggle":
          config = { modeAId, modeBId };
          break;
        case "equipment_order": {
          let parsedValue: unknown;
          try { parsedValue = JSON.parse(orderValue); } catch { parsedValue = orderValue; }
          config = { equipmentId: targetEquipmentId, orderAlias, value: parsedValue };
          break;
        }
        case "recipe_toggle":
          config = { instanceId, enabled };
          break;
      }
      await onSubmit({ actionValue, effectType, config });
    } finally {
      setSaving(false);
    }
  };

  const selectedEquipment = equipments.find((e) => e.id === targetEquipmentId);

  const seg = (active: boolean, pos: "first" | "mid" | "last") => {
    const r = pos === "first" ? "rounded-l-[4px]" : pos === "last" ? "rounded-r-[4px]" : "";
    return `inline-flex items-center justify-center px-3 py-1.5 text-[12px] font-medium transition-all cursor-pointer border border-border-light ${r} ${
      pos !== "first" ? "border-l-0" : ""
    } ${
      active
        ? "bg-primary/10 text-primary border-primary/30 z-10 relative"
        : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
    }`;
  };

  return (
    <div className="bg-border-light/20 border border-border-light rounded-[6px] p-3 space-y-3 mt-3">
      {/* Action value (single / double / hold) */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
          {t("buttonActions.actionType")}
        </label>
        <div className="inline-flex">
          {BUTTON_ACTIONS.map((action, i) => (
            <button
              key={action}
              onClick={() => setActionValue(action)}
              className={seg(actionValue === action, i === 0 ? "first" : i === BUTTON_ACTIONS.length - 1 ? "last" : "mid")}
            >
              {t(`buttonActions.action.${action}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Effect type selector */}
      <div>
        <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
          {t("buttonActions.effectTypeLabel")}
        </label>
        <select
          value={effectType}
          onChange={(e) => setEffectType(e.target.value as ButtonEffectType)}
          className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
        >
          <option value="mode_activate">{t("buttonActions.effectType.mode_activate")}</option>
          <option value="mode_toggle">{t("buttonActions.effectType.mode_toggle")}</option>
          <option value="equipment_order">{t("buttonActions.effectType.equipment_order")}</option>
          <option value="recipe_toggle">{t("buttonActions.effectType.recipe_toggle")}</option>
        </select>
      </div>

      {/* Config per effect type */}
      {effectType === "mode_activate" && (
        <div>
          <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
            {t("modes.title")}
          </label>
          <select
            value={modeId}
            onChange={(e) => setModeId(e.target.value)}
            className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
          >
            <option value="">{t("common.select")}</option>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      )}

      {effectType === "mode_toggle" && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              Mode A
            </label>
            <select
              value={modeAId}
              onChange={(e) => setModeAId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              Mode B
            </label>
            <select
              value={modeBId}
              onChange={(e) => setModeBId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {modes.filter((m) => m.id !== modeAId).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {effectType === "equipment_order" && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("equipments.title")}
            </label>
            <select
              value={targetEquipmentId}
              onChange={(e) => { setTargetEquipmentId(e.target.value); setOrderAlias(""); setOrderValue(""); }}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {equipments.filter((eq) => eq.orderBindings.length > 0).map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name}</option>
              ))}
            </select>
          </div>
          {selectedEquipment && (
            <>
              <div>
                <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                  {t("modes.form.orderAlias")}
                </label>
                <select
                  value={orderAlias}
                  onChange={(e) => setOrderAlias(e.target.value)}
                  className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                >
                  <option value="">{t("common.select")}</option>
                  {selectedEquipment.orderBindings.map((o) => (
                    <option key={o.alias} value={o.alias}>{o.alias}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                  {t("modes.form.actionValuePlaceholder")}
                </label>
                <input
                  type="text"
                  value={orderValue}
                  onChange={(e) => setOrderValue(e.target.value)}
                  placeholder={t("modes.form.actionValuePlaceholder")}
                  className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text placeholder:text-text-tertiary"
                />
              </div>
            </>
          )}
        </div>
      )}

      {effectType === "recipe_toggle" && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("recipes.title")}
            </label>
            <select
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.recipeId}</option>
              ))}
            </select>
          </div>
          {instanceId && (
            <div className="inline-flex">
              <button
                onClick={() => setEnabled(true)}
                className={seg(enabled, "first")}
              >
                {t("common.on")}
              </button>
              <button
                onClick={() => setEnabled(false)}
                className={seg(!enabled, "last")}
              >
                {t("common.off")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit() || saving}
          className="px-3 py-1.5 bg-primary text-white text-[12px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 disabled:opacity-50"
        >
          {saving ? t("common.saving") : t("common.add")}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-border-light text-text-secondary text-[12px] font-medium rounded-[6px] hover:bg-border transition-colors duration-150"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

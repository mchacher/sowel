import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Trash2, Plus, Pencil } from "lucide-react";
import { getButtonActionBindings, addButtonActionBinding, updateButtonActionBinding, removeButtonActionBinding } from "../../api";
import { useModes } from "../../store/useModes";
import { useEquipments } from "../../store/useEquipments";
import { useRecipes } from "../../store/useRecipes";
import { useZones } from "../../store/useZones";
import type { ButtonActionBinding, ButtonEffectType, ZoneWithChildren } from "../../types";

const BUTTON_ACTIONS = ["single", "double", "hold"] as const;

const ZONE_ORDER_OPTIONS: { key: string; group: string; parametric: boolean }[] = [
  { key: "allLightsOn", group: "lights", parametric: false },
  { key: "allLightsOff", group: "lights", parametric: false },
  { key: "allLightsBrightness", group: "lights", parametric: true },
  { key: "allShuttersOpen", group: "shutters", parametric: false },
  { key: "allShuttersStop", group: "shutters", parametric: false },
  { key: "allShuttersClose", group: "shutters", parametric: false },
  { key: "allThermostatsPowerOn", group: "heating", parametric: false },
  { key: "allThermostatsPowerOff", group: "heating", parametric: false },
  { key: "allThermostatsSetpoint", group: "heating", parametric: true },
];

function flattenZones(tree: ZoneWithChildren[]): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = [];
  const walk = (nodes: ZoneWithChildren[]) => {
    for (const z of nodes) {
      result.push({ id: z.id, name: z.name });
      walk(z.children);
    }
  };
  walk(tree);
  return result;
}

interface ButtonActionsSectionProps {
  equipmentId: string;
}

export function ButtonActionsSection({ equipmentId }: ButtonActionsSectionProps) {
  const { t } = useTranslation();
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);
  const equipments = useEquipments((s) => s.equipments);
  const zoneTree = useZones((s) => s.tree);
  // Flatten zone tree for name lookup
  const zones = flattenZones(zoneTree);
  const instances = useRecipes((s) => s.instances);

  const [bindings, setBindings] = useState<ButtonActionBinding[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    getButtonActionBindings(equipmentId)
      .then((data) => { if (mountedRef.current) setBindings(data); })
      .catch(() => { if (mountedRef.current) setBindings([]); });
    fetchModes();
    return () => { mountedRef.current = false; };
  }, [equipmentId, fetchModes]);

  const refreshBindings = async () => {
    try {
      const data = await getButtonActionBindings(equipmentId);
      setBindings(data);
    } catch {
      /* ignore */
    }
  };

  const handleRemove = async (bindingId: string) => {
    await removeButtonActionBinding(equipmentId, bindingId);
    await refreshBindings();
  };

  const handleAdd = async (data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> }) => {
    await addButtonActionBinding(equipmentId, data);
    setShowAddForm(false);
    await refreshBindings();
  };

  const handleEdit = async (bindingId: string, data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> }) => {
    await updateButtonActionBinding(equipmentId, bindingId, data);
    setEditingId(null);
    await refreshBindings();
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
        const zoneName = eq ? zones.find((z) => z.id === eq.zoneId)?.name : undefined;
        const eqName = eq ? (zoneName ? `${zoneName} — ${eq.name}` : eq.name) : String(binding.config.equipmentId);
        const val = binding.config.value;
        const valueStr = val != null && val !== "" ? ` = ${val}` : "";
        return `${t("buttonActions.effectType.equipment_order")} → ${eqName} · ${String(binding.config.orderAlias)}${valueStr}`;
      }
      case "recipe_toggle": {
        const inst = instances.find((i) => i.id === binding.config.instanceId);
        const label = binding.config.enabled ? t("common.on") : t("common.off");
        return `${t("buttonActions.effectType.recipe_toggle")} → ${inst?.recipeId ?? String(binding.config.instanceId)} ${label}`;
      }
      case "zone_order": {
        const zone = zones.find((z) => z.id === binding.config.zoneId);
        const orderKey = String(binding.config.orderKey);
        const val = binding.config.value;
        const valueStr = val != null && val !== "" ? ` = ${val}` : "";
        return `${t("buttonActions.effectType.zone_order")} → ${zone?.name ?? "?"} · ${t(`buttonActions.zoneOrder.${orderKey}`)}${valueStr}`;
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
              {actionBindings.map((binding) =>
                editingId === binding.id ? (
                  <AddEffectForm
                    key={binding.id}
                    modes={modes}
                    equipments={equipments}
                    zones={zones}
                    instances={instances}
                    initial={binding}
                    onSubmit={async (data) => handleEdit(binding.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={binding.id}
                    className="flex items-center gap-2 px-3 py-2 bg-background rounded-[6px] border border-border-light"
                  >
                    <Zap size={12} strokeWidth={1.5} className="text-accent flex-shrink-0" />
                    <span className="text-[12px] text-text flex-1 truncate">
                      {getEffectLabel(binding)}
                    </span>
                    <button
                      onClick={() => setEditingId(binding.id)}
                      className="p-1 text-text-tertiary hover:text-primary transition-colors"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleRemove(binding.id)}
                      className="p-1 text-text-tertiary hover:text-error transition-colors"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                ),
              )}
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
              {actionBindings.map((binding) =>
                editingId === binding.id ? (
                  <AddEffectForm
                    key={binding.id}
                    modes={modes}
                    equipments={equipments}
                    zones={zones}
                    instances={instances}
                    initial={binding}
                    onSubmit={async (data) => handleEdit(binding.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={binding.id}
                    className="flex items-center gap-2 px-3 py-2 bg-background rounded-[6px] border border-border-light"
                  >
                    <Zap size={12} strokeWidth={1.5} className="text-accent flex-shrink-0" />
                    <span className="text-[12px] text-text flex-1 truncate">
                      {getEffectLabel(binding)}
                    </span>
                    <button
                      onClick={() => setEditingId(binding.id)}
                      className="p-1 text-text-tertiary hover:text-primary transition-colors"
                    >
                      <Pencil size={12} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => handleRemove(binding.id)}
                      className="p-1 text-text-tertiary hover:text-error transition-colors"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}

      {showAddForm && (
        <AddEffectForm
          modes={modes}
          equipments={equipments}
          zones={zones}
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
  zones,
  instances,
  initial,
  onSubmit,
  onCancel,
}: {
  modes: { id: string; name: string; active: boolean }[];
  equipments: { id: string; name: string; type: string; zoneId: string; orderBindings: { alias: string; type?: string; enumValues?: string[]; min?: number; max?: number }[] }[];
  zones: { id: string; name: string }[];
  instances: { id: string; recipeId: string }[];
  initial?: ButtonActionBinding;
  onSubmit: (data: { actionValue: string; effectType: ButtonEffectType; config: Record<string, unknown> }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [actionValue, setActionValue] = useState(initial?.actionValue ?? "single");
  const [effectType, setEffectType] = useState<ButtonEffectType>(initial?.effectType ?? "mode_activate");
  const [saving, setSaving] = useState(false);

  // mode_activate
  const [modeId, setModeId] = useState(
    initial?.effectType === "mode_activate" ? String(initial.config.modeId ?? "") : "",
  );
  // mode_toggle
  const [modeAId, setModeAId] = useState(
    initial?.effectType === "mode_toggle" ? String(initial.config.modeAId ?? "") : "",
  );
  const [modeBId, setModeBId] = useState(
    initial?.effectType === "mode_toggle" ? String(initial.config.modeBId ?? "") : "",
  );
  // equipment_order
  const initialEqZoneId = (() => {
    if (initial?.effectType === "equipment_order") {
      const eq = equipments.find((e) => e.id === initial.config.equipmentId);
      return eq?.zoneId ?? "";
    }
    return "";
  })();
  const [eqZoneId, setEqZoneId] = useState(initialEqZoneId);
  const [targetEquipmentId, setTargetEquipmentId] = useState(
    initial?.effectType === "equipment_order" ? String(initial.config.equipmentId ?? "") : "",
  );
  const [orderAlias, setOrderAlias] = useState(
    initial?.effectType === "equipment_order" ? String(initial.config.orderAlias ?? "") : "",
  );
  const [orderValue, setOrderValue] = useState(
    initial?.effectType === "equipment_order" ? JSON.stringify(initial.config.value ?? "") : "",
  );
  // zone_order
  const [zoZoneId, setZoZoneId] = useState(
    initial?.effectType === "zone_order" ? String(initial.config.zoneId ?? "") : "",
  );
  const [zoOrderKey, setZoOrderKey] = useState(
    initial?.effectType === "zone_order" ? String(initial.config.orderKey ?? "") : "",
  );
  const [zoValue, setZoValue] = useState(
    initial?.effectType === "zone_order" && initial.config.value != null ? String(initial.config.value) : "",
  );
  // recipe_toggle
  const [instanceId, setInstanceId] = useState(
    initial?.effectType === "recipe_toggle" ? String(initial.config.instanceId ?? "") : "",
  );
  const [enabled, setEnabled] = useState(
    initial?.effectType === "recipe_toggle" ? (initial.config.enabled as boolean) !== false : true,
  );

  const canSubmit = () => {
    switch (effectType) {
      case "mode_activate": return !!modeId;
      case "mode_toggle": return !!modeAId && !!modeBId;
      case "equipment_order": return !!targetEquipmentId && !!orderAlias;
      case "recipe_toggle": return !!instanceId;
      case "zone_order": {
        if (!zoZoneId || !zoOrderKey) return false;
        const opt = ZONE_ORDER_OPTIONS.find((o) => o.key === zoOrderKey);
        if (opt?.parametric && zoValue === "") return false;
        return true;
      }
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
          // Only send value when user explicitly chose one (multi-enum or numeric)
          // null → backend auto-resolves from single enum or order default
          let parsedValue: unknown = null;
          if (orderValue !== "") {
            try { parsedValue = JSON.parse(orderValue); } catch { parsedValue = orderValue; }
          }
          config = { equipmentId: targetEquipmentId, orderAlias, value: parsedValue || null };
          break;
        }
        case "recipe_toggle":
          config = { instanceId, enabled };
          break;
        case "zone_order": {
          const opt = ZONE_ORDER_OPTIONS.find((o) => o.key === zoOrderKey);
          config = { zoneId: zoZoneId, orderKey: zoOrderKey };
          if (opt?.parametric && zoValue !== "") {
            config.value = Number(zoValue);
          }
          break;
        }
      }
      await onSubmit({ actionValue, effectType, config });
    } finally {
      setSaving(false);
    }
  };

  const selectedEquipment = equipments.find((e) => e.id === targetEquipmentId);
  const selectedOrder = selectedEquipment?.orderBindings.find((o) => o.alias === orderAlias);
  const enumVals = selectedOrder?.enumValues ?? [];

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
          <option value="zone_order">{t("buttonActions.effectType.zone_order")}</option>
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
              {t("zones.title")}
            </label>
            <select
              value={eqZoneId}
              onChange={(e) => {
                setEqZoneId(e.target.value);
                setTargetEquipmentId("");
                setOrderAlias("");
                setOrderValue("");
              }}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          {eqZoneId && (
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("equipments.title")}
            </label>
            <select
              value={targetEquipmentId}
              onChange={(e) => {
                const eqId = e.target.value;
                setTargetEquipmentId(eqId);
                const eq = equipments.find((x) => x.id === eqId);
                const orders = eq?.orderBindings ?? [];
                if (orders.length === 1) {
                  setOrderAlias(orders[0].alias);
                  setOrderValue("");
                } else {
                  setOrderAlias("");
                  setOrderValue("");
                }
              }}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {equipments.filter((eq) => eq.zoneId === eqZoneId && eq.orderBindings.length > 0).map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name}</option>
              ))}
            </select>
          </div>
          )}
          {selectedEquipment && (
            <>
              {/* Command: hidden if single order (auto-selected), select if 2+ */}
              {selectedEquipment.orderBindings.length > 1 && (
                <div>
                  <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                    {t("modes.form.orderAlias")}
                  </label>
                  <select
                    value={orderAlias}
                    onChange={(e) => {
                      const alias = e.target.value;
                      setOrderAlias(alias);
                      // Pre-select value if single enum
                      setOrderValue("");
                    }}
                    className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                  >
                    <option value="">{t("common.select")}</option>
                    {selectedEquipment.orderBindings.map((o) => (
                      <option key={o.alias} value={o.alias}>{o.alias}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Value: select for 2+ enums, number input for numeric, hidden for single enum (auto-resolved) */}
              {enumVals.length > 1 ? (
                <div>
                  <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                    {t("modes.form.actionValuePlaceholder")}
                  </label>
                  <select
                    value={orderValue}
                    onChange={(e) => setOrderValue(e.target.value)}
                    className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                  >
                    <option value="">{t("common.select")}</option>
                    {enumVals.map((v) => (
                      <option key={v} value={JSON.stringify(v)}>{v}</option>
                    ))}
                  </select>
                </div>
              ) : selectedOrder?.type === "number" ? (
                <div>
                  <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                    {t("modes.form.actionValuePlaceholder")}
                    {selectedOrder.min != null && selectedOrder.max != null && (
                      <span className="ml-1 font-normal">({selectedOrder.min}–{selectedOrder.max})</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={orderValue}
                    onChange={(e) => setOrderValue(e.target.value)}
                    min={selectedOrder.min}
                    max={selectedOrder.max}
                    className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
                  />
                </div>
              ) : null}
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

      {effectType === "zone_order" && (
        <div className="space-y-2">
          <div>
            <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
              {t("zones.title")}
            </label>
            <select
              value={zoZoneId}
              onChange={(e) => setZoZoneId(e.target.value)}
              className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
            >
              <option value="">{t("common.select")}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          {zoZoneId && (
            <div>
              <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                {t("buttonActions.zoneOrderLabel")}
              </label>
              <select
                value={zoOrderKey}
                onChange={(e) => {
                  setZoOrderKey(e.target.value);
                  setZoValue("");
                }}
                className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
              >
                <option value="">{t("common.select")}</option>
                {ZONE_ORDER_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {t(`buttonActions.zoneOrder.${opt.key}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {zoOrderKey && ZONE_ORDER_OPTIONS.find((o) => o.key === zoOrderKey)?.parametric && (
            <div>
              <label className="block text-[11px] text-text-tertiary uppercase tracking-wider mb-1">
                {t("modes.form.actionValuePlaceholder")}
              </label>
              <input
                type="number"
                value={zoValue}
                onChange={(e) => setZoValue(e.target.value)}
                className="w-full px-3 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] text-text"
              />
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
          {saving ? t("common.saving") : initial ? t("common.save") : t("common.add")}
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

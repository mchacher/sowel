import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToggleLeft, ToggleRight, Settings, Trash2, X, Pencil, Check, ChevronUp, ChevronDown, Play } from "lucide-react";
import { useModes } from "../../store/useModes";
import { useEquipments } from "../../store/useEquipments";
import { useRecipes } from "../../store/useRecipes";
import { setModeImpact, removeModeImpact, applyModeToZone } from "../../api";
import type { ModeWithDetails, ZoneModeImpactAction, EquipmentWithDetails, OrderBindingWithDetails } from "../../types";
import { recipeName } from "../../lib/recipe-i18n";

interface ZoneModesSectionProps {
  zoneId: string;
}

export function ZoneModesSection({ zoneId }: ZoneModesSectionProps) {
  const { t } = useTranslation();
  const modes = useModes((s) => s.modes);
  const fetchModes = useModes((s) => s.fetchModes);

  useEffect(() => {
    fetchModes();
  }, [fetchModes]);

  // Modes with impacts on this zone first, then others
  const sortedModes = useMemo(() => {
    const withImpact = modes.filter((m) => m.impacts.some((imp) => imp.zoneId === zoneId));
    const without = modes.filter((m) => !m.impacts.some((imp) => imp.zoneId === zoneId));
    return [...withImpact, ...without];
  }, [modes, zoneId]);

  const activeCount = sortedModes.filter((m) => m.active).length;

  if (modes.length === 0) return null;

  return (
    <div className="rounded-[10px] border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1 bg-success/8">
        <span className="text-success">
          <ToggleRight size={14} strokeWidth={1.5} />
        </span>
        <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
          {t("modes.title")}
        </span>
        <span className="text-[11px] text-text-tertiary ml-auto tabular-nums">
          {activeCount > 0
            ? t("modes.activeCount", { count: activeCount })
            : sortedModes.length}
        </span>
      </div>

      <div className="divide-y divide-border-light">
        {sortedModes.map((mode) => (
          <ModeRow
            key={mode.id}
            mode={mode}
            zoneId={zoneId}
            onRefresh={fetchModes}
          />
        ))}
      </div>
    </div>
  );
}

function ModeRow({
  mode,
  zoneId,
  onRefresh,
}: {
  mode: ModeWithDetails;
  zoneId: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);

  const impact = mode.impacts.find((imp) => imp.zoneId === zoneId);
  const actionCount = impact?.actions.length ?? 0;
  const hasImpacts = actionCount > 0;

  const handleApply = async () => {
    if (applying || !hasImpacts) return;
    setApplying(true);
    try {
      await applyModeToZone(mode.id, zoneId);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div
          className={`w-7 h-7 rounded-[6px] flex items-center justify-center flex-shrink-0 ${
            mode.active ? "bg-primary/15" : "bg-border-light"
          }`}
        >
          {mode.active ? (
            <ToggleRight size={14} strokeWidth={1.5} className="text-primary" />
          ) : (
            <ToggleLeft size={14} strokeWidth={1.5} className="text-text-tertiary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text truncate">
            {mode.name}
          </div>
          <div className="text-[11px] text-text-tertiary truncate">
            {actionCount > 0 ? (
              t("modes.actionCount", { count: actionCount })
            ) : (
              t("modes.noImpacts")
            )}
            {mode.active && (
              <span className="ml-1.5 text-primary">· {t("modes.globallyActive")}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="p-1.5 rounded-[4px] text-text-tertiary hover:text-text hover:bg-border-light/60 transition-colors duration-150"
          title={t("modes.configure")}
        >
          {editing ? <X size={14} strokeWidth={1.5} /> : <Settings size={14} strokeWidth={1.5} />}
        </button>
        {hasImpacts && (
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-[6px] transition-colors duration-150 bg-border-light text-text-secondary hover:bg-border hover:text-text disabled:opacity-50"
            title={t("modes.applyLocalHint")}
          >
            <Play size={10} strokeWidth={2} />
            {t("modes.apply")}
          </button>
        )}
      </div>

      {/* Inline config panel */}
      {editing && (
        <ImpactEditor
          mode={mode}
          zoneId={zoneId}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

function ImpactEditor({
  mode,
  zoneId,
  onRefresh,
}: {
  mode: ModeWithDetails;
  zoneId: string;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("fr") ? "fr" : "en";
  const equipments = useEquipments((s) => s.equipments);
  const instances = useRecipes((s) => s.instances);
  const recipes = useRecipes((s) => s.recipes);
  const [showAddAction, setShowAddAction] = useState(false);
  const [pendingActions, setPendingActions] = useState<ZoneModeImpactAction[]>([]);
  const [saving, setSaving] = useState(false);

  const impact = mode.impacts.find((imp) => imp.zoneId === zoneId);
  const savedActions = impact?.actions ?? [];

  const zoneEquipments = useMemo(
    () => equipments.filter((eq) => eq.zoneId === zoneId),
    [equipments, zoneId]
  );

  const zoneInstances = useMemo(
    () => instances.filter((inst) => inst.params.zone === zoneId),
    [instances, zoneId]
  );

  const resolveRecipeName = (recipeId: string): string => {
    const recipe = recipes.find((r) => r.id === recipeId);
    return recipe ? recipeName(recipe, lang) : recipeId;
  };

  const handleRemoveAction = async (actionIndex: number) => {
    const newActions = savedActions.filter((_, i) => i !== actionIndex);
    if (newActions.length === 0) {
      await removeModeImpact(mode.id, zoneId);
    } else {
      await setModeImpact(mode.id, zoneId, newActions);
    }
    onRefresh();
  };

  const handleUpdateAction = async (actionIndex: number, updated: ZoneModeImpactAction) => {
    const newActions = savedActions.map((a, i) => (i === actionIndex ? updated : a));
    await setModeImpact(mode.id, zoneId, newActions);
    onRefresh();
  };

  const handleStageAction = (action: ZoneModeImpactAction) => {
    setPendingActions((prev) => [...prev, action]);
    setShowAddAction(false);
  };

  const handleRemovePending = (index: number) => {
    setPendingActions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSavePending = async () => {
    if (pendingActions.length === 0) return;
    setSaving(true);
    try {
      const allActions = [...savedActions, ...pendingActions];
      await setModeImpact(mode.id, zoneId, allActions);
      setPendingActions([]);
      setShowAddAction(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const hasPending = pendingActions.length > 0;

  return (
    <div className="px-4 pb-3">
      <div className="bg-border-light/20 border border-border-light rounded-[6px] p-3 space-y-4">
        {/* Actions section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              {t("modes.impacts")}
            </span>
            {!showAddAction && (
              <button
                onClick={() => setShowAddAction(true)}
                className="text-[11px] text-primary hover:text-primary-hover transition-colors"
              >
                {t("modes.addImpact")}
              </button>
            )}
          </div>

          {/* Saved actions */}
          {savedActions.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {savedActions.map((action, idx) => (
                <ActionRow
                  key={idx}
                  action={action}
                  equipments={zoneEquipments}
                  instances={zoneInstances}
                  resolveRecipeName={resolveRecipeName}
                  onRemove={() => handleRemoveAction(idx)}
                  onUpdate={(updated) => handleUpdateAction(idx, updated)}
                />
              ))}
            </div>
          )}

          {/* Pending (not yet saved) actions */}
          {hasPending && (
            <div className="space-y-1.5 mb-2">
              {pendingActions.map((action, idx) => (
                <ActionRow
                  key={`pending-${idx}`}
                  action={action}
                  equipments={zoneEquipments}
                  instances={zoneInstances}
                  resolveRecipeName={resolveRecipeName}
                  onRemove={() => handleRemovePending(idx)}
                  pending
                />
              ))}
            </div>
          )}

          {savedActions.length === 0 && !hasPending && !showAddAction && (
            <p className="text-[11px] text-text-tertiary mb-2">{t("modes.noImpacts")}</p>
          )}

          {showAddAction && (
            <AddActionForm
              equipments={zoneEquipments}
              instances={zoneInstances}
              resolveRecipeName={resolveRecipeName}
              onAdd={handleStageAction}
              onDone={() => setShowAddAction(false)}
            />
          )}

          {/* Save / cancel pending actions */}
          {hasPending && (
            <div className="flex gap-1.5 mt-2">
              <button
                onClick={handleSavePending}
                disabled={saving}
                className="px-2.5 py-1 bg-primary text-white text-[11px] font-medium rounded-[4px] hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
              <button
                onClick={() => setPendingActions([])}
                className="px-2.5 py-1 bg-border-light text-text-secondary text-[11px] rounded-[4px] hover:bg-border transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatOrderLabel(
  action: ZoneModeImpactAction & { type: "order" },
  eq: EquipmentWithDetails | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): React.ReactNode {
  const name = eq?.name ?? action.equipmentId;

  if (eq?.type === "shutter") {
    if (action.orderAlias === "state" && action.value === "OPEN")
      return <>{name} <ChevronUp size={10} strokeWidth={1.5} className="inline -mt-0.5" /> {t("controls.open")}</>;
    if (action.orderAlias === "state" && action.value === "CLOSE")
      return <>{name} <ChevronDown size={10} strokeWidth={1.5} className="inline -mt-0.5" /> {t("controls.close")}</>;
    if (action.orderAlias === "position")
      return <>{name} → {t("controls.position")} {action.value}%</>;
  }

  if (eq?.type?.startsWith("light_")) {
    if ((action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) ||
        (action.orderAlias === "turn_on" && typeof action.value === "boolean"))
    {
      const on = action.value === "ON" || action.value === true;
      return <>{name} → {on ? "ON" : "OFF"}</>;
    }
    if (action.orderAlias === "brightness") {
      const max = eq.orderBindings.find((o) => o.alias === "brightness")?.max ?? 254;
      return <>{name} → {t("controls.brightness")} {Math.round((Number(action.value) / max) * 100)}%</>;
    }
  }

  if (action.orderAlias === "state" && (action.value === "ON" || action.value === "OFF")) {
    return <>{name} → {action.value}</>;
  }
  if (action.orderAlias === "turn_on" && typeof action.value === "boolean") {
    return <>{name} → {action.value ? "ON" : "OFF"}</>;
  }

  return <>{name} → {action.orderAlias} = {JSON.stringify(action.value)}</>;
}

function ActionRow({
  action,
  equipments,
  instances,
  resolveRecipeName,
  onRemove,
  onUpdate,
  pending,
}: {
  action: ZoneModeImpactAction;
  equipments: EquipmentWithDetails[];
  instances: { id: string; recipeId: string; params: Record<string, unknown> }[];
  resolveRecipeName: (recipeId: string) => string;
  onRemove: () => void;
  onUpdate?: (updated: ZoneModeImpactAction) => void;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editAlias, setEditAlias] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);

  const eq = action.type === "order"
    ? equipments.find((e) => e.id === action.equipmentId)
    : undefined;

  const startEdit = () => {
    if (action.type === "order") {
      setEditAlias(action.orderAlias);
      // Store value as the format SmartOrderPicker expects
      const v = action.value;
      if (typeof v === "string") {
        setEditValue(JSON.stringify(v));
      } else {
        setEditValue(String(v));
      }
    } else if (action.type === "recipe_toggle") {
      setEditEnabled(action.enabled);
    }
    setEditing(true);
  };

  const confirmEdit = () => {
    if (!onUpdate) return;
    if (action.type === "order") {
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(editValue); } catch { parsedValue = editValue; }
      onUpdate({ ...action, orderAlias: editAlias, value: parsedValue });
    } else if (action.type === "recipe_toggle") {
      onUpdate({ ...action, enabled: editEnabled });
    }
    setEditing(false);
  };

  let label: React.ReactNode = "";
  if (action.type === "order") {
    label = formatOrderLabel(action, eq, t);
  } else if (action.type === "recipe_toggle") {
    const inst = instances.find((i) => i.id === action.instanceId);
    const name = inst ? resolveRecipeName(inst.recipeId) : action.instanceId;
    label = `${name} → ${action.enabled ? t("common.on") : t("common.off")}`;
  } else if (action.type === "recipe_params") {
    const inst = instances.find((i) => i.id === action.instanceId);
    const name = inst ? resolveRecipeName(inst.recipeId) : action.instanceId;
    label = `${name} → ${JSON.stringify(action.params)}`;
  }

  if (editing) {
    return (
      <div className="rounded-[4px] border border-primary/20 bg-primary/5 p-1.5 space-y-1.5">
        <div className="text-[10px] text-text-tertiary truncate">
          {action.type === "order"
            ? eq?.name ?? action.equipmentId
            : (() => { const inst = instances.find((i) => i.id === (action as { instanceId: string }).instanceId); return inst ? resolveRecipeName(inst.recipeId) : (action as { instanceId: string }).instanceId; })()}
        </div>
        {action.type === "order" && eq && (
          <SmartOrderPicker
            equipment={eq}
            orderAlias={editAlias}
            orderValue={editValue}
            onSelect={(alias, value) => { setEditAlias(alias); setEditValue(value); }}
            onChangeValue={setEditValue}
          />
        )}
        {action.type === "order" && !eq && (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full px-2 py-1 text-[11px] bg-surface border border-border rounded-[4px] text-text"
          />
        )}
        {action.type === "recipe_toggle" && (
          <div className="inline-flex">
            <button
              onClick={() => setEditEnabled(true)}
              className={`inline-flex items-center justify-center px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-border-light rounded-l-[4px] ${
                editEnabled ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
              }`}
            >
              {t("common.on")}
            </button>
            <button
              onClick={() => setEditEnabled(false)}
              className={`inline-flex items-center justify-center px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-l-0 border-border-light rounded-r-[4px] ${
                !editEnabled ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
              }`}
            >
              {t("common.off")}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={confirmEdit}
            className="text-[10px] font-medium text-primary hover:text-primary-hover transition-colors"
          >
            <Check size={9} strokeWidth={2} className="inline -mt-0.5 mr-0.5" />
            {t("common.save")}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-[4px] border ${
      pending ? "bg-primary/5 border-primary/20" : "bg-surface border-border-light"
    }`}>
      <span className="text-[11px] text-text flex-1 truncate">{label}</span>
      {onUpdate && action.type !== "recipe_params" && (
        <button onClick={startEdit} className="text-text-tertiary hover:text-primary flex-shrink-0">
          <Pencil size={10} strokeWidth={1.5} />
        </button>
      )}
      <button onClick={onRemove} className="text-text-tertiary hover:text-error flex-shrink-0">
        <Trash2 size={10} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function OrderValueControl({
  order,
  value,
  onChange,
}: {
  order: OrderBindingWithDetails;
  value: string;
  onChange: (v: string) => void;
}) {
  const seg = (active: boolean, pos: "first" | "mid" | "last" | "solo") => {
    const r = pos === "first" ? "rounded-l-[4px]" : pos === "last" ? "rounded-r-[4px]" : pos === "solo" ? "rounded-[4px]" : "";
    return `inline-flex items-center justify-center px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-l-0 first:border-l border-border-light ${r} ${
      active ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
    }`;
  };

  // Boolean → ON/OFF
  if (order.type === "boolean") {
    return (
      <div className="inline-flex">
        {["true", "false"].map((v, i, arr) => (
          <button key={v} onClick={() => onChange(v)} className={seg(value === v, arr.length === 1 ? "solo" : i === 0 ? "first" : "last")}>
            {v === "true" ? "ON" : "OFF"}
          </button>
        ))}
      </div>
    );
  }

  // Enum (exclude transient commands like STOP — modes define target states)
  const filteredEnumValues = order.enumValues?.filter((v) => v !== "STOP");
  if (order.type === "enum" && filteredEnumValues && filteredEnumValues.length > 0) {
    return (
      <div className="inline-flex">
        {filteredEnumValues.map((v, i, arr) => (
          <button key={v} onClick={() => onChange(JSON.stringify(v))} className={seg(value === JSON.stringify(v), arr.length === 1 ? "solo" : i === 0 ? "first" : i === arr.length - 1 ? "last" : "mid")}>
            {v}
          </button>
        ))}
      </div>
    );
  }

  // Number with min/max → slider
  if (order.type === "number" && order.min != null && order.max != null) {
    const numValue = Number(value) || order.min;
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min={order.min}
          max={order.max}
          step={1}
          value={numValue}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-1 accent-primary"
        />
        <span className="text-[10px] text-text-secondary tabular-nums w-10 text-right">
          {value || order.min}{order.unit ? ` ${order.unit}` : ""}
        </span>
      </div>
    );
  }

  // Fallback → text input
  return (
    <input
      type={order.type === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={order.unit ? `(${order.unit})` : ""}
      className="w-full px-1.5 py-1 text-[10px] bg-surface border border-border rounded-[4px] text-text placeholder:text-text-tertiary"
    />
  );
}

function SmartOrderPicker({
  equipment,
  orderAlias,
  orderValue,
  onSelect,
  onChangeValue,
}: {
  equipment: EquipmentWithDetails;
  orderAlias: string;
  orderValue: string;
  onSelect: (alias: string, value: string) => void;
  onChangeValue: (value: string) => void;
}) {
  const { t } = useTranslation();

  const orders = equipment.orderBindings;
  const isShutter = equipment.type === "shutter";
  const isLight = equipment.type.startsWith("light_");

  const stateOrder = orders.find((o) => o.alias === "state");
  const turnOnOrder = orders.find((o) => o.alias === "turn_on");
  const brightnessOrder = orders.find((o) => o.alias === "brightness");
  const positionOrder = orders.find((o) => o.alias === "position");
  const selectedOrder = orders.find((o) => o.alias === orderAlias);

  const toggleAlias = stateOrder ? "state" : turnOnOrder ? "turn_on" : null;
  const onVal = stateOrder ? '"ON"' : "true";
  const offVal = stateOrder ? '"OFF"' : "false";

  const isActive = (alias: string, val?: string) =>
    orderAlias === alias && (val === undefined || orderValue === val);

  const seg = (active: boolean, pos: "first" | "mid" | "last" | "solo") => {
    const r = pos === "first" ? "rounded-l-[4px]" : pos === "last" ? "rounded-r-[4px]" : pos === "solo" ? "rounded-[4px]" : "";
    return `inline-flex items-center justify-center gap-0.5 px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-l-0 first:border-l border-border-light ${r} ${
      active ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
    }`;
  };

  if (isShutter) {
    const shutterOptions: { alias: string; val?: string; label: React.ReactNode }[] = [];
    if (stateOrder) {
      shutterOptions.push({ alias: "state", val: '"OPEN"', label: <><ChevronUp size={10} strokeWidth={1.5} /> {t("controls.open")}</> });
      shutterOptions.push({ alias: "state", val: '"CLOSE"', label: <><ChevronDown size={10} strokeWidth={1.5} /> {t("controls.close")}</> });
    }
    if (positionOrder) {
      shutterOptions.push({ alias: "position", label: t("controls.position") });
    }
    return (
      <div className="space-y-1.5">
        <div className="inline-flex">
          {shutterOptions.map((opt, i) => (
            <button
              key={`${opt.alias}-${opt.val ?? ""}`}
              onClick={() => onSelect(opt.alias, opt.val ?? "50")}
              className={seg(isActive(opt.alias, opt.val), shutterOptions.length === 1 ? "solo" : i === 0 ? "first" : i === shutterOptions.length - 1 ? "last" : "mid")}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {orderAlias === "position" && positionOrder && (
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={positionOrder.min ?? 0}
              max={positionOrder.max ?? 100}
              value={Number(orderValue) || 50}
              onChange={(e) => onChangeValue(e.target.value)}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-[10px] text-text-secondary tabular-nums w-7 text-right">{orderValue}%</span>
          </div>
        )}
      </div>
    );
  }

  if (isLight) {
    const lightOptions: { alias: string; val: string; label: string }[] = [];
    if (toggleAlias) {
      lightOptions.push({ alias: toggleAlias, val: onVal, label: "ON" });
      lightOptions.push({ alias: toggleAlias, val: offVal, label: "OFF" });
    }
    if (brightnessOrder) {
      lightOptions.push({ alias: "brightness", val: String(brightnessOrder.max ?? 254), label: t("controls.brightness") });
    }
    return (
      <div className="space-y-1.5">
        <div className="inline-flex">
          {lightOptions.map((opt, i) => (
            <button
              key={`${opt.alias}-${opt.val}`}
              onClick={() => onSelect(opt.alias, opt.val)}
              className={seg(isActive(opt.alias, opt.val), lightOptions.length === 1 ? "solo" : i === 0 ? "first" : i === lightOptions.length - 1 ? "last" : "mid")}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {orderAlias === "brightness" && brightnessOrder && (
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={brightnessOrder.min ?? 0}
              max={brightnessOrder.max ?? 254}
              value={Number(orderValue) || 0}
              onChange={(e) => onChangeValue(e.target.value)}
              className="flex-1 h-1 accent-primary"
            />
            <span className="text-[10px] text-text-secondary tabular-nums w-7 text-right">
              {Math.round((Number(orderValue) / (brightnessOrder.max ?? 254)) * 100)}%
            </span>
          </div>
        )}
      </div>
    );
  }

  if (toggleAlias && orders.length <= 2) {
    return (
      <div className="inline-flex">
        <button onClick={() => onSelect(toggleAlias, onVal)} className={seg(isActive(toggleAlias, onVal), "first")}>
          ON
        </button>
        <button onClick={() => onSelect(toggleAlias, offVal)} className={seg(isActive(toggleAlias, offVal), "last")}>
          OFF
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="inline-flex">
        {orders.map((order, i) => (
          <button
            key={order.alias}
            onClick={() => onSelect(order.alias, "")}
            className={seg(isActive(order.alias), orders.length === 1 ? "solo" : i === 0 ? "first" : i === orders.length - 1 ? "last" : "mid")}
          >
            {order.alias}
          </button>
        ))}
      </div>
      {selectedOrder && (
        <OrderValueControl order={selectedOrder} value={orderValue} onChange={onChangeValue} />
      )}
    </div>
  );
}

function AddActionForm({
  equipments,
  instances,
  resolveRecipeName,
  onAdd,
  onDone,
}: {
  equipments: EquipmentWithDetails[];
  instances: { id: string; recipeId: string; params: Record<string, unknown> }[];
  resolveRecipeName: (recipeId: string) => string;
  onAdd: (action: ZoneModeImpactAction) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [actionType, setActionType] = useState<"order" | "recipe_toggle">("order");
  const [equipmentId, setEquipmentId] = useState("");
  const [orderAlias, setOrderAlias] = useState("");
  const [orderValue, setOrderValue] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [enabled, setEnabled] = useState(true);

  const selectedEquipment = equipments.find((eq) => eq.id === equipmentId);

  const handleAdd = () => {
    if (actionType === "order") {
      let parsedValue: unknown;
      try { parsedValue = JSON.parse(orderValue); } catch { parsedValue = orderValue; }
      onAdd({ type: "order", equipmentId, orderAlias, value: parsedValue });
      setOrderAlias("");
      setOrderValue("");
    } else if (actionType === "recipe_toggle") {
      onAdd({ type: "recipe_toggle", instanceId, enabled });
      setInstanceId("");
      setEnabled(true);
    }
  };

  const canAdd = actionType === "order"
    ? equipmentId && orderAlias && orderValue
    : instanceId;

  const tab = (active: boolean) =>
    `px-2 py-1 text-[10px] font-medium transition-colors border-b-2 ${
      active
        ? "border-primary text-primary"
        : "border-transparent text-text-tertiary hover:text-text-secondary"
    }`;

  return (
    <div className="bg-surface rounded-[4px] border border-border-light overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border-light">
        <button onClick={() => setActionType("order")} className={tab(actionType === "order")}>
          {t("modes.actionType.order")}
        </button>
        <button onClick={() => setActionType("recipe_toggle")} className={tab(actionType === "recipe_toggle")}>
          {t("modes.actionType.recipe_toggle")}
        </button>
      </div>

      <div className="p-2 space-y-1.5">
        {actionType === "order" && (
          <>
            <select
              value={equipmentId}
              onChange={(e) => { setEquipmentId(e.target.value); setOrderAlias(""); setOrderValue(""); }}
              className="w-full px-1.5 py-1 text-[11px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("modes.form.selectEquipment")}</option>
              {equipments.filter((eq) => eq.orderBindings.length > 0).map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.name}</option>
              ))}
            </select>
            {selectedEquipment && (
              <SmartOrderPicker
                equipment={selectedEquipment}
                orderAlias={orderAlias}
                orderValue={orderValue}
                onSelect={(alias, value) => { setOrderAlias(alias); setOrderValue(value); }}
                onChangeValue={setOrderValue}
              />
            )}
          </>
        )}

        {actionType === "recipe_toggle" && (
          <>
            <select
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="w-full px-1.5 py-1 text-[11px] bg-surface border border-border rounded-[4px] text-text"
            >
              <option value="">{t("modes.form.selectRecipe")}</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>{resolveRecipeName(inst.recipeId)}</option>
              ))}
            </select>
            {instanceId && (
              <div className="inline-flex">
                <button
                  onClick={() => setEnabled(true)}
                  className={`inline-flex items-center justify-center px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-border-light rounded-l-[4px] ${
                    enabled ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
                  }`}
                >
                  {t("common.on")}
                </button>
                <button
                  onClick={() => setEnabled(false)}
                  className={`inline-flex items-center justify-center px-2 py-[3px] text-[10px] font-medium transition-all cursor-pointer border border-l-0 border-border-light rounded-r-[4px] ${
                    !enabled ? "bg-primary/10 text-primary border-primary/30 z-10 relative" : "text-text-tertiary hover:text-text-secondary hover:bg-border-light/40"
                  }`}
                >
                  {t("common.off")}
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="text-[10px] font-medium text-primary hover:text-primary-hover disabled:text-text-tertiary disabled:opacity-50 transition-colors"
          >
            + {t("common.add")}
          </button>
          <button
            onClick={onDone}
            className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}


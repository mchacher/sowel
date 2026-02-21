import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { getEquipment } from "../api";
import { EquipmentForm } from "../components/equipments/EquipmentForm";
import { LightControl } from "../components/equipments/LightControl";
import { ShutterControl } from "../components/equipments/ShutterControl";
import { SensorDataPanel } from "../components/equipments/SensorDataPanel";
import { AddBindingModal } from "../components/equipments/AddBindingModal";
import { TYPE_ICONS, TYPE_LABELS } from "../components/equipments/EquipmentCard";
import { useEquipmentState } from "../components/equipments/useEquipmentState";
import {
  ArrowLeft,
  Loader2,
  Box,
  Pencil,
  Trash2,
  Link2,
  Unlink,
  Zap,
  Plus,
  Cpu,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { formatRelativeTime } from "../lib/format";
import type { EquipmentWithDetails } from "../types";

export function EquipmentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const equipments = useEquipments((s) => s.equipments);
  const updateEquipment = useEquipments((s) => s.updateEquipment);
  const deleteEquipment = useEquipments((s) => s.deleteEquipment);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const addDataBinding = useEquipments((s) => s.addDataBinding);
  const removeDataBinding = useEquipments((s) => s.removeDataBinding);
  const addOrderBinding = useEquipments((s) => s.addOrderBinding);
  const removeOrderBinding = useEquipments((s) => s.removeOrderBinding);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);

  const [equipment, setEquipment] = useState<EquipmentWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showAddDataBinding, setShowAddDataBinding] = useState(false);
  const [showAddOrderBinding, setShowAddOrderBinding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showBindings, setShowBindings] = useState(false);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    // Only show loading spinner on initial load, not on WebSocket refetches
    const isInitialLoad = equipment === null;
    if (isInitialLoad) {
      setLoading(true);
      setError(null);
    }

    getEquipment(id)
      .then((data) => {
        if (!cancelled) {
          setEquipment(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load equipment");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [id, equipments]); // Re-fetch when store updates

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error || !equipment) {
    return (
      <div className="p-6">
        <Link to="/equipments" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text mb-4">
          <ArrowLeft size={14} strokeWidth={1.5} />
          {t("equipments.backToEquipments")}
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <Box size={28} strokeWidth={1.5} className="text-error" />
          </div>
          <h3 className="text-[16px] font-medium text-text mb-1">{t("equipments.notFound.title")}</h3>
          <p className="text-[13px] text-text-secondary">{error ?? t("equipments.notFound.message")}</p>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm(t("equipments.deleteConfirm", { name: equipment.name }))) return;
    setDeleting(true);
    try {
      await deleteEquipment(equipment.id);
      navigate("/equipments");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete equipment");
      setDeleting(false);
    }
  };

  const { isLight, isShutter, isSensor, actionBinding } = useEquipmentState(equipment);

  return (
    <div className="p-6">
      {/* Back link */}
      <Link to="/equipments" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text mb-4">
        <ArrowLeft size={14} strokeWidth={1.5} />
        {t("equipments.backToEquipments")}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[8px] bg-primary-light flex items-center justify-center text-primary">
            {TYPE_ICONS[equipment.type]}
          </div>
          <div>
            <h1 className="text-[24px] font-semibold text-text leading-[32px]">
              {equipment.name}
            </h1>
            <p className="text-[13px] text-text-secondary">
              {t(TYPE_LABELS[equipment.type])}
              {equipment.description && ` · ${equipment.description}`}
              {!equipment.enabled && (
                <span className="text-warning ml-2">{t("common.disabled")}</span>
              )}
            </p>
            {actionBinding && actionBinding.value != null && (
              <div className="flex items-center gap-1.5 mt-1 text-[12px] text-text-tertiary">
                <Clock size={12} strokeWidth={1.5} />
                <span className="font-mono font-medium text-text-secondary">{String(actionBinding.value)}</span>
                {actionBinding.lastUpdated && (
                  <span>· {formatRelativeTime(actionBinding.lastUpdated)}</span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditForm(true)}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-text-secondary border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150"
          >
            <Pencil size={14} strokeWidth={1.5} />
            {t("common.edit")}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-error border border-error/30 rounded-[6px] hover:bg-error/10 transition-colors duration-150 disabled:opacity-50"
          >
            <Trash2 size={14} strokeWidth={1.5} />
            {deleting ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
      </div>

      {/* Controls */}
      {isLight && equipment.enabled && (
        <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
          <h3 className="text-[14px] font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <LightControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Shutter controls */}
      {isShutter && equipment.enabled && (
        <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
          <h3 className="text-[14px] font-semibold text-text mb-3">{t("equipments.controls")}</h3>
          <ShutterControl
            equipment={equipment}
            onExecuteOrder={(alias, value) => executeOrder(equipment.id, alias, value)}
          />
        </div>
      )}

      {/* Sensor data */}
      {isSensor && (
        <SensorDataPanel bindings={equipment.dataBindings} />
      )}

      {/* Devices */}
      <DevicesSection equipment={equipment} />

      {/* Technical: Bindings (collapsible) */}
      <div className="bg-surface rounded-[10px] border border-border mb-6">
        <button
          type="button"
          onClick={() => setShowBindings(!showBindings)}
          className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
        >
          {showBindings
            ? <ChevronDown size={14} strokeWidth={1.5} className="text-text-tertiary" />
            : <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
          }
          <span className="text-[13px] font-medium text-text-secondary">{t("equipments.bindings")}</span>
          <span className="text-[11px] text-text-tertiary">
            {t("equipments.bindingCount", { count: equipment.dataBindings.length + equipment.orderBindings.length })}
          </span>
        </button>

        {showBindings && (
          <div className="px-4 pb-4 space-y-4">
            {/* Data Bindings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[12px] font-medium text-text-tertiary flex items-center gap-1.5">
                  <Link2 size={13} strokeWidth={1.5} />
                  {t("equipments.dataBindings")}
                </h4>
                <button
                  onClick={() => setShowAddDataBinding(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary border border-primary/30 rounded-[4px] hover:bg-primary-light transition-colors duration-150"
                >
                  <Plus size={11} strokeWidth={1.5} />
                  {t("common.add")}
                </button>
              </div>
              {equipment.dataBindings.length === 0 ? (
                <p className="text-[12px] text-text-tertiary">{t("common.none")}</p>
              ) : (
                <div className="space-y-1">
                  {equipment.dataBindings.map((binding) => (
                    <div key={binding.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] bg-border-light/50 text-[12px] group">
                      <span className="font-mono font-medium text-primary">{binding.alias}</span>
                      <span className="text-text-tertiary">({binding.category})</span>
                      <span className="text-text-tertiary">· {binding.deviceName} · {binding.key}</span>
                      <span className="ml-auto font-mono text-text">
                        {binding.value !== null && binding.value !== undefined ? String(binding.value) : "—"}
                        {binding.unit && <span className="text-text-tertiary ml-0.5">{binding.unit}</span>}
                      </span>
                      <button
                        onClick={() => removeDataBinding(equipment.id, binding.id)}
                        className="p-1 text-text-tertiary hover:text-error rounded-[3px] hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("common.remove")}
                      >
                        <Unlink size={11} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Order Bindings */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[12px] font-medium text-text-tertiary flex items-center gap-1.5">
                  <Zap size={13} strokeWidth={1.5} />
                  {t("equipments.orderBindings")}
                </h4>
                <button
                  onClick={() => setShowAddOrderBinding(true)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary border border-primary/30 rounded-[4px] hover:bg-primary-light transition-colors duration-150"
                >
                  <Plus size={11} strokeWidth={1.5} />
                  {t("common.add")}
                </button>
              </div>
              {equipment.orderBindings.length === 0 ? (
                <p className="text-[12px] text-text-tertiary">{t("common.none")}</p>
              ) : (
                <div className="space-y-1">
                  {equipment.orderBindings.map((binding) => (
                    <div key={binding.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-[4px] bg-border-light/50 text-[12px] group">
                      <span className="font-mono font-medium text-accent">{binding.alias}</span>
                      <span className="text-text-tertiary">({binding.type})</span>
                      <span className="text-text-tertiary">· {binding.deviceName} · {binding.key}</span>
                      <button
                        onClick={() => removeOrderBinding(equipment.id, binding.id)}
                        className="ml-auto p-1 text-text-tertiary hover:text-error rounded-[3px] hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t("common.remove")}
                      >
                        <Unlink size={11} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit equipment modal */}
      {showEditForm && (
        <EquipmentForm
          title={t("equipments.editEquipment")}
          initial={{
            name: equipment.name,
            type: equipment.type,
            zoneId: equipment.zoneId,
          }}
          zones={tree}
          onSubmit={async (data) => {
            await updateEquipment(equipment.id, {
              name: data.name,
              type: data.type,
              zoneId: data.zoneId,
            });
          }}
          onClose={() => setShowEditForm(false)}
        />
      )}

      {/* Add data binding modal */}
      {showAddDataBinding && (
        <AddBindingModal
          mode="data"
          existingAliases={equipment.dataBindings.map((b) => b.alias)}
          onAdd={async ({ id: deviceDataId, alias }) => {
            await addDataBinding(equipment.id, deviceDataId, alias);
          }}
          onClose={() => setShowAddDataBinding(false)}
        />
      )}

      {/* Add order binding modal */}
      {showAddOrderBinding && (
        <AddBindingModal
          mode="order"
          existingAliases={equipment.orderBindings.map((b) => b.alias)}
          onAdd={async ({ id: deviceOrderId, alias }) => {
            await addOrderBinding(equipment.id, deviceOrderId, alias);
          }}
          onClose={() => setShowAddOrderBinding(false)}
        />
      )}
    </div>
  );
}

/** Group bindings by device and show a summary card per device. */
function DevicesSection({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  // Collect unique devices from all bindings
  const deviceMap = new Map<string, { deviceId: string; deviceName: string; dataKeys: string[]; orderKeys: string[]; values: Record<string, { value: unknown; unit?: string }> }>();

  for (const db of equipment.dataBindings) {
    let entry = deviceMap.get(db.deviceId);
    if (!entry) {
      entry = { deviceId: db.deviceId, deviceName: db.deviceName, dataKeys: [], orderKeys: [], values: {} };
      deviceMap.set(db.deviceId, entry);
    }
    entry.dataKeys.push(db.alias);
    entry.values[db.alias] = { value: db.value, unit: db.unit };
  }
  for (const ob of equipment.orderBindings) {
    let entry = deviceMap.get(ob.deviceId);
    if (!entry) {
      entry = { deviceId: ob.deviceId, deviceName: ob.deviceName, dataKeys: [], orderKeys: [], values: {} };
      deviceMap.set(ob.deviceId, entry);
    }
    entry.orderKeys.push(ob.alias);
  }

  const devices = [...deviceMap.values()];

  if (devices.length === 0) {
    return (
      <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
        <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-2">
          <Cpu size={16} strokeWidth={1.5} className="text-text-tertiary" />
          {t("equipments.devices")}
        </h3>
        <p className="text-[13px] text-text-tertiary">{t("equipments.noDevice")}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 mb-6">
      <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 mb-3">
        <Cpu size={16} strokeWidth={1.5} className="text-text-tertiary" />
        {t("equipments.devices")}
      </h3>
      <div className="space-y-2">
        {devices.map((dev) => (
          <div key={dev.deviceId} className="flex items-center gap-3 px-3 py-2.5 rounded-[6px] bg-border-light/50">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-text">{dev.deviceName}</div>
              <div className="text-[11px] text-text-tertiary mt-0.5">
                {[...new Set([...dev.dataKeys, ...dev.orderKeys])].join(", ")}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {Object.entries(dev.values).map(([key, { value, unit }]) => (
                <div key={key} className="text-right">
                  <div className="text-[14px] font-medium text-text font-mono">
                    {value !== null && value !== undefined ? String(value) : "—"}
                    {unit && <span className="text-[11px] text-text-tertiary ml-0.5">{unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

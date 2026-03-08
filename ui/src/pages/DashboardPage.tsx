import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Plus, Pencil, Check } from "lucide-react";
import { useDashboard } from "../store/useDashboard";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useAuth } from "../store/useAuth";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { WidgetGrid } from "../components/dashboard/WidgetGrid";
import { AddWidgetModal } from "../components/dashboard/AddWidgetModal";
import type { ZoneWithChildren, WidgetFamily } from "../types";

export function DashboardPage() {
  useWsSubscription(["equipments", "zones"]);
  const { t } = useTranslation();

  const widgets = useDashboard((s) => s.widgets);
  const fetchWidgets = useDashboard((s) => s.fetchWidgets);
  const createWidget = useDashboard((s) => s.createWidget);
  const deleteWidget = useDashboard((s) => s.deleteWidget);
  const reorderWidgets = useDashboard((s) => s.reorderWidgets);
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";

  const [editMode, setEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchWidgets();
    fetchEquipments();
    fetchZones();
  }, [fetchWidgets, fetchEquipments, fetchZones]);

  // Build a flat zone map for fast lookup
  const zoneMap = useMemo(() => {
    const map = new Map<string, ZoneWithChildren>();
    function walk(zones: ZoneWithChildren[]) {
      for (const z of zones) {
        map.set(z.id, z);
        walk(z.children);
      }
    }
    walk(tree);
    return map;
  }, [tree]);

  // Build equipment map for fast lookup
  const equipmentMap = useMemo(() => {
    return new Map(equipments.map((e) => [e.id, e]));
  }, [equipments]);

  const handleAddEquipment = useCallback(async (equipmentId: string) => {
    await createWidget({ type: "equipment", equipmentId });
  }, [createWidget]);

  const handleAddZone = useCallback(async (zoneId: string, family: WidgetFamily) => {
    await createWidget({ type: "zone", zoneId, family });
  }, [createWidget]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteWidget(id);
  }, [deleteWidget]);

  const handleReorder = useCallback(async (order: string[]) => {
    await reorderWidgets(order);
  }, [reorderWidgets]);

  // Empty state
  if (widgets.length === 0 && !editMode) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
            <LayoutDashboard size={28} strokeWidth={1.5} className="text-text-tertiary" />
          </div>
          <h3 className="text-[16px] font-medium text-text mb-1">{t("dashboard.emptyTitle")}</h3>
          <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">
            {isAdmin ? t("dashboard.emptyDescAdmin") : t("dashboard.emptyDesc")}
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <Plus size={16} strokeWidth={1.5} />
              {t("dashboard.addFirstWidget")}
            </button>
          )}
        </div>
        {showAddModal && (
          <AddWidgetModal
            equipments={equipments}
            zones={tree}
            onAddEquipment={handleAddEquipment}
            onAddZone={handleAddZone}
            onClose={() => setShowAddModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[22px] font-semibold text-text leading-[28px]">
            {t("dashboard.title")}
          </h1>
          {isAdmin && (
            <div className="flex items-center gap-2">
              {editMode && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-primary bg-primary-light border border-primary/20 rounded-[6px] hover:bg-primary/15 transition-colors cursor-pointer"
                >
                  <Plus size={14} strokeWidth={1.5} />
                  {t("dashboard.addWidget")}
                </button>
              )}
              <button
                onClick={() => setEditMode(!editMode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-[6px] transition-colors cursor-pointer ${
                  editMode
                    ? "text-white bg-primary hover:bg-primary-hover"
                    : "text-text-secondary bg-surface border border-border hover:bg-border-light"
                }`}
              >
                {editMode ? (
                  <>
                    <Check size={14} strokeWidth={1.5} />
                    {t("dashboard.done")}
                  </>
                ) : (
                  <>
                    <Pencil size={14} strokeWidth={1.5} />
                    {t("dashboard.edit")}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Widget grid */}
        <WidgetGrid
          widgets={widgets}
          equipmentMap={equipmentMap}
          zoneMap={zoneMap}
          equipments={equipments}
          editMode={editMode}
          onExecuteOrder={executeOrder}
          onReorder={handleReorder}
          onDelete={handleDelete}
        />
      </div>

      {showAddModal && (
        <AddWidgetModal
          equipments={equipments}
          zones={tree}
          onAddEquipment={handleAddEquipment}
          onAddZone={handleAddZone}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

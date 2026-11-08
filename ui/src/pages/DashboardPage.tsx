import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Plus, Pencil, Check, Loader2, AlertCircle } from "lucide-react";
import { useDashboard } from "../store/useDashboard";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { useRecipes } from "../store/useRecipes";
import { useAuth } from "../store/useAuth";
import { useWsSubscription } from "../hooks/useWsSubscription";
import { WidgetGrid } from "../components/dashboard/WidgetGrid";
import { AddWidgetModal } from "../components/dashboard/AddWidgetModal";
import type { EquipmentWithDetails, ZoneWithChildren, WidgetFamily } from "../types";
import { equipmentZoneQualifiers, flattenZonesWithPath, zoneChainMap } from "../lib/zone-path";
import { ZoneHeroLead } from "../components/home/ZoneHeroLead";
import { useZoneAggregation } from "../store/useZoneAggregation";
import { ROOT_ZONE_ID } from "../lib/constants";

export function DashboardPage() {
  // Spec 169 — "recipes" joins the subscription so a pinned tile's countdown
  // and status follow the instance live, the way equipment widgets follow
  // their bindings.
  useWsSubscription(["equipments", "zones", "recipes"]);
  const { t } = useTranslation();

  const widgets = useDashboard((s) => s.widgets);
  const loaded = useDashboard((s) => s.loaded);
  const loadError = useDashboard((s) => s.error);
  const fetchWidgets = useDashboard((s) => s.fetchWidgets);
  const createWidget = useDashboard((s) => s.createWidget);
  const deleteWidget = useDashboard((s) => s.deleteWidget);
  const reorderWidgets = useDashboard((s) => s.reorderWidgets);
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);
  const fetchRecipes = useRecipes((s) => s.fetchRecipes);
  const fetchInstances = useRecipes((s) => s.fetchInstances);
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";
  const rootAgg = useZoneAggregation((s) => s.data[ROOT_ZONE_ID]);

  const [editMode, setEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchWidgets();
    fetchEquipments();
    fetchZones();
    fetchRecipes();
    fetchInstances();
  }, [fetchWidgets, fetchEquipments, fetchZones, fetchRecipes, fetchInstances]);

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

  const zoneOptions = useMemo(() => flattenZonesWithPath(tree), [tree]);

  // Path-aware zone labels (spec 139): a widget on one of two homonym zones
  // must say which one it watches.
  const zoneLabels = useMemo(() => new Map(zoneOptions.map((z) => [z.id, z.label])), [zoneOptions]);

  // Build equipment map for fast lookup
  const equipmentMap = useMemo(() => {
    return new Map(equipments.map((e) => [e.id, e]));
  }, [equipments]);

  // Same treatment for equipments (spec 139): two widgets driving homonym
  // equipments are indistinguishable, so the ones that clash get their zone
  // shown under the name. Scoped to what the dashboard actually shows — a lone
  // "Température" widget keeps its bare name even if the house has five more.
  const equipmentZones = useMemo(() => {
    const shown = new Map<string, EquipmentWithDetails>();
    for (const widget of widgets) {
      if (widget.type !== "equipment" || !widget.equipmentId) continue;
      const equipment = equipmentMap.get(widget.equipmentId);
      // Same equipment twice on the dashboard is one candidate, not two
      // homonyms: keying by id keeps it from qualifying itself.
      if (equipment) shown.set(equipment.id, equipment);
    }
    return equipmentZoneQualifiers([...shown.values()], zoneChainMap(zoneOptions));
  }, [widgets, equipmentMap, zoneOptions]);

  const handleAddEquipment = useCallback(
    async (equipmentId: string, timed?: boolean) => {
      // Spec 174 phase 2 — the timed variant is one flag on the widget's own
      // config, so the same equipment can carry both tiles.
      await createWidget({
        type: "equipment",
        equipmentId,
        ...(timed ? { config: { timed: true } } : {}),
      });
    },
    [createWidget],
  );

  const handleAddZone = useCallback(
    async (zoneId: string, family: WidgetFamily) => {
      await createWidget({ type: "zone", zoneId, family });
    },
    [createWidget],
  );

  const handleAddRecipe = useCallback(
    async (recipeInstanceId: string) => {
      await createWidget({ type: "recipe", recipeInstanceId });
    },
    [createWidget],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteWidget(id);
    },
    [deleteWidget],
  );

  const handleReorder = useCallback(
    async (order: string[]) => {
      await reorderWidgets(order);
    },
    [reorderWidgets],
  );

  // Issue #1150 — an empty list means "no widget" only once a load has succeeded.
  // Before that the page waits; a failed load with nothing to show says why and
  // offers a retry. A failed refresh keeps the widgets already on screen.
  if (loadError && widgets.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <AlertCircle size={28} strokeWidth={1.5} className="text-error" />
          </div>
          <h3 className="text-lead font-medium text-text mb-1">{t("common.error")}</h3>
          <p className="text-small text-text-secondary max-w-[320px] mb-4">{loadError}</p>
          <button
            onClick={() => fetchWidgets()}
            className="px-4 py-2 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover transition-colors duration-150"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div
        className="flex items-center justify-center py-20"
        role="status"
        aria-label={t("common.loading")}
      >
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  // Empty state
  if (widgets.length === 0 && !editMode) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
            <LayoutDashboard size={28} strokeWidth={1.5} className="text-text-tertiary" />
          </div>
          <h3 className="text-lead font-medium text-text mb-1">{t("dashboard.emptyTitle")}</h3>
          <p className="text-small text-text-secondary max-w-[320px] mb-4">
            {isAdmin ? t("dashboard.emptyDescAdmin") : t("dashboard.emptyDesc")}
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-fill text-white text-small font-medium rounded-sm hover:bg-primary-fill-hover transition-colors cursor-pointer"
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
            onAddRecipe={handleAddRecipe}
            onClose={() => setShowAddModal(false)}
          />
        )}
      </div>
    );
  }

  const rootZone = zoneMap.get(ROOT_ZONE_ID);

  return (
    <div className="p-4 sm:p-6">
      <div>
        {/* Desktop header: the page name, the home in one line under it, and the
            edit buttons. Below lg the compact top bar names the page, and editing
            starts from the button under the grid (spec 196, FR-6). */}
        <div className="hidden lg:flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h1>{t("dashboard.title")}</h1>
            {rootZone && <ZoneHeroLead zone={rootZone} aggData={rootAgg} />}
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {editMode && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-small font-medium text-primary bg-primary-light border border-primary/20 rounded-sm hover:bg-primary/15 transition-colors cursor-pointer"
                >
                  <Plus size={14} strokeWidth={1.5} />
                  {t("dashboard.addWidget")}
                </button>
              )}
              <button
                onClick={() => setEditMode(!editMode)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-small font-medium rounded-sm transition-colors cursor-pointer ${
                  editMode
                    ? "text-white bg-primary-fill hover:bg-primary-fill-hover"
                    : "text-text-secondary border border-border bg-surface hover:bg-border-light"
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
          zoneLabels={zoneLabels}
          equipmentZones={equipmentZones}
          equipments={equipments}
          editMode={editMode}
          onExecuteOrder={executeOrder}
          onReorder={handleReorder}
          onDelete={handleDelete}
        />

        {/* Below lg: editing is rare, so it starts from a quiet button under the
            last tile instead of a floating one over the grid (pr6-edition). */}
        {isAdmin && !editMode && (
          <button
            type="button"
            onClick={() => setEditMode(true)}
            className="lg:hidden mt-4 w-full flex items-center justify-center gap-2 min-h-11 rounded-sm text-small font-medium text-text-secondary hover:bg-border-light transition-colors duration-150"
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
            {t("dashboard.customize")}
          </button>
        )}
      </div>

      {/* While editing, below lg: a bar that stays at the bottom of the page,
          just above the bottom navigation (the page scrolls inside <main>). */}
      {isAdmin && editMode && (
        <div
          data-testid="dashboard-edit-bar"
          className="lg:hidden sticky bottom-0 z-30 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-4 flex items-center gap-2 px-4 sm:px-6 py-2 bg-surface border-t border-border-light"
        >
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-11 px-3 text-small font-medium text-primary bg-primary-light border border-primary/20 rounded-sm hover:bg-primary/15 transition-colors"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {t("dashboard.addWidget")}
          </button>
          <button
            type="button"
            onClick={() => setEditMode(false)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-11 px-3 text-small font-medium text-white bg-primary-fill rounded-sm hover:bg-primary-fill-hover transition-colors"
          >
            <Check size={16} strokeWidth={1.5} aria-hidden="true" />
            {t("dashboard.done")}
          </button>
        </div>
      )}

      {showAddModal && (
        <AddWidgetModal
          equipments={equipments}
          zones={tree}
          onAddEquipment={handleAddEquipment}
          onAddZone={handleAddZone}
          onAddRecipe={handleAddRecipe}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  Home,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  LightbulbOff,
  ArrowUpFromLine,
  ArrowDownToLine,
  Plus,
  Menu,
  X,
  Layers,
  DoorOpen,
} from "lucide-react";
import { useZones } from "../store/useZones";
import { useEquipments } from "../store/useEquipments";
import { useAuth } from "../store/useAuth";
import { useZoneAggregation } from "../store/useZoneAggregation";
import { executeZoneOrder, getHistoryStatus } from "../api";
import { ZoneEquipmentsView } from "../components/home/ZoneEquipmentsView";
import { ZoneAggregationPills } from "../components/home/ZoneAggregationPills";
import { ZoneRecipesSection } from "../components/recipes/ZoneRecipesSection";
import { ZoneModesSection } from "../components/home/ZoneModesSection";
import { EquipmentForm } from "../components/equipments/EquipmentForm";
import { autoCreateBindings } from "../components/equipments/bindingUtils";
import { useWsSubscription } from "../hooks/useWsSubscription";
import type { EquipmentType, ZoneWithChildren } from "../types";

export function HomePage() {
  useWsSubscription(["zones", "equipments", "modes", "recipes"]);
  const { t } = useTranslation();
  const { zoneId } = useParams();
  const navigate = useNavigate();
  const tree = useZones((s) => s.tree);
  const zonesLoading = useZones((s) => s.loading);
  const fetchZones = useZones((s) => s.fetchZones);
  const equipments = useEquipments((s) => s.equipments);
  const equipmentsLoading = useEquipments((s) => s.loading);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const createEquipment = useEquipments((s) => s.createEquipment);
  const user = useAuth((s) => s.user);
  const isAdmin = user?.role === "admin";
  const aggregationData = useZoneAggregation((s) => s.data);
  const fetchAggregation = useZoneAggregation((s) => s.fetchAggregation);
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);

  // Check if history (InfluxDB) is enabled — used for sparklines
  const [historyEnabled, setHistoryEnabled] = useState(false);

  useEffect(() => {
    fetchZones();
    fetchEquipments();
    fetchAggregation();
    getHistoryStatus()
      .then((s) => setHistoryEnabled(s.enabled && s.connected))
      .catch(() => setHistoryEnabled(false));
  }, [fetchZones, fetchEquipments, fetchAggregation]);

  // If no zoneId in URL, redirect to first zone
  useEffect(() => {
    if (!zoneId && !zonesLoading && tree.length > 0) {
      const firstZone = getFirstLeafZone(tree);
      if (firstZone) {
        navigate(`/home/${firstZone.id}`, { replace: true });
      }
    }
  }, [zoneId, zonesLoading, tree, navigate]);

  // Find the current zone in tree
  const currentZone = useMemo(() => {
    if (!zoneId) return null;
    return findZoneById(tree, zoneId);
  }, [tree, zoneId]);

  // Filter equipments for this zone
  const zoneEquipments = useMemo(() => {
    if (!zoneId) return [];
    return equipments.filter((eq) => eq.zoneId === zoneId);
  }, [equipments, zoneId]);

  const aggData = zoneId ? aggregationData[zoneId] : undefined;
  const [commandLoading, setCommandLoading] = useState<string | null>(null);

  const handleZoneCommand = useCallback(async (orderKey: string) => {
    if (!zoneId) return;
    setCommandLoading(orderKey);
    try {
      await executeZoneOrder(zoneId, orderKey);
    } catch {
      // Silently handle — the user sees the result via live updates
    } finally {
      setCommandLoading(null);
    }
  }, [zoneId]);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const loading = zonesLoading || equipmentsLoading;

  // No zone ID and no zones exist
  if (!zoneId && !zonesLoading && tree.length === 0) {
    return <NoZonesState />;
  }

  // Loading
  if (loading && !currentZone) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  // Zone not found (may have been deleted)
  if (zoneId && !currentZone && !zonesLoading) {
    return <ZoneNotFound />;
  }

  if (!currentZone) return null;

  return (
    <div className="p-4 sm:p-6">
      {/* Mobile zone drawer */}
      {drawerOpen && (
        <MobileZoneDrawer
          tree={tree}
          currentZoneId={zoneId}
          onSelect={(id) => { navigate(`/home/${id}`); setDrawerOpen(false); }}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Zone header + status bar */}
      <div className="max-w-[720px] mb-5">
        <div className="flex items-center gap-1.5">
          {/* Mobile burger button */}
          {tree.length > 0 && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden p-1 -ml-1 rounded-[6px] text-text-secondary hover:bg-border-light transition-colors"
            >
              <Menu size={18} strokeWidth={1.5} />
            </button>
          )}
          <h1 className="text-[17px] sm:text-[22px] font-semibold text-text leading-[24px] sm:leading-[28px]">
            {currentZone.name}
          </h1>
        </div>
        {currentZone.description && (
          <p className="text-[13px] text-text-secondary mt-0.5">
            {currentZone.description}
          </p>
        )}
        {zoneId && aggregationData[zoneId] && (
          <div className="mt-3">
            <ZoneAggregationPills data={aggregationData[zoneId]} zoneId={zoneId} historyEnabled={historyEnabled} />
          </div>
        )}
        {/* Zone command buttons */}
        {aggData && (aggData.lightsTotal > 0 || aggData.shuttersTotal > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {aggData.lightsTotal > 0 && (
              <>
                <button
                  onClick={() => handleZoneCommand("allLightsOn")}
                  disabled={commandLoading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-active/8 hover:text-active-text hover:border-active/40 transition-colors duration-150 disabled:opacity-50"
                >
                  {commandLoading === "allLightsOn" ? (
                    <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  ) : (
                    <Lightbulb size={14} strokeWidth={1.5} />
                  )}
                  {t("zones.commands.allLightsOn")}
                </button>
                <button
                  onClick={() => handleZoneCommand("allLightsOff")}
                  disabled={commandLoading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150 disabled:opacity-50"
                >
                  {commandLoading === "allLightsOff" ? (
                    <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  ) : (
                    <LightbulbOff size={14} strokeWidth={1.5} />
                  )}
                  {t("zones.commands.allLightsOff")}
                </button>
              </>
            )}
            {aggData.shuttersTotal > 0 && (
              <>
                <button
                  onClick={() => handleZoneCommand("allShuttersOpen")}
                  disabled={commandLoading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-primary/6 hover:text-primary hover:border-primary/40 transition-colors duration-150 disabled:opacity-50"
                >
                  {commandLoading === "allShuttersOpen" ? (
                    <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine size={14} strokeWidth={1.5} />
                  )}
                  {t("zones.commands.allShuttersOpen")}
                </button>
                <button
                  onClick={() => handleZoneCommand("allShuttersClose")}
                  disabled={commandLoading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary bg-surface border border-border rounded-[6px] hover:bg-border-light transition-colors duration-150 disabled:opacity-50"
                >
                  {commandLoading === "allShuttersClose" ? (
                    <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                  ) : (
                    <ArrowDownToLine size={14} strokeWidth={1.5} />
                  )}
                  {t("zones.commands.allShuttersClose")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Sections: Equipments + Behaviors */}
      <div className="max-w-[720px] space-y-6">
        <CollapsibleSection
          title={t("equipments.title")}
          storageKey="section-equipments"
          headerRight={isAdmin ? (
            <button
              onClick={() => setShowEquipmentForm(true)}
              className="p-0.5 rounded text-text-tertiary hover:text-primary hover:bg-primary/5 transition-colors duration-150"
              title={t("equipments.createEquipment")}
            >
              <Plus size={16} strokeWidth={1.5} />
            </button>
          ) : undefined}
        >
          <ZoneEquipmentsView
            zoneName={currentZone.name}
            equipments={zoneEquipments}
            onExecuteOrder={executeOrder}
            onAdd={isAdmin ? () => setShowEquipmentForm(true) : undefined}
          />
        </CollapsibleSection>

        {zoneId && (
          <CollapsibleSection title={t("behaviors.title")} storageKey="section-behaviors">
            <div className="space-y-3">
              <ZoneModesSection zoneId={zoneId} />
              <ZoneRecipesSection zoneId={zoneId} zoneName={currentZone.name} />
            </div>
          </CollapsibleSection>
        )}
      </div>

      {showEquipmentForm && zoneId && (
        <EquipmentForm
          title={t("equipments.createEquipment")}
          defaultZoneId={zoneId}
          zones={tree}
          excludeTypes={(() => {
            const exclude = new Set<EquipmentType>();
            if (equipments.some((eq) => eq.type === "main_energy_meter")) exclude.add("main_energy_meter");
            return exclude;
          })()}
          boundDeviceIds={new Set(equipments.flatMap((e) => [
            ...e.dataBindings.map((b) => b.deviceId),
            ...e.orderBindings.map((b) => b.deviceId),
          ]))}
          onSubmit={async (data) => {
            const equipment = await createEquipment({
              name: data.name,
              type: data.type,
              zoneId: data.zoneId,
            });
            if (data.selectedDeviceIds.length > 0) {
              await autoCreateBindings(equipment.id, data.selectedDeviceIds, data.type);
              await fetchEquipments();
            }
          }}
          onClose={() => setShowEquipmentForm(false)}
        />
      )}
    </div>
  );
}

function NoZonesState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
        <Home size={28} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">{t("home.welcome")}</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px]">
        {t("home.noZones")}
      </p>
    </div>
  );
}

function ZoneNotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Home size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">{t("home.zoneNotFound")}</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">
        {t("home.zoneDeleted")}
      </p>
      <button
        onClick={() => navigate("/home")}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
      >
        {t("home.backToHome")}
      </button>
    </div>
  );
}

function CollapsibleSection({
  title,
  storageKey,
  headerRight,
  children,
}: {
  title: string;
  storageKey: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === "collapsed"; } catch { return false; }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "collapsed" : "expanded"); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2">
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 group cursor-pointer"
        >
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`text-text-tertiary transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
          <h2 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wider group-hover:text-text transition-colors duration-150">
            {title}
          </h2>
        </button>
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </div>
      {!collapsed && children}
    </section>
  );
}

function MobileZoneDrawer({
  tree,
  currentZoneId,
  onSelect,
  onClose,
}: {
  tree: ZoneWithChildren[];
  currentZoneId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      {/* Drawer panel */}
      <div className="fixed inset-y-0 left-0 w-[280px] bg-surface border-r border-border shadow-lg animate-slide-left overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Home size={18} strokeWidth={1.5} className="text-primary" />
            <span className="text-[15px] font-semibold text-text">{t("nav.maison")}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <nav className="py-2">
          {tree.map((zone) => (
            <ZoneTreeItem
              key={zone.id}
              zone={zone}
              currentZoneId={currentZoneId}
              onSelect={onSelect}
              depth={0}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

function ZoneTreeItem({
  zone,
  currentZoneId,
  onSelect,
  depth,
}: {
  zone: ZoneWithChildren;
  currentZoneId: string | undefined;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const isActive = zone.id === currentZoneId;
  const hasChildren = zone.children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const Icon = hasChildren ? Layers : DoorOpen;

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          }
          onSelect(zone.id);
        }}
        className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors ${
          isActive
            ? "bg-primary/8 text-primary font-medium"
            : "text-text hover:bg-border-light"
        }`}
        style={{ paddingLeft: `${16 + depth * 16}px` }}
      >
        {hasChildren && (
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`text-text-tertiary transition-transform duration-200 flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
        )}
        {!hasChildren && <span className="w-[14px] flex-shrink-0" />}
        <Icon size={16} strokeWidth={1.5} className={isActive ? "text-primary" : "text-text-tertiary"} />
        <span className="text-[14px] truncate">{zone.name}</span>
      </button>
      {hasChildren && expanded && (
        <div>
          {zone.children.map((child) => (
            <ZoneTreeItem
              key={child.id}
              zone={child}
              currentZoneId={currentZoneId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function findZoneById(zones: ZoneWithChildren[], id: string): ZoneWithChildren | null {
  for (const zone of zones) {
    if (zone.id === id) return zone;
    const found = findZoneById(zone.children, id);
    if (found) return found;
  }
  return null;
}

function getFirstLeafZone(zones: ZoneWithChildren[]): ZoneWithChildren | null {
  if (zones.length === 0) return null;
  return zones[0];
}

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Home } from "lucide-react";
import { useZones } from "../store/useZones";
import { useEquipments } from "../store/useEquipments";
import { useZoneAggregation } from "../store/useZoneAggregation";
import { ZoneEquipmentsView } from "../components/home/ZoneEquipmentsView";
import { ZoneAggregationPills } from "../components/home/ZoneAggregationPills";
import { ZoneRecipesSection } from "../components/recipes/ZoneRecipesSection";
import type { ZoneWithChildren } from "../types";

export function HomePage() {
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
  const aggregationData = useZoneAggregation((s) => s.data);
  const fetchAggregation = useZoneAggregation((s) => s.fetchAggregation);

  useEffect(() => {
    fetchZones();
    fetchEquipments();
    fetchAggregation();
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
    <div className="p-6">
      {/* Zone header — title left, aggregation pills right */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-text leading-[28px]">
            {currentZone.name}
          </h1>
          {currentZone.description && (
            <p className="text-[13px] text-text-secondary mt-0.5">
              {currentZone.description}
            </p>
          )}
          <p className="text-[12px] text-text-tertiary mt-0.5">
            {zoneEquipments.length === 0
              ? t("equipments.noEquipments")
              : t("equipments.count", { count: zoneEquipments.length })}
          </p>
        </div>
        {zoneId && aggregationData[zoneId] && (
          <ZoneAggregationPills data={aggregationData[zoneId]} />
        )}
      </div>

      {/* Two-column layout: Equipments (left) + Recipes (right) */}
      <div className="flex flex-col lg:flex-row lg:gap-4 lg:items-start">
        <div className="flex-1 min-w-0 max-w-[720px]">
          <ZoneEquipmentsView
            zoneName={currentZone.name}
            equipments={zoneEquipments}
            onExecuteOrder={executeOrder}
          />
        </div>
        {zoneId && (
          <div className="mt-4 lg:mt-0 w-full lg:w-[380px] lg:flex-shrink-0">
            <ZoneRecipesSection zoneId={zoneId} zoneName={currentZone.name} />
          </div>
        )}
      </div>
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
  const first = zones[0];
  if (first.children.length > 0) {
    return first.children[0];
  }
  return first;
}

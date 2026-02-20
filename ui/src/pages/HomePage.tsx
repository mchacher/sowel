import { useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2, Home } from "lucide-react";
import { useZones } from "../store/useZones";
import { useEquipments } from "../store/useEquipments";
import { useZoneAggregation } from "../store/useZoneAggregation";
import { ZoneEquipmentsView } from "../components/home/ZoneEquipmentsView";
import { ZoneAggregationHeader } from "../components/home/ZoneAggregationHeader";
import type { ZoneWithChildren } from "../types";

export function HomePage() {
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
      {/* Zone header */}
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold text-text leading-[32px]">
          {currentZone.name}
        </h1>
        {currentZone.description && (
          <p className="text-[13px] text-text-secondary mt-0.5">
            {currentZone.description}
          </p>
        )}
        <p className="text-[13px] text-text-tertiary mt-0.5">
          {zoneEquipments.length === 0
            ? "No equipments"
            : `${zoneEquipments.length} equipment${zoneEquipments.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Aggregated zone data */}
      {zoneId && aggregationData[zoneId] && (
        <ZoneAggregationHeader data={aggregationData[zoneId]} />
      )}

      {/* Equipments grouped by type */}
      <ZoneEquipmentsView
        zoneName={currentZone.name}
        equipments={zoneEquipments}
        onExecuteOrder={executeOrder}
      />
    </div>
  );
}

function NoZonesState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-border-light flex items-center justify-center mb-4">
        <Home size={28} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">Welcome to Home</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px]">
        Create your first zone in Settings &gt; Home Topology to get started.
      </p>
    </div>
  );
}

function ZoneNotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Home size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">Zone not found</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">
        This zone may have been deleted.
      </p>
      <button
        onClick={() => navigate("/home")}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
      >
        Back to Home
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

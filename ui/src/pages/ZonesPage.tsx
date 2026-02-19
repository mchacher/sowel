import { useState, useEffect } from "react";
import { useZones } from "../store/useZones";
import { ZoneTree } from "../components/zones/ZoneTree";
import { ZoneForm, flattenZoneTree } from "../components/zones/ZoneForm";
import { Map, Loader2, Plus } from "lucide-react";

export function ZonesPage() {
  const tree = useZones((s) => s.tree);
  const loading = useZones((s) => s.loading);
  const error = useZones((s) => s.error);
  const fetchZones = useZones((s) => s.fetchZones);
  const createZone = useZones((s) => s.createZone);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  const zoneCount = countZones(tree);

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            Zones
          </h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            {zoneCount === 0
              ? "Define the topology of your home"
              : `${zoneCount} zone${zoneCount !== 1 ? "s" : ""}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
          >
            <Plus size={16} strokeWidth={1.5} />
            Add zone
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] bg-primary-light text-primary">
            <Map size={16} strokeWidth={1.5} />
            <span className="text-[13px] font-medium">{zoneCount}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <ZoneTree zones={tree} />
      )}

      {/* Create zone modal */}
      {showForm && (
        <ZoneForm
          title="Create zone"
          parentZones={flattenZoneTree(tree)}
          onSubmit={async (data) => {
            await createZone(data);
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function countZones(zones: { children?: { children?: unknown[] }[] }[]): number {
  let count = zones.length;
  for (const zone of zones) {
    if (zone.children) {
      count += countZones(zone.children as typeof zones);
    }
  }
  return count;
}

function ErrorState({ error }: { error: string }) {
  const fetchZones = useZones((s) => s.fetchZones);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Map size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">Failed to load zones</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">{error}</p>
      <button
        onClick={() => fetchZones()}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 ease-out"
      >
        Retry
      </button>
    </div>
  );
}

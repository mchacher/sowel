import { useState, useEffect } from "react";
import { useEquipments } from "../store/useEquipments";
import { useZones } from "../store/useZones";
import { EquipmentCard } from "../components/equipments/EquipmentCard";
import { EquipmentForm } from "../components/equipments/EquipmentForm";
import { Box, Loader2, Plus, Search, X } from "lucide-react";
import type { EquipmentWithDetails, ZoneWithChildren } from "../types";
import { getDevice } from "../api";
import { addDataBinding, addOrderBinding } from "../api";

export function EquipmentsPage() {
  const equipments = useEquipments((s) => s.equipments);
  const loading = useEquipments((s) => s.loading);
  const error = useEquipments((s) => s.error);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const createEquipment = useEquipments((s) => s.createEquipment);
  const executeOrder = useEquipments((s) => s.executeOrder);
  const tree = useZones((s) => s.tree);
  const fetchZones = useZones((s) => s.fetchZones);

  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchEquipments();
    fetchZones();
  }, [fetchEquipments, fetchZones]);

  const filtered = filter
    ? equipments.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : equipments;

  // Group by zone
  const byZone = groupByZone(filtered, tree);

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-text leading-[32px]">
            Equipments
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Filter */}
          {equipments.length > 0 && (
            <div className="relative">
              <Search size={14} strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                className="w-[180px] pl-8 pr-8 py-1.5 text-[13px] bg-surface border border-border rounded-[6px] outline-none placeholder:text-text-tertiary focus:border-primary transition-colors duration-150"
              />
              {filter && (
                <button onClick={() => setFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary">
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
          >
            <Plus size={16} strokeWidth={1.5} />
            Add equipment
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[6px] bg-primary-light text-primary">
            <Box size={16} strokeWidth={1.5} />
            <span className="text-[13px] font-medium">
              {filter ? `${filtered.length}/${equipments.length}` : equipments.length}
            </span>
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
      ) : equipments.length === 0 ? (
        <EmptyState onAdd={() => setShowForm(true)} />
      ) : (
        <div className="space-y-6">
          {byZone.map(({ zoneName, equipments: zoneEquipments }) => (
            <div key={zoneName}>
              <h3 className="text-[13px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {zoneName}
              </h3>
              <div className="space-y-1.5">
                {zoneEquipments.map((eq) => (
                  <EquipmentCard
                    key={eq.id}
                    equipment={eq}
                    onExecuteOrder={executeOrder}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create equipment modal */}
      {showForm && (
        <EquipmentForm
          title="Create equipment"
          zones={tree}
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

            // Auto-create bindings for selected devices
            if (data.selectedDeviceIds.length > 0) {
              await autoCreateBindings(equipment.id, data.selectedDeviceIds, data.type);
              await fetchEquipments();
            }
          }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

/** Auto-create DataBindings and OrderBindings for selected devices. */
async function autoCreateBindings(
  equipmentId: string,
  deviceIds: string[],
  equipmentType: string,
) {
  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);

      // Create DataBindings for matching categories
      for (const data of device.data) {
        if (isRelevantData(data.category, equipmentType)) {
          try {
            await addDataBinding(equipmentId, { deviceDataId: data.id, alias: data.key });
          } catch {
            // Alias conflict — skip (e.g., multi-device with same key)
          }
        }
      }

      // Create OrderBindings for matching orders
      for (const order of device.orders) {
        if (isRelevantOrder(order.key, equipmentType)) {
          try {
            await addOrderBinding(equipmentId, { deviceOrderId: order.id, alias: order.key });
          } catch {
            // Already bound — ok for multi-device
          }
        }
      }
    } catch {
      // Skip failed device
    }
  }
}

function isRelevantData(category: string, type: string): boolean {
  const map: Record<string, string[]> = {
    light_onoff: ["light_state"],
    light_dimmable: ["light_state", "light_brightness"],
    light_color: ["light_state", "light_brightness", "light_color", "light_color_temp"],
    shutter: ["shutter_position"],
    switch: ["light_state"],
  };
  return map[type]?.includes(category) ?? false;
}

function isRelevantOrder(key: string, type: string): boolean {
  const map: Record<string, string[]> = {
    light_onoff: ["state"],
    light_dimmable: ["state", "brightness"],
    light_color: ["state", "brightness", "color", "color_temp"],
    shutter: ["position", "state"],
    switch: ["state"],
  };
  return map[type]?.includes(key) ?? false;
}

function groupByZone(
  equipments: EquipmentWithDetails[],
  tree: ZoneWithChildren[],
): { zoneName: string; equipments: EquipmentWithDetails[] }[] {
  const zoneNames = new Map<string, string>();
  function walk(zones: ZoneWithChildren[]) {
    for (const z of zones) {
      zoneNames.set(z.id, z.name);
      walk(z.children);
    }
  }
  walk(tree);

  const groups = new Map<string, EquipmentWithDetails[]>();
  for (const eq of equipments) {
    const name = zoneNames.get(eq.zoneId) ?? "Unknown zone";
    const list = groups.get(name) ?? [];
    list.push(eq);
    groups.set(name, list);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([zoneName, eqs]) => ({ zoneName, equipments: eqs }));
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center mb-4">
        <Box size={28} strokeWidth={1.5} className="text-primary" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">No equipments yet</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">
        Equipments are the functional units in your home. Create your first equipment and bind it to a device.
      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 ease-out"
      >
        Create equipment
      </button>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-4">
        <Box size={28} strokeWidth={1.5} className="text-error" />
      </div>
      <h3 className="text-[16px] font-medium text-text mb-1">Failed to load equipments</h3>
      <p className="text-[13px] text-text-secondary max-w-[320px] mb-4">{error}</p>
      <button
        onClick={() => fetchEquipments()}
        className="px-4 py-2 bg-primary text-white text-[13px] font-medium rounded-[6px] hover:bg-primary-hover transition-colors duration-150 ease-out"
      >
        Retry
      </button>
    </div>
  );
}

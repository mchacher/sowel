import {
  Box,
  Lightbulb,
  ArrowUpDown,
  Gauge,
  ThermometerSun,
  Shield,
  MonitorSpeaker,
  ToggleRight,
} from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { CompactEquipmentCard } from "./CompactEquipmentCard";

interface EquipmentGroup {
  label: string;
  types: EquipmentType[];
  icon: React.ReactNode;
}

const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  { label: "Eclairages", types: ["light_onoff", "light_dimmable", "light_color"], icon: <Lightbulb size={14} strokeWidth={1.5} /> },
  { label: "Volets", types: ["shutter"], icon: <ArrowUpDown size={14} strokeWidth={1.5} /> },
  { label: "Capteurs", types: ["sensor", "motion_sensor", "contact_sensor"], icon: <Gauge size={14} strokeWidth={1.5} /> },
  { label: "Climat", types: ["thermostat"], icon: <ThermometerSun size={14} strokeWidth={1.5} /> },
  { label: "Securite", types: ["lock", "alarm"], icon: <Shield size={14} strokeWidth={1.5} /> },
  { label: "Multimedia", types: ["media_player", "camera"], icon: <MonitorSpeaker size={14} strokeWidth={1.5} /> },
  { label: "Autres", types: ["switch", "generic"], icon: <ToggleRight size={14} strokeWidth={1.5} /> },
];

interface ZoneEquipmentsViewProps {
  zoneName: string;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function ZoneEquipmentsView({
  zoneName,
  equipments,
  onExecuteOrder,
}: ZoneEquipmentsViewProps) {
  if (equipments.length === 0) {
    return <EmptyZone zoneName={zoneName} />;
  }

  // Group equipments by type category
  const grouped = EQUIPMENT_GROUPS.map((group) => ({
    ...group,
    equipments: equipments.filter((eq) => group.types.includes(eq.type)),
  })).filter((g) => g.equipments.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.label} className="rounded-[10px] border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border-light">
            <span className="text-text-tertiary">{group.icon}</span>
            <span className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider">
              {group.label}
            </span>
            <span className="text-[11px] text-text-tertiary ml-auto tabular-nums">
              {group.equipments.length}
            </span>
          </div>
          <div className="p-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {group.equipments.map((eq) => (
              <CompactEquipmentCard
                key={eq.id}
                equipment={eq}
                onExecuteOrder={onExecuteOrder}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyZone({ zoneName }: { zoneName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-border-light flex items-center justify-center mb-3">
        <Box size={24} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[15px] font-medium text-text mb-1">No equipments</h3>
      <p className="text-[13px] text-text-secondary max-w-[280px]">
        {zoneName} has no equipments yet. Add equipments in Settings &gt; Equipments.
      </p>
    </div>
  );
}

import { Box } from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { CompactEquipmentCard } from "./CompactEquipmentCard";

interface EquipmentGroup {
  label: string;
  types: EquipmentType[];
}

const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  { label: "Eclairages", types: ["light_onoff", "light_dimmable", "light_color"] },
  { label: "Volets", types: ["shutter"] },
  { label: "Capteurs", types: ["sensor", "motion_sensor", "contact_sensor"] },
  { label: "Climat", types: ["thermostat"] },
  { label: "Securite", types: ["lock", "alarm"] },
  { label: "Multimedia", types: ["media_player", "camera"] },
  { label: "Autres", types: ["switch", "generic"] },
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
    <div className="space-y-6">
      {grouped.map((group) => (
        <div key={group.label}>
          <h3 className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wider mb-2 px-1">
            {group.label}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
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

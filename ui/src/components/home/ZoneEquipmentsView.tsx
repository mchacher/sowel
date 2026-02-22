import {
  Box,
  Lightbulb,
  ArrowUpDown,
  Gauge,
  ToggleRight,
  AirVent,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { CompactEquipmentCard } from "./CompactEquipmentCard";

interface EquipmentGroup {
  labelKey: string;
  types: EquipmentType[];
  icon: React.ReactNode;
  headerBg: string;
  iconColor: string;
}

const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  { labelKey: "equipments.group.lights", types: ["light_onoff", "light_dimmable", "light_color"], icon: <Lightbulb size={14} strokeWidth={1.5} />, headerBg: "bg-amber-400/8", iconColor: "text-amber-500" },
  { labelKey: "equipments.group.shutters", types: ["shutter"], icon: <ArrowUpDown size={14} strokeWidth={1.5} />, headerBg: "bg-primary/6", iconColor: "text-primary" },
  { labelKey: "equipments.group.climate", types: ["thermostat"], icon: <AirVent size={14} strokeWidth={1.5} />, headerBg: "bg-blue-500/6", iconColor: "text-blue-500" },
  { labelKey: "equipments.group.sensors", types: ["sensor"], icon: <Gauge size={14} strokeWidth={1.5} />, headerBg: "bg-info/6", iconColor: "text-info" },
  { labelKey: "equipments.group.other", types: ["switch", "button"], icon: <ToggleRight size={14} strokeWidth={1.5} />, headerBg: "bg-text-tertiary/6", iconColor: "text-text-secondary" },
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
  const { t } = useTranslation();

  if (equipments.length === 0) {
    return <EmptyZone zoneName={zoneName} />;
  }

  // Group equipments by type category
  const grouped = EQUIPMENT_GROUPS.map((group) => ({
    ...group,
    equipments: equipments.filter((eq) => group.types.includes(eq.type)),
  })).filter((g) => g.equipments.length > 0);

  return (
    <div className="space-y-3">
      {grouped.map((group) => (
        <div key={group.labelKey} className="rounded-[10px] border border-border bg-surface overflow-hidden">
          <div className={`flex items-center gap-1.5 px-3 py-1 ${group.headerBg}`}>
            <span className={group.iconColor}>{group.icon}</span>
            <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              {t(group.labelKey)}
            </span>
            <span className="text-[11px] text-text-tertiary ml-auto tabular-nums">
              {group.equipments.length}
            </span>
          </div>
          <div className="divide-y divide-border-light">
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-border-light flex items-center justify-center mb-3">
        <Box size={24} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-[15px] font-medium text-text mb-1">{t("equipments.noEquipments")}</h3>
      <p className="text-[13px] text-text-secondary max-w-[280px]">
        {t("equipments.noEquipmentsMessage", { name: zoneName })}
      </p>
    </div>
  );
}

import {
  Box,
  CloudSun,
  Lightbulb,
  Gauge,
  ToggleRight,
  Thermometer,
  Zap,
  Tv,
  Monitor,
  WashingMachine,
  Waves,
} from "lucide-react";
import { ShutterClosedIcon } from "../icons/ShutterIcons";
import { WaterValveIcon } from "../icons/WaterValveIcon";
import { AwningIcon } from "../icons/AwningIcon";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { useTranslation } from "react-i18next";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { CompactEquipmentCard } from "./CompactEquipmentCard";

interface EquipmentGroup {
  labelKey: string;
  types: EquipmentType[];
  icon: React.ReactNode;
}

// Per-category cat-heads now use a uniform neutral chrome (design-system .cat-head, spec 100).
// No more per-group bg tint — the icon glyph alone conveys the category.
const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  { labelKey: "equipments.group.lights", types: ["light_onoff", "light_dimmable", "light_color"], icon: <Lightbulb size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.shutters", types: ["shutter"], icon: <ShutterClosedIcon size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.awnings", types: ["awning"], icon: <AwningIcon size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.climate", types: ["thermostat", "heater"], icon: <Thermometer size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.energy", types: ["energy_meter", "main_energy_meter", "energy_production_meter"], icon: <Zap size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.solar", types: ["solar_panel"], icon: <SolarPanelIcon size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.sensors", types: ["sensor"], icon: <Gauge size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.weather", types: ["weather", "weather_forecast"], icon: <CloudSun size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.media", types: ["media_player"], icon: <Tv size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.appliances", types: ["appliance"], icon: <WashingMachine size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.water", types: ["water_valve"], icon: <WaterValveIcon size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.pool", types: ["pool_pump", "pool_cover", "pool_heat_pump"], icon: <Waves size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.displays", types: ["display"], icon: <Monitor size={14} strokeWidth={1.5} /> },
  { labelKey: "equipments.group.other", types: ["switch", "button", "gate"], icon: <ToggleRight size={14} strokeWidth={1.5} /> },
];

interface ZoneEquipmentsViewProps {
  zoneName: string;
  equipments: EquipmentWithDetails[];
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onAdd?: () => void;
}

export function ZoneEquipmentsView({
  zoneName,
  equipments,
  onExecuteOrder,
  onAdd,
}: ZoneEquipmentsViewProps) {
  const { t } = useTranslation();

  if (equipments.length === 0) {
    return <EmptyZone zoneName={zoneName} onAdd={onAdd} />;
  }

  // Group equipments by type category
  const grouped = EQUIPMENT_GROUPS.map((group) => ({
    ...group,
    equipments: equipments.filter((eq) => group.types.includes(eq.type)),
  })).filter((g) => g.equipments.length > 0);

  return (
    <div>
      {grouped.map((group) => (
        <div key={group.labelKey}>
          {/* cat-head — strict design-system style: neutral grey, flush, no radius */}
          <div className="flex items-center gap-[0.55rem] px-[1.1rem] py-[0.4rem] min-h-[36px] bg-[var(--n-25)] border-t border-b border-border-light">
            <span className="text-text-tertiary opacity-70 flex-shrink-0">{group.icon}</span>
            <span className="text-[10.4px] font-semibold text-text-tertiary uppercase tracking-[0.14em]">
              {t(group.labelKey)}
            </span>
            <span className="text-[10.9px] text-text-tertiary opacity-65 ml-auto tabular-nums font-mono">
              {group.equipments.length}
            </span>
          </div>
          <div className="divide-y divide-border-light">
            {group.equipments.map((eq) => (
              <CompactEquipmentCard
                key={eq.id}
                equipment={eq}
                onExecuteOrder={onExecuteOrder}
                zoneName={zoneName}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyZone({ zoneName, onAdd }: { zoneName: string; onAdd?: () => void }) {
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
      {onAdd && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-primary rounded-[6px] hover:bg-primary-hover transition-colors duration-150"
        >
          {t("equipments.createEquipment")}
        </button>
      )}
    </div>
  );
}

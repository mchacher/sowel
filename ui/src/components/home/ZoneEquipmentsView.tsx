import {
  Box,
  CloudSun,
  DoorClosed,
  Lightbulb,
  Gauge,
  ToggleRight,
  Thermometer,
  Zap,
  Tv,
  Monitor,
  WashingMachine,
  Waves,
  Camera,
  Car,
  BatteryCharging,
  Fan,
} from "lucide-react";
import { ShutterClosedIcon } from "../icons/ShutterIcons";
import { WaterValveIcon } from "../icons/WaterValveIcon";
import { AwningIcon } from "../icons/AwningIcon";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { useTranslation } from "react-i18next";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { CompactEquipmentCard } from "./CompactEquipmentCard";
import { SliceHeader } from "./Panel";

interface EquipmentGroup {
  labelKey: string;
  types: EquipmentType[];
  icon: React.ReactNode;
}

// One neutral header per category (spec 196, slice 7c): the icon glyph alone
// conveys the category, no per-group tint.
const EQUIPMENT_GROUPS: EquipmentGroup[] = [
  {
    labelKey: "equipments.group.lights",
    types: ["light_onoff", "light_dimmable", "light_color"],
    icon: <Lightbulb size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.shutters",
    types: ["shutter"],
    icon: <ShutterClosedIcon size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.awnings",
    types: ["awning"],
    icon: <AwningIcon size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.doors",
    types: ["door"],
    icon: <DoorClosed size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.climate",
    types: ["thermostat", "heater"],
    icon: <Thermometer size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.energy",
    types: ["energy_meter", "main_energy_meter", "energy_production_meter"],
    icon: <Zap size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.solar",
    types: ["solar_panel"],
    icon: <SolarPanelIcon size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.sensors",
    types: ["sensor"],
    icon: <Gauge size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.weather",
    types: ["weather", "weather_forecast"],
    icon: <CloudSun size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.media",
    types: ["media_player"],
    icon: <Tv size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.appliances",
    types: ["appliance"],
    icon: <WashingMachine size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.water",
    types: ["water_valve", "water_heater"],
    icon: <WaterValveIcon size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.pool",
    types: ["pool_pump", "pool_cover", "pool_heat_pump"],
    icon: <Waves size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.ventilation",
    types: ["vmc"],
    icon: <Fan size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.displays",
    types: ["display"],
    icon: <Monitor size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.cameras",
    types: ["camera"],
    icon: <Camera size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.power",
    types: ["ups", "ev_charger"],
    icon: <BatteryCharging size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.vehicles",
    types: ["electric_vehicle"],
    icon: <Car size={16} strokeWidth={1.5} />,
  },
  {
    labelKey: "equipments.group.other",
    types: ["switch", "button", "gate"],
    icon: <ToggleRight size={16} strokeWidth={1.5} />,
  },
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

  // Each category is a slice of the panel body (spec 196, slice 7c): the
  // fragment's children are the direct children of the Panel's `slices`.
  return (
    <>
      {grouped.map((group) => (
        <div key={group.labelKey}>
          <SliceHeader
            icon={group.icon}
            label={t(group.labelKey)}
            count={group.equipments.length}
          />
          <div className="slice-rows">
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
    </>
  );
}

function EmptyZone({ zoneName, onAdd }: { zoneName: string; onAdd?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-border-light flex items-center justify-center mb-3">
        <Box size={24} strokeWidth={1.5} className="text-text-tertiary" />
      </div>
      <h3 className="text-lead font-medium text-text mb-1">{t("equipments.noEquipments")}</h3>
      <p className="text-small text-text-secondary max-w-[280px]">
        {t("equipments.noEquipmentsMessage", { name: zoneName })}
      </p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-small font-medium text-white bg-primary-fill rounded-sm hover:bg-primary-fill-hover transition-colors duration-150"
        >
          {t("equipments.createEquipment")}
        </button>
      )}
    </div>
  );
}

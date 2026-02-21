import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Lightbulb,
  SunDim,
  Palette,
  ArrowUpDown,
  Gauge,
  ToggleLeft,
  CircleDot,
} from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { LightControl } from "./LightControl";
import { SensorValues } from "./SensorValues";
import { ShutterControls } from "./ShutterControls";
import { useEquipmentState } from "./useEquipmentState";

const TYPE_ICONS: Record<EquipmentType, React.ReactNode> = {
  light_onoff: <Lightbulb size={18} strokeWidth={1.5} />,
  light_dimmable: <SunDim size={18} strokeWidth={1.5} />,
  light_color: <Palette size={18} strokeWidth={1.5} />,
  shutter: <ArrowUpDown size={18} strokeWidth={1.5} />,
  switch: <ToggleLeft size={18} strokeWidth={1.5} />,
  sensor: <Gauge size={18} strokeWidth={1.5} />,
  button: <CircleDot size={18} strokeWidth={1.5} />,
};

const TYPE_LABELS: Record<EquipmentType, string> = {
  light_onoff: "equipments.type.light_onoff",
  light_dimmable: "equipments.type.light_dimmable",
  light_color: "equipments.type.light_color",
  shutter: "equipments.type.shutter",
  switch: "equipments.type.switch",
  sensor: "equipments.type.sensor",
  button: "equipments.type.button",
};

interface EquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function EquipmentCard({ equipment, onExecuteOrder }: EquipmentCardProps) {
  const { t } = useTranslation();
  const {
    isLight,
    isShutter,
    isSensor,
    iconElement,
    iconColor,
    shutterPosition,
    hasShutterState,
    sensorBindings,
    batteryBinding,
    batteryLevel,
  } = useEquipmentState(equipment);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 bg-surface rounded-[10px] border
        transition-colors duration-150
        border-border
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-9 h-9 rounded-[6px] flex items-center justify-center
          ${iconColor}
        `}
      >
        {iconElement}
      </div>

      {/* Info */}
      <Link to={`/equipments/${equipment.id}`} className="flex-1 min-w-0 hover:opacity-80">
        <div className="text-[14px] font-medium text-text truncate">{equipment.name}</div>
        <div className="text-[12px] text-text-tertiary">
          {t(TYPE_LABELS[equipment.type])}
          {equipment.dataBindings.length === 0 && ` · ${t("equipments.noBindings")}`}
          {!equipment.enabled && ` · ${t("common.disabled")}`}
        </div>
      </Link>

      {/* Sensor / Button values */}
      {isSensor && (
        <SensorValues
          sensorBindings={sensorBindings}
          batteryBinding={batteryBinding}
          batteryLevel={batteryLevel}
        />
      )}

      {/* Light quick control */}
      {isLight && equipment.enabled && (
        <LightControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Shutter quick control */}
      {isShutter && equipment.enabled && (
        <ShutterControls
          shutterPosition={shutterPosition}
          hasShutterState={hasShutterState}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
        />
      )}
    </div>
  );
}

export { TYPE_ICONS, TYPE_LABELS };

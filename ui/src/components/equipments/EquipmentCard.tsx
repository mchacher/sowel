import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Lightbulb,
  SunDim,
  Palette,
  Gauge,
  ToggleLeft,
  CircleDot,
  Thermometer,
  CloudSun,
  DoorOpen,
  Heater,
  Zap,
} from "lucide-react";
import { ShutterClosedIcon } from "../icons/ShutterIcons";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { LightControl } from "./LightControl";
import { SensorValues } from "./SensorValues";
import { ShutterControl } from "./ShutterControl";
import { ThermostatCard } from "./ThermostatCard";
import { GateControl } from "./GateControl";
import { useEquipmentState } from "./useEquipmentState";

const TYPE_ICONS: Record<EquipmentType, React.ReactNode> = {
  light_onoff: <Lightbulb size={18} strokeWidth={1.5} />,
  light_dimmable: <SunDim size={18} strokeWidth={1.5} />,
  light_color: <Palette size={18} strokeWidth={1.5} />,
  shutter: <ShutterClosedIcon size={18} strokeWidth={1.5} />,
  switch: <ToggleLeft size={18} strokeWidth={1.5} />,
  sensor: <Gauge size={18} strokeWidth={1.5} />,
  button: <CircleDot size={18} strokeWidth={1.5} />,
  thermostat: <Thermometer size={18} strokeWidth={1.5} />,
  weather: <CloudSun size={18} strokeWidth={1.5} />,
  weather_forecast: <CloudSun size={18} strokeWidth={1.5} />,
  gate: <DoorOpen size={18} strokeWidth={1.5} />,
  heater: <Heater size={18} strokeWidth={1.5} />,
  energy_meter: <Zap size={18} strokeWidth={1.5} />,
  main_energy_meter: <Zap size={18} strokeWidth={1.5} />,
  energy_production_meter: <Zap size={18} strokeWidth={1.5} />,
};

const TYPE_LABELS: Record<EquipmentType, string> = {
  light_onoff: "equipments.type.light_onoff",
  light_dimmable: "equipments.type.light_dimmable",
  light_color: "equipments.type.light_color",
  shutter: "equipments.type.shutter",
  switch: "equipments.type.switch",
  sensor: "equipments.type.sensor",
  button: "equipments.type.button",
  thermostat: "equipments.type.thermostat",
  weather: "equipments.type.weather",
  weather_forecast: "equipments.type.weather_forecast",
  gate: "equipments.type.gate",
  heater: "equipments.type.heater",
  energy_meter: "equipments.type.energy_meter",
  main_energy_meter: "equipments.type.main_energy_meter",
  energy_production_meter: "equipments.type.energy_production_meter",
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
    isThermostat,
    isGate,
    iconElement,
    iconColor,
    sensorBindings,
    batteryBindings,
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
          batteryBindings={batteryBindings}
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
        <ShutterControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Thermostat quick control */}
      {isThermostat && equipment.enabled && (
        <ThermostatCard
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Gate quick control */}
      {isGate && equipment.enabled && (
        <GateControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}
    </div>
  );
}

export { TYPE_ICONS, TYPE_LABELS };

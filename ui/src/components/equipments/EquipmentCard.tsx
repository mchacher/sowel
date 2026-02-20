import { Link } from "react-router-dom";
import {
  Lightbulb,
  SunDim,
  Palette,
  ArrowUpDown,
  Thermometer,
  Lock,
  ShieldAlert,
  Gauge,
  Eye,
  DoorOpen,
  Speaker,
  Camera,
  ToggleLeft,
  Box,
} from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { LightControl } from "./LightControl";

const TYPE_ICONS: Record<EquipmentType, React.ReactNode> = {
  light_onoff: <Lightbulb size={18} strokeWidth={1.5} />,
  light_dimmable: <SunDim size={18} strokeWidth={1.5} />,
  light_color: <Palette size={18} strokeWidth={1.5} />,
  shutter: <ArrowUpDown size={18} strokeWidth={1.5} />,
  thermostat: <Thermometer size={18} strokeWidth={1.5} />,
  lock: <Lock size={18} strokeWidth={1.5} />,
  alarm: <ShieldAlert size={18} strokeWidth={1.5} />,
  sensor: <Gauge size={18} strokeWidth={1.5} />,
  motion_sensor: <Eye size={18} strokeWidth={1.5} />,
  contact_sensor: <DoorOpen size={18} strokeWidth={1.5} />,
  media_player: <Speaker size={18} strokeWidth={1.5} />,
  camera: <Camera size={18} strokeWidth={1.5} />,
  switch: <ToggleLeft size={18} strokeWidth={1.5} />,
  generic: <Box size={18} strokeWidth={1.5} />,
};

const TYPE_LABELS: Record<EquipmentType, string> = {
  light_onoff: "Light (On/Off)",
  light_dimmable: "Light (Dimmable)",
  light_color: "Light (Color)",
  shutter: "Shutter",
  thermostat: "Thermostat",
  lock: "Lock",
  alarm: "Alarm",
  sensor: "Sensor",
  motion_sensor: "Motion Sensor",
  contact_sensor: "Contact Sensor",
  media_player: "Media Player",
  camera: "Camera",
  switch: "Switch",
  generic: "Generic",
};

interface EquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function EquipmentCard({ equipment, onExecuteOrder }: EquipmentCardProps) {
  const isLight = equipment.type === "light_onoff" || equipment.type === "light_dimmable" || equipment.type === "light_color";
  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state"
  );
  const isOn = stateBinding
    ? stateBinding.value === true || stateBinding.value === "ON"
    : false;

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 bg-surface rounded-[10px] border
        transition-colors duration-150
        ${isOn ? "border-primary/30 bg-primary-light/20" : "border-border"}
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-9 h-9 rounded-[6px] flex items-center justify-center
          ${isOn ? "bg-primary/10 text-primary" : "bg-border-light text-text-tertiary"}
        `}
      >
        {TYPE_ICONS[equipment.type]}
      </div>

      {/* Info */}
      <Link to={`/equipments/${equipment.id}`} className="flex-1 min-w-0 hover:opacity-80">
        <div className="text-[14px] font-medium text-text truncate">{equipment.name}</div>
        <div className="text-[12px] text-text-tertiary">
          {TYPE_LABELS[equipment.type]}
          {equipment.dataBindings.length === 0 && " · No bindings"}
          {!equipment.enabled && " · Disabled"}
        </div>
      </Link>

      {/* Quick control */}
      {isLight && equipment.enabled && (
        <LightControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}
    </div>
  );
}

export { TYPE_ICONS, TYPE_LABELS };

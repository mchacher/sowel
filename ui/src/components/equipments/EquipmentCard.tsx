import { useState } from "react";
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
  ChevronUp,
  Square,
  ChevronDown,
} from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { LightControl } from "./LightControl";
import {
  getSensorIcon,
  getSensorIconColor,
  getSensorBindings,
  getBatteryBinding,
  getBatteryIcon,
  getBatteryColor,
  formatSensorValue,
  isBooleanSensorCategory,
  formatBooleanSensor,
} from "./sensorUtils";

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
  const [executing, setExecuting] = useState(false);

  const isLight = equipment.type === "light_onoff" || equipment.type === "light_dimmable" || equipment.type === "light_color";
  const isShutter = equipment.type === "shutter";
  const isSensor = equipment.type === "sensor" || equipment.type === "button";

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state"
  );
  const isOn = stateBinding
    ? stateBinding.value === true || stateBinding.value === "ON"
    : false;

  // Shutter-specific data
  const shutterPositionBinding = isShutter
    ? equipment.dataBindings.find((db) => db.category === "shutter_position")
    : null;
  const shutterPosition = shutterPositionBinding && typeof shutterPositionBinding.value === "number"
    ? shutterPositionBinding.value
    : null;
  const hasShutterState = isShutter && equipment.orderBindings.some((ob) => ob.alias === "state");
  const shutterIsOpen = shutterPosition !== null && shutterPosition > 0;

  // Dynamic icon for sensors
  const iconElement = isSensor
    ? getSensorIcon(equipment.dataBindings)
    : TYPE_ICONS[equipment.type];

  const iconColor = isSensor
    ? getSensorIconColor(equipment.dataBindings)
    : isShutter
      ? shutterIsOpen
        ? "bg-primary/10 text-primary"
        : "bg-border-light text-text-tertiary"
      : isLight && isOn
        ? "bg-amber-400/15 text-amber-500"
        : isOn
          ? "bg-primary/10 text-primary"
          : "bg-border-light text-text-tertiary";

  const handleShutterCommand = async (command: "OPEN" | "STOP" | "CLOSE", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (executing || !hasShutterState) return;
    setExecuting(true);
    try {
      await onExecuteOrder(equipment.id, "state", command);
    } finally {
      setExecuting(false);
    }
  };

  // Sensor bindings for inline values
  const sensorBindings = isSensor ? getSensorBindings(equipment.dataBindings) : [];
  const batteryBinding = isSensor ? getBatteryBinding(equipment.dataBindings) : null;
  const batteryLevel = batteryBinding && typeof batteryBinding.value === "number" ? batteryBinding.value : null;

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

      {/* Sensor values */}
      {isSensor && sensorBindings.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {sensorBindings.map((b) => (
            <span key={b.id} className="text-[13px] tabular-nums">
              {isBooleanSensorCategory(b.category) ? (
                <span
                  className={`
                    font-medium px-2 py-0.5 rounded-full text-[11px]
                    ${isBooleanActive(b.category, b.value)
                      ? "bg-amber-400/15 text-amber-500"
                      : "bg-border-light text-text-tertiary"
                    }
                  `}
                >
                  {formatBooleanSensor(b.category, b.value, t)}
                </span>
              ) : (
                <span className="text-text-secondary">
                  {formatSensorValue(b.value, b.unit, t)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Battery indicator for sensors */}
      {isSensor && batteryBinding && (
        <span className={`flex items-center gap-0.5 flex-shrink-0 ${getBatteryColor(batteryLevel)}`} title={`${t("sensors.battery")} : ${batteryLevel ?? "?"}%`}>
          {getBatteryIcon(batteryLevel, 14, 1.5)}
          <span className="text-[11px] tabular-nums">{batteryLevel !== null ? `${batteryLevel}%` : "?"}</span>
        </span>
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
        <div
          className="flex items-center gap-2 flex-shrink-0"
          onClick={(e) => e.preventDefault()}
        >
          {shutterPosition !== null && (
            <span className="text-[13px] text-text-secondary tabular-nums text-right">
              {shutterPosition === 0 ? t("controls.closed") : shutterPosition === 100 ? t("controls.opened") : `${shutterPosition}%`}
            </span>
          )}
          {hasShutterState && (
            <>
              <div className="w-px h-5 bg-border" />
              <button
                onClick={(e) => handleShutterCommand("OPEN", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("controls.open")}
              >
                <ChevronUp size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={(e) => handleShutterCommand("STOP", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("controls.stop")}
              >
                <Square size={10} strokeWidth={2} />
              </button>
              <button
                onClick={(e) => handleShutterCommand("CLOSE", e)}
                disabled={executing}
                className="p-1.5 rounded-[5px] transition-colors duration-150 cursor-pointer bg-border-light text-text-tertiary hover:bg-border hover:text-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("controls.close")}
              >
                <ChevronDown size={14} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function isBooleanActive(category: string, value: unknown): boolean {
  if (category === "contact_door" || category === "contact_window") {
    return value === false || value === "OFF";
  }
  return value === true || value === "ON";
}

export { TYPE_ICONS, TYPE_LABELS };

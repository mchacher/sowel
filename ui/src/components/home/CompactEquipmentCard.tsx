import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { LightControl } from "../equipments/LightControl";
import { ShutterControl } from "../equipments/ShutterControl";
import { ThermostatCard } from "../equipments/ThermostatCard";
import { GateControl } from "../equipments/GateControl";

interface CompactEquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  zoneName?: string;
}

export function CompactEquipmentCard({ equipment, onExecuteOrder, zoneName }: CompactEquipmentCardProps) {
  const { t } = useTranslation();

  const {
    isLight,
    isShutter,
    isSensor,
    isThermostat,
    isGate,
    stateBinding,
    isOn,
    sensorBindings,
    batteryBindings,
    iconElement,
    iconColor,
  } = useEquipmentState(equipment);

  // Find primary data value for non-light, non-sensor, non-shutter, non-thermostat, non-gate equipments
  const primaryBinding = !isLight && !isSensor && !isShutter && !isThermostat && !isGate
    ? equipment.dataBindings[0] ?? null
    : null;

  return (
    <div
      className={`
        flex items-center gap-2.5 px-3 py-2
        transition-colors duration-150
        hover:bg-border-light/40
      `}
    >
      {/* Icon */}
      <div
        className={`
          flex-shrink-0 w-7 h-7 rounded-[5px] flex items-center justify-center
          ${iconColor}
        `}
      >
        {iconElement}
      </div>

      {/* Name — links to detail */}
      <Link
        to={`/equipments/${equipment.id}`}
        state={zoneName ? { fromZone: zoneName } : undefined}
        className="flex-1 min-w-0 text-[13px] font-medium text-text truncate hover:text-primary transition-colors"
      >
        {equipment.name}
      </Link>

      {/* Sensor / Button values */}
      {isSensor && (
        <SensorValues
          sensorBindings={
            equipment.type === "weather"
              ? sensorBindings
                  .filter((b) =>
                    b.key === "temperature" || b.key === "sum_rain_24" || b.key === "wind_strength"
                  )
                  .map((b) =>
                    b.key === "sum_rain_24" ? { ...b, unit: "mm/24h" } : b
                  )
              : sensorBindings
          }
          batteryBindings={equipment.type === "weather" ? [] : batteryBindings}
        />
      )}

      {/* Primary value for other equipments */}
      {primaryBinding && !isLight && !isSensor && !isShutter && !isThermostat && !isGate && (
        <span className="text-[13px] text-text-secondary tabular-nums flex-shrink-0">
          {formatValue(primaryBinding.value, primaryBinding.unit)}
        </span>
      )}

      {/* Light controls */}
      {isLight && equipment.enabled && (
        <LightControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Shutter controls */}
      {isShutter && equipment.enabled && (
        <ShutterControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Thermostat controls */}
      {isThermostat && equipment.enabled && (
        <ThermostatCard
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Gate controls */}
      {isGate && equipment.enabled && (
        <GateControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Boolean state badge for non-light, non-sensor, non-shutter, non-gate equipments */}
      {!isLight && !isSensor && !isShutter && !isThermostat && !isGate && stateBinding && (
        <span
          className={`
            text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0
            ${isOn
              ? "bg-success/10 text-success"
              : "bg-border-light text-text-tertiary"
            }
          `}
        >
          {isOn ? t("common.on") : t("common.off")}
        </span>
      )}
    </div>
  );
}

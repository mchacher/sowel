import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EquipmentWithDetails } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { LightControl } from "../equipments/LightControl";
import { ShutterControl } from "../equipments/ShutterControl";
import { ThermostatCard } from "../equipments/ThermostatCard";
import { GateControl } from "../equipments/GateControl";
import { HeaterControl } from "../equipments/HeaterControl";
import { Cloud, Timer } from "lucide-react";
import { parseForecastDays, CONDITION_ICONS, CONDITION_COLORS } from "../equipments/weatherForecastUtils";

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
    isEnergyMeter,
    isThermostat,
    isHeater,
    isGate,
    isWeatherForecast,
    isMediaPlayer,
    isAppliance,
    stateBinding,
    isOn,
    sensorBindings,
    batteryBindings,
    iconElement,
    iconColor,
  } = useEquipmentState(equipment);

  // Find primary data value for generic equipments
  const isKnownType = isLight || isSensor || isShutter || isThermostat || isHeater || isGate || isEnergyMeter || isWeatherForecast || isMediaPlayer || isAppliance;
  const primaryBinding = !isKnownType
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

      {/* Weather forecast compact */}
      {isWeatherForecast && <CompactForecast equipment={equipment} />}

      {/* Energy meter values */}
      {isEnergyMeter && <CompactEnergyValues equipment={equipment} />}

      {/* Media player compact */}
      {isMediaPlayer && <CompactMediaPlayer equipment={equipment} />}

      {/* Appliance compact */}
      {isAppliance && <CompactAppliance equipment={equipment} />}

      {/* Primary value for other equipments */}
      {primaryBinding && !isKnownType && (
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

      {/* Heater controls */}
      {isHeater && equipment.enabled && (
        <HeaterControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Boolean state badge for generic equipments */}
      {!isKnownType && stateBinding && (
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

function CompactForecast({ equipment }: { equipment: EquipmentWithDetails }) {
  const days = parseForecastDays(equipment.dataBindings);
  if (days.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {days.slice(0, 5).map((day) => {
        const ConditionIcon = day.condition ? CONDITION_ICONS[day.condition] ?? Cloud : Cloud;
        const color = day.condition ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary") : "text-text-tertiary";
        return (
          <div key={day.dayIndex} className="flex items-center gap-0.5">
            <ConditionIcon size={14} strokeWidth={1.5} className={color} />
            {day.tempMax !== null && (
              <span className="text-[11px] font-mono tabular-nums text-text-secondary">
                {Math.round(day.tempMax)}°
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompactEnergyValues({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const computed = equipment.computedData ?? [];
  const energyDay = computed.find((c) => c.alias === "energy_day");
  const demandBinding = equipment.dataBindings.find((b) => b.alias === "demand_5min");
  const demandW = typeof demandBinding?.value === "number" ? demandBinding.value : null;

  const dayWh = typeof energyDay?.value === "number" ? energyDay.value : null;

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      {demandW !== null && (
        <span className="text-[13px] text-text-secondary tabular-nums font-mono">
          {demandW >= 1000 ? (demandW / 1000).toFixed(1) : Math.round(demandW)}
          <span className="text-[11px] text-text-tertiary ml-0.5">{demandW >= 1000 ? "kW" : "W"}</span>
        </span>
      )}
      {dayWh !== null && (
        <span className="text-[13px] text-accent tabular-nums font-mono font-semibold">
          {dayWh >= 1000 ? (dayWh / 1000).toFixed(2) : Math.round(dayWh)}
          <span className="text-[11px] font-normal text-text-tertiary ml-0.5">
            {dayWh >= 1000 ? "kWh" : "Wh"} {t("energy.today").toLowerCase()}
          </span>
        </span>
      )}
    </div>
  );
}

function CompactMediaPlayer({ equipment }: { equipment: EquipmentWithDetails }) {
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const sourceBinding = equipment.dataBindings.find((b) => b.alias === "input_source");

  const isOn = powerBinding?.value === true;
  const source = typeof sourceBinding?.value === "string" ? sourceBinding.value : null;

  if (!isOn) {
    return <span className="text-[11px] text-text-tertiary flex-shrink-0">OFF</span>;
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {source && (
        <span className="text-[12px] text-text-secondary font-medium">{source}</span>
      )}
    </div>
  );
}

function CompactAppliance({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
  const remainingBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time_str");
  const progressBinding = equipment.dataBindings.find((b) => b.alias === "progress");

  const isOn = powerBinding?.value === true;
  const state = typeof stateBinding?.value === "string" ? stateBinding.value : null;
  const remainingStr = typeof remainingBinding?.value === "string" ? remainingBinding.value : null;
  const progress = typeof progressBinding?.value === "number" ? progressBinding.value : null;

  if (!isOn || state === "off") {
    return <span className="text-[11px] text-text-tertiary flex-shrink-0">OFF</span>;
  }

  const isRunning = state === "running";

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
        isRunning ? "bg-accent/10 text-accent" : "bg-border-light text-text-tertiary"
      }`}>
        {state === "running" ? t("common.running") : state === "paused" ? t("common.paused") : state ?? "—"}
      </span>
      {isRunning && remainingStr && (
        <span className="flex items-center gap-0.5 text-[11px] text-text-secondary tabular-nums">
          <Timer size={10} />
          {remainingStr}
        </span>
      )}
      {isRunning && progress !== null && progress > 0 && (
        <span className="text-[10px] text-text-tertiary tabular-nums">{progress}%</span>
      )}
    </div>
  );
}

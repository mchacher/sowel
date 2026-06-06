import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { LightControl } from "../equipments/LightControl";
import { ShutterControl } from "../equipments/ShutterControl";
import { ThermostatCard } from "../equipments/ThermostatCard";
import { GateControl } from "../equipments/GateControl";
import { HeaterControl } from "../equipments/HeaterControl";
import { WaterValveControl } from "../equipments/WaterValveControl";
import { PoolHeatPumpControl } from "../equipments/PoolHeatPumpControl";
import { Cloud, Timer } from "lucide-react";
import { parseForecastDays, CONDITION_ICONS, CONDITION_COLORS } from "../equipments/weatherForecastUtils";
import { syntheticBindingFromComputed } from "../equipments/weather-utils";
import { EquipmentStatusBadge } from "../equipments/EquipmentStatusBadge";
import type { DataBindingWithValue } from "../../types";

interface CompactEquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  zoneName?: string;
}

// Per-type icon tint mapping (spec 099 — eq-row category tints).
// Light-on state is handled as an override at render time.
type Tint = { bg: string; text: string };

const TYPE_TINTS: Record<EquipmentType, Tint> = {
  light_onoff:             { bg: "bg-light-50",     text: "text-light-500" },
  light_dimmable:          { bg: "bg-light-50",     text: "text-light-500" },
  light_color:             { bg: "bg-light-50",     text: "text-light-500" },
  shutter:                 { bg: "bg-shutter-50",   text: "text-shutter-500" },
  // Awning uses the Sowel primary-light backdrop — the V3 illustration is
  // already colored (primary blue + primary light) and harmonises with it.
  awning:                  { bg: "bg-primary-light",text: "text-primary" },
  pool_cover:              { bg: "bg-shutter-50",   text: "text-shutter-500" },
  sensor:                  { bg: "bg-sensor-50",    text: "text-sensor-500" },
  button:                  { bg: "bg-sensor-50",    text: "text-sensor-500" },
  switch:                  { bg: "bg-sensor-50",    text: "text-sensor-500" },
  media_player:            { bg: "bg-media-50",     text: "text-media-500" },
  thermostat:              { bg: "bg-primary-light",text: "text-primary" },
  water_valve:             { bg: "bg-primary-light",text: "text-primary" },
  weather:                 { bg: "bg-primary-light",text: "text-primary" },
  weather_forecast:        { bg: "bg-primary-light",text: "text-primary" },
  pool_pump:               { bg: "bg-primary-light",text: "text-primary" },
  gate:                    { bg: "bg-success/10",   text: "text-success" },
  energy_production_meter: { bg: "bg-success/10",   text: "text-success" },
  solar_panel:             { bg: "bg-primary-light",  text: "text-primary" },
  heater:                  { bg: "bg-error/10",     text: "text-error" },
  pool_heat_pump:          { bg: "bg-error/10",     text: "text-error" },
  energy_meter:            { bg: "bg-accent-light", text: "text-accent" },
  main_energy_meter:       { bg: "bg-accent-light", text: "text-accent" },
  appliance:               { bg: "bg-border-light", text: "text-text-secondary" },
  // Spec 120 — displays use the muted "info-only" tint, matching sensors.
  display:                 { bg: "bg-sensor-50",    text: "text-sensor-500" },
};

export function CompactEquipmentCard({ equipment, onExecuteOrder, zoneName }: CompactEquipmentCardProps) {
  const { t } = useTranslation();

  const {
    isLight,
    isShutterFamily,
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
  } = useEquipmentState(equipment);

  const isWaterValve = equipment.type === "water_valve";
  const isPoolPump = equipment.type === "pool_pump";
  const isPoolCover = equipment.type === "pool_cover";
  const isPoolHeatPump = equipment.type === "pool_heat_pump";
  const isSolar = equipment.type === "solar_panel";

  // Find primary data value for generic equipments
  const isKnownType =
    isLight || isSensor || isShutterFamily || isThermostat || isHeater || isGate ||
    isEnergyMeter || isWeatherForecast || isMediaPlayer || isAppliance ||
    isWaterValve || isPoolPump || isPoolCover || isPoolHeatPump || isSolar;

  // Solar panel: show the produced DC power (W/kW) as the headline value.
  const solarPowerW = isSolar
    ? (() => {
        const p = equipment.dataBindings.find((b) => b.category === "power");
        return typeof p?.value === "number" ? p.value : null;
      })()
    : null;
  const primaryBinding = !isKnownType
    ? equipment.dataBindings[0] ?? null
    : null;

  // Icon tinting — light-on overrides to amber + glow, everything else uses TYPE_TINTS.
  const isLightOn = isLight && isOn;
  const baseTint = TYPE_TINTS[equipment.type] ?? { bg: "bg-border-light", text: "text-text-tertiary" };
  const iconBg = isLightOn ? "bg-accent" : baseTint.bg;
  const iconText = isLightOn ? "text-white" : baseTint.text;
  const iconAnimation = isLightOn ? "animate-glow" : "";

  // Spec 116: when the equipment is fully offline, render a minimal row —
  // just icon (muted) + name + badge — instead of stale controls + values.
  if (equipment.status === "offline") {
    return (
      <div className="grid grid-cols-[32px_1fr_auto] gap-[0.85rem] items-center px-[1.1rem] py-[0.55rem] min-h-[52px] transition-colors duration-150 hover:bg-border-light/40">
        <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 opacity-55 ${baseTint.bg} ${baseTint.text}`}>
          {iconElement}
        </div>
        <Link
          to={`/equipments/${equipment.id}`}
          state={zoneName ? { fromZone: zoneName } : undefined}
          className="min-w-0 text-[14px] font-medium text-text truncate hover:text-primary transition-colors"
        >
          {equipment.name}
        </Link>
        <EquipmentStatusBadge status="offline" reason={equipment.statusReason} size="sm" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[32px_1fr_auto] gap-[0.85rem] items-center px-[1.1rem] py-[0.55rem] min-h-[52px] transition-colors duration-150 hover:bg-border-light/40">
      {/* Slot 1: Icon */}
      <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${iconBg} ${iconText} ${iconAnimation}`}>
        {iconElement}
      </div>

      {/* Slot 2: Name (+ degraded badge inline, spec 116) */}
      <div className="min-w-0 flex items-center gap-2">
        <Link
          to={`/equipments/${equipment.id}`}
          state={zoneName ? { fromZone: zoneName } : undefined}
          className="min-w-0 text-[14px] font-medium text-text truncate hover:text-primary transition-colors"
        >
          {equipment.name}
        </Link>
        {equipment.status === "degraded" && (
          <EquipmentStatusBadge
            status="degraded"
            reason={equipment.statusReason}
            size="sm"
            iconOnly
          />
        )}
      </div>

      {/* Slots 3-5: per-type content. Grid auto columns collapse when unused. */}

      {/* Sensor / Button values — wrapped in a single grid cell to keep the row layout intact */}
      {isSensor && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <SensorValues
            sensorBindings={
              equipment.type === "weather"
                ? buildWeatherCompactBindings(equipment, sensorBindings)
                : sensorBindings
            }
            batteryBindings={equipment.type === "weather" ? [] : batteryBindings}
          />
        </div>
      )}

      {/* Weather forecast compact */}
      {isWeatherForecast && <CompactForecast equipment={equipment} />}

      {/* Energy meter values */}
      {isEnergyMeter && <CompactEnergyValues equipment={equipment} />}

      {/* Solar panel — produced power (green) */}
      {isSolar && (
        <span className="text-[13px] font-semibold text-success tabular-nums flex-shrink-0 font-mono">
          {solarPowerW === null
            ? "—"
            : solarPowerW >= 1000
              ? `${(solarPowerW / 1000).toFixed(2)} kW`
              : `${Math.round(solarPowerW)} W`}
        </span>
      )}

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

      {/* Shutter / Awning controls (shared compact control with awning vocabulary swap) */}
      {isShutterFamily && equipment.enabled && (
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

      {/* Water valve controls */}
      {isWaterValve && equipment.enabled && (
        <WaterValveControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Pool pump: runtime badge + ON/OFF toggle (reuse LightControl compact).
       * Wrapped in a single flex cell so the two children share the row's
       * auto-sized grid column (otherwise the toggle wraps to a second line). */}
      {isPoolPump && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <PoolPumpRuntime equipment={equipment} />
          {equipment.enabled && (
            <LightControl
              equipment={equipment}
              onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
              compact
            />
          )}
        </div>
      )}

      {/* Pool cover: OPEN/STOP/CLOSE buttons + position slider (reuse ShutterControl compact) */}
      {isPoolCover && equipment.enabled && (
        <ShutterControl
          equipment={equipment}
          onExecuteOrder={(alias, value) => onExecuteOrder(equipment.id, alias, value)}
          compact
        />
      )}

      {/* Pool heat pump: water temp + mode badge + setpoint controls */}
      {isPoolHeatPump && (
        <PoolHeatPumpControl
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

/**
 * Build the 4-value summary shown on a weather equipment row in the zone view:
 * temperature, humidity, 24h rain, wind strength — in that exact order.
 *
 * Falls back to `computedData.rain_24h` when the cumulative `sum_rain_24`
 * binding isn't attached (typical of the Netatmo plugin which auto-binds only
 * the bare `rain` device-side).
 */
function buildWeatherCompactBindings(
  equipment: EquipmentWithDetails,
  sensorBindings: DataBindingWithValue[],
): DataBindingWithValue[] {
  const byKey = (key: string) => sensorBindings.find((b) => b.key === key);
  const temp = byKey("temperature");
  const hum = byKey("humidity");
  const wind = byKey("wind_strength");

  // Annotate the rain row with "mm/24h" so the zone-row reading is unambiguous
  // (otherwise a bare "0 mm" looks like an instantaneous reading).
  const rainBindingFromData = byKey("sum_rain_24");
  const rainComputed = equipment.computedData?.find((c) => c.alias === "rain_24h");
  const rainBase = rainBindingFromData
    ?? (rainComputed
      ? syntheticBindingFromComputed(equipment.id, rainComputed, { key: "sum_rain_24" })
      : undefined);
  const rain = rainBase ? { ...rainBase, unit: "mm/24h" } : null;

  return [temp, hum, rain, wind].filter((b): b is DataBindingWithValue => !!b);
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
  const isProduction = equipment.type === "energy_production_meter";
  const valueColor = isProduction ? "text-success" : "text-accent";

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      {demandW !== null && (
        <span className="text-[13px] text-text-secondary tabular-nums font-mono">
          {demandW >= 1000 ? (demandW / 1000).toFixed(1) : Math.round(demandW)}
          <span className="text-[11px] text-text-tertiary ml-0.5">{demandW >= 1000 ? "kW" : "W"}</span>
        </span>
      )}
      {dayWh !== null && (
        <span className={`text-[13px] ${valueColor} tabular-nums font-mono font-semibold`}>
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

function PoolPumpRuntime({ equipment }: { equipment: EquipmentWithDetails }) {
  const runtime = equipment.computedData?.find((c) => c.alias === "runtime_daily");
  const seconds = typeof runtime?.value === "number" ? runtime.value : 0;
  if (seconds === 0) return null;
  const runtimeStr = seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
  return (
    <span className="text-[11px] text-text-tertiary tabular-nums font-mono flex-shrink-0">
      {runtimeStr}
    </span>
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

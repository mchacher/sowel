import { useTranslation } from "react-i18next";
import {
  formatRuntime,
  isOnBattery,
  upsSeverityOf,
  upsStatusKey,
  upsStatusOf,
} from "../equipments/upsStatus";
import { Camera } from "lucide-react";
import type { EquipmentType, EquipmentWithDetails } from "../../types";
import { useCameraSnapshot } from "../../hooks/useCameraSnapshot";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { SensorValues } from "../equipments/SensorValues";
import { LightControl } from "../equipments/LightControl";
import { SolarControl } from "../equipments/SolarControl";
import { findMainOnOffOrder } from "../equipments/bindingUtils";
import { ShutterControl, ShutterStatePill } from "../equipments/ShutterControl";
import { ThermostatCard, ThermostatInsideTemp } from "../equipments/ThermostatCard";
import { GateControl, GateStateBadge } from "../equipments/GateControl";
import { TimedCommandControl, TimedCountdownPill } from "../equipments/TimedCommandControl";
import { HeaterControl, HeaterModeBadge } from "../equipments/HeaterControl";
import { WaterValveControl, WaterValveFlow } from "../equipments/WaterValveControl";
import { VmcControl } from "../equipments/VmcControl";
import { EvVehicleBadge } from "../equipments/EvChargerControl";
import { evChargerStateOf } from "../equipments/evChargerState";
import { electricVehicleStateOf, evChargingStateKey } from "../equipments/electricVehicleState";
import {
  PoolHeatPumpControl,
  PoolHeatPumpModeBadge,
  PoolHeatPumpWaterTemp,
} from "../equipments/PoolHeatPumpControl";
import { Cloud, Timer } from "lucide-react";
import {
  parseForecastDays,
  CONDITION_ICONS,
  CONDITION_COLORS,
} from "../equipments/weatherForecastUtils";
import { syntheticBindingFromComputed } from "../equipments/weather-utils";
import { EquipmentStatusBadge } from "../equipments/EquipmentStatusBadge";
import { equipmentLinkState } from "../../lib/equipment-origin";
import { hasRowStateIcon, rowStateOf } from "./row-state-icon";
import { EquipmentRow, RowControls, RowName, RowReadings, RowSpacer } from "./equipment-row-layout";
import { pickLivePowerBinding, formatWatts } from "../../lib/energy-meter-display";
import { resolvePowerReading } from "../../lib/power-reading";
import { formatRelative } from "../../lib/format-relative";
import { useStalenessClock } from "../../hooks/useStalenessClock";
import type { DataBindingWithValue } from "../../types";
import {
  formatDuration,
  formatEnergyParts,
  formatNumber,
  formatPercent,
  formatPower,
  formatTemperature,
  formatWithUnit,
} from "../../lib/format";

interface CompactEquipmentCardProps {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  zoneName?: string;
}

// Per-type icon tint mapping (spec 099 — eq-row category tints).
// Light-on state is handled as an override at render time.
type Tint = { bg: string; text: string };

const TYPE_TINTS: Record<EquipmentType, Tint> = {
  // A light off is neutral: amber appears only while it is on (spec 196).
  light_onoff: { bg: "bg-border-light", text: "text-text-tertiary" },
  light_dimmable: { bg: "bg-border-light", text: "text-text-tertiary" },
  light_color: { bg: "bg-border-light", text: "text-text-tertiary" },
  shutter: { bg: "bg-shutter-50", text: "text-shutter-500" },
  // Awning uses the Sowel primary-light backdrop — the V3 illustration is
  // already colored (primary blue + primary light) and harmonises with it.
  awning: { bg: "bg-primary-light", text: "text-primary" },
  pool_cover: { bg: "bg-shutter-50", text: "text-shutter-500" },
  door: { bg: "bg-shutter-50", text: "text-shutter-500" },
  sensor: { bg: "bg-sensor-50", text: "text-sensor-500" },
  button: { bg: "bg-sensor-50", text: "text-sensor-500" },
  switch: { bg: "bg-sensor-50", text: "text-sensor-500" },
  media_player: { bg: "bg-media-50", text: "text-media-500" },
  thermostat: { bg: "bg-primary-light", text: "text-primary" },
  water_valve: { bg: "bg-primary-light", text: "text-primary" },
  weather: { bg: "bg-primary-light", text: "text-primary" },
  weather_forecast: { bg: "bg-primary-light", text: "text-primary" },
  pool_pump: { bg: "bg-primary-light", text: "text-primary" },
  gate: { bg: "bg-shutter-50", text: "text-shutter-500" },
  energy_production_meter: { bg: "bg-success/10", text: "text-success" },
  solar_panel: { bg: "bg-primary-light", text: "text-primary" },
  heater: { bg: "bg-heat/10", text: "text-heat" },
  water_heater: { bg: "bg-primary-light", text: "text-primary" },
  pool_heat_pump: { bg: "bg-heat/10", text: "text-heat" },
  energy_meter: { bg: "bg-primary-light", text: "text-primary" },
  main_energy_meter: { bg: "bg-primary-light", text: "text-primary" },
  appliance: { bg: "bg-border-light", text: "text-text-secondary" },
  // Spec 120 — displays use the muted "info-only" tint, matching sensors.
  display: { bg: "bg-sensor-50", text: "text-sensor-500" },
  // Spec 133 — cameras use the same muted "info-only" tint.
  camera: { bg: "bg-sensor-50", text: "text-sensor-500" },
  // Spec 153 — VMC uses the primary-light backdrop (air/comfort).
  vmc: { bg: "bg-primary-light", text: "text-primary" },
  // Spec 156 — a UPS is infrastructure, not an actuator: the muted
  // "info-only" tint, like sensors and displays. Its own status badge carries
  // the alarm colour, so the tile itself stays quiet.
  ups: { bg: "bg-sensor-50", text: "text-sensor-500" },
  ev_charger: { bg: "bg-primary-light", text: "text-primary" },
  electric_vehicle: { bg: "bg-primary-light", text: "text-primary" },
};

export function CompactEquipmentCard({
  equipment,
  onExecuteOrder,
  zoneName,
}: CompactEquipmentCardProps) {
  const { t } = useTranslation();

  const {
    isLight,
    isSwitch,
    isWaterHeater,
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
    batteryAlert,
    iconElement,
  } = useEquipmentState(equipment);

  const isWaterValve = equipment.type === "water_valve";
  const isPoolPump = equipment.type === "pool_pump";
  const isPoolCover = equipment.type === "pool_cover";
  const isPoolHeatPump = equipment.type === "pool_heat_pump";
  const isSolar = equipment.type === "solar_panel";
  const isCamera = equipment.type === "camera";
  const isVmc = equipment.type === "vmc";
  const isUps = equipment.type === "ups";
  const isEvCharger = equipment.type === "ev_charger";
  const isElectricVehicle = equipment.type === "electric_vehicle";

  // Find primary data value for generic equipments
  const isKnownType =
    isLight ||
    isSwitch ||
    isWaterHeater ||
    isSensor ||
    isShutterFamily ||
    isThermostat ||
    isHeater ||
    isGate ||
    isEnergyMeter ||
    isWeatherForecast ||
    isMediaPlayer ||
    isAppliance ||
    isWaterValve ||
    isPoolPump ||
    isPoolCover ||
    isPoolHeatPump ||
    isSolar ||
    isCamera ||
    isVmc ||
    isUps ||
    isEvCharger ||
    isElectricVehicle;

  const hasCameraSnapshot =
    isCamera && equipment.dataBindings.some((b) => b.category === "camera_snapshot_url");

  // Solar panel: show the produced DC power (W/kW) as the headline value.
  // #839 — judged for freshness, so a silent inverter stops reading as 0 W.
  const powerReading = resolvePowerReading(
    equipment,
    equipment.dataBindings.find((b) => b.category === "power"),
  );
  const solarPowerW = isSolar ? powerReading.watts : null;

  // Metering switch (spec 129): a smart plug that reports power shows it live
  // next to the on/off toggle. A bare relay has no power binding → null.
  // Same binding, same verdict as the solar headline above: one scan serves
  // both, they only differ in which type renders it.
  const switchPowerW = isSwitch || isWaterHeater ? powerReading.watts : null;
  const switchPowerStale =
    (isSwitch || isWaterHeater) && powerReading.verdict === "stale" ? powerReading.since : null;
  // Water heater (spec 135): optional water temperature next to the toggle.
  const waterHeaterTempC = isWaterHeater
    ? (() => {
        const p = equipment.dataBindings.find((b) => b.alias === "water_temperature");
        return typeof p?.value === "number" ? p.value : null;
      })()
    : null;
  // Metering water heater (#521): day energy from computedData, shown next to
  // the live power like an automatic energy meter. Null when not submetered.
  const waterHeaterDayWh = isWaterHeater
    ? (() => {
        const e = equipment.computedData?.find((c) => c.alias === "energy_day");
        return typeof e?.value === "number" ? e.value : null;
      })()
    : null;
  const primaryBinding = !isKnownType ? (equipment.dataBindings[0] ?? null) : null;

  // Icon tinting — light-on overrides to amber + glow, everything else uses TYPE_TINTS.
  const isLightOn = isLight && isOn;
  const baseTint = TYPE_TINTS[equipment.type] ?? {
    bg: "bg-border-light",
    text: "text-text-tertiary",
  };
  const iconBg = isLightOn ? "bg-active" : baseTint.bg;
  const iconText = isLightOn ? "text-on-active" : baseTint.text;
  const iconAnimation = isLightOn ? "animate-glow" : "";

  const linkTo = `/equipments/${equipment.id}`;
  const linkState = zoneName
    ? equipmentLinkState(zoneName, `/home/${equipment.zoneId}`)
    : undefined;
  const execFor = (alias: string, value: unknown) => onExecuteOrder(equipment.id, alias, value);

  // Spec 116: when the equipment is fully offline, render a minimal row —
  // just icon (muted) + name + badge — instead of stale controls + values.
  if (equipment.status === "offline") {
    return (
      <EquipmentRow>
        <div
          className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 opacity-55 ${baseTint.bg} ${baseTint.text}`}
        >
          {iconElement}
        </div>
        <RowName to={linkTo} state={linkState} name={equipment.name} />
        <RowSpacer />
        {/* Above the stretched link, so its tooltip (spec 116) can be hovered */}
        <span className="relative flex flex-shrink-0 ml-2">
          <EquipmentStatusBadge status="offline" reason={equipment.statusReason} size="sm" />
        </span>
      </EquipmentRow>
    );
  }

  // #1163 — every piece right of the name is a reading or a control. Readings
  // give way first (`RowReadings`), and a row without a live control keeps its
  // first one; controls never go (`RowControls`): the name wraps.
  const rowState = hasRowStateIcon(equipment) ? rowStateOf(equipment, t) : null;
  const sensorValues =
    equipment.type === "weather"
      ? buildWeatherCompactBindings(equipment, sensorBindings)
      : sensorBindings;

  return (
    <EquipmentRow>
      {/* Icon — a shutter, awning, pool cover, door or gate draws its state in
          it, named for screen readers (#1163): on a phone it is the only place
          that state shows. */}
      <div
        className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${iconBg} ${iconText} ${iconAnimation}`}
        data-row-state={rowState ? rowState.label : undefined}
        role={rowState ? "img" : undefined}
        aria-label={rowState?.label}
        title={rowState?.label}
      >
        {rowState?.icon ?? iconElement}
      </div>

      {/* Name (+ degraded badge inline, spec 116) — the row's one link */}
      <RowName
        to={linkTo}
        state={linkState}
        name={equipment.name}
        badge={
          equipment.status === "degraded" && (
            <EquipmentStatusBadge
              status="degraded"
              reason={equipment.statusReason}
              size="sm"
              iconOnly
            />
          )
        }
      />
      <RowSpacer />

      {/* Sensor / Button values: the first value (and a battery alert) stay,
          the others give way — a weather station keeps its temperature. */}
      {isSensor && (
        <RowReadings>
          <SensorValues
            sensorBindings={sensorValues.slice(0, 1)}
            batteryBindings={equipment.type === "weather" ? [] : batteryBindings}
            batteryAlert={equipment.type === "weather" ? null : batteryAlert}
          />
          {sensorValues.slice(1).map((b) => (
            <SensorValues key={b.id} sensorBindings={[b]} batteryBindings={[]} />
          ))}
        </RowReadings>
      )}

      {/* Weather forecast: today stays, the next days give way from the last */}
      {isWeatherForecast && <CompactForecast equipment={equipment} />}

      {/* Energy meter values */}
      {isEnergyMeter && <CompactEnergyValues equipment={equipment} />}

      {/* Solar panel — produced power (green); the age of a stale one gives way */}
      {isSolar && (
        <RowReadings>
          <span
            className={`text-small font-semibold tabular-nums ${
              solarPowerW === null ? "text-text-tertiary" : "text-success"
            }`}
          >
            {formatPower(solarPowerW)}
          </span>
          {powerReading.verdict === "stale" && (
            <span className="text-micro text-text-tertiary">
              {formatRelative(powerReading.since, t)}
            </span>
          )}
        </RowReadings>
      )}

      {/* UPS compact (spec 156) — the state, then how much runway is left.
       * Those two answer the only question a glance at a zone asks of a UPS. */}
      {isUps && <CompactUps equipment={equipment} />}

      {/* Camera compact — snapshot thumbnail, blob-fetched (an <img src>
       * can't carry the Authorization header the media-proxy route needs). */}
      {isCamera && hasCameraSnapshot && (
        <RowReadings>
          <CompactCameraThumbnail equipmentId={equipment.id} />
        </RowReadings>
      )}

      {/* Media player compact */}
      {isMediaPlayer && (
        <RowReadings>
          <CompactMediaPlayer equipment={equipment} />
        </RowReadings>
      )}

      {/* Appliance compact */}
      {isAppliance && <CompactAppliance equipment={equipment} />}

      {/* Primary value and boolean state badge for other equipments */}
      {!isKnownType && (
        <RowReadings gap="3">
          {primaryBinding && (
            <span className="text-small text-text-secondary tabular-nums">
              {formatValue(primaryBinding.value, primaryBinding.unit)}
            </span>
          )}
          {stateBinding && (
            <span
              className={`
                text-micro font-medium px-2 py-0.5 rounded-full
                ${isOn ? "bg-success/10 text-success" : "bg-border-light text-text-tertiary"}
              `}
            >
              {isOn ? t("common.on") : t("common.off")}
            </span>
          )}
        </RowReadings>
      )}

      {/* Light / switch controls (smart plug = ON/OFF relay, same surface).
       * Metering plug (spec 129): live power next to the toggle, which gives
       * way before the toggle does. */}
      {(isLight || isSwitch || isWaterHeater) && equipment.enabled && (
        <>
          <RowReadings>
            {waterHeaterTempC !== null && (
              <span className="text-small font-semibold text-text-secondary tabular-nums">
                {formatTemperature(waterHeaterTempC, { style: "compact" })}
              </span>
            )}
            {switchPowerW !== null && (
              <span className="text-small font-semibold text-text tabular-nums">
                {formatPower(switchPowerW)}
              </span>
            )}
            {/* The age inline says the number is gone on purpose (#839). */}
            {switchPowerStale && (
              <span className="flex items-baseline gap-1">
                <span className="text-small font-medium text-text-tertiary tabular-nums">—</span>
                <span className="text-micro text-text-tertiary">
                  {formatRelative(switchPowerStale, t)}
                </span>
              </span>
            )}
            {waterHeaterDayWh !== null && (
              <span className="text-small text-text tabular-nums font-semibold">
                {formatEnergyParts(waterHeaterDayWh / 1000, { unit: "auto" }).value}
                <span className="text-micro font-normal text-text-tertiary ml-0.5">
                  {formatEnergyParts(waterHeaterDayWh / 1000, { unit: "auto" }).unit}
                </span>
              </span>
            )}
          </RowReadings>
          <RowControls>
            {/* Main on/off — hidden when only a solar channel is bound (e.g. a
                water heater on permanent mains, spec 152), so no dead toggle.
                Uses the same resolver as LightControl so the gate never hides a
                toggle the control would still render. */}
            {!!findMainOnOffOrder(equipment.orderBindings) && (
              <LightControl equipment={equipment} onExecuteOrder={execFor} compact />
            )}
            {/* Spec 152 — dedicated solar on/off (same toggle, sun glyph). Renders
                nothing when no solar command is bound. */}
            <SolarControl equipment={equipment} onExecuteOrder={execFor} compact />
          </RowControls>
        </>
      )}

      {/* Shutter / Awning / Pool cover: the state pill gives way, the buttons
          (and the slider, from sm) stay. */}
      {(isShutterFamily || isPoolCover) && equipment.enabled && (
        <>
          <RowReadings fromSm={!rowState?.keepPill}>
            <ShutterStatePill equipment={equipment} />
          </RowReadings>
          <RowControls>
            <ShutterControl
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Thermostat: the room temperature gives way, setpoint and power stay */}
      {isThermostat && equipment.enabled && (
        <>
          <RowReadings>
            <ThermostatInsideTemp equipment={equipment} />
          </RowReadings>
          <RowControls>
            <ThermostatCard
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Gate: the state pill gives way, the command stays */}
      {isGate && equipment.enabled && (
        <>
          <RowReadings fromSm>
            <GateStateBadge equipment={equipment} />
          </RowReadings>
          <RowControls>
            <GateControl
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Heater: the Confort / Éco pill gives way; the toggle shows it too */}
      {isHeater && equipment.enabled && (
        <>
          <RowReadings>
            <HeaterModeBadge equipment={equipment} />
          </RowReadings>
          <RowControls>
            <HeaterControl
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Water valve: the flow gives way, the toggle stays */}
      {isWaterValve && equipment.enabled && (
        <>
          <RowReadings>
            <WaterValveFlow equipment={equipment} />
          </RowReadings>
          <RowControls>
            <WaterValveControl
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Electric vehicle (spec 183): battery, range, state, report age. */}
      {isElectricVehicle && <CompactElectricVehicle equipment={equipment} />}

      {/* EV charger (spec 182): the vehicle, the power while charging, start/stop. */}
      {isEvCharger && <CompactEvCharger equipment={equipment} onExecuteOrder={execFor} />}

      {/* VMC: OFF/V1/V2 speed selector (spec 153) */}
      {isVmc && equipment.enabled && (
        <RowControls>
          <VmcControl equipment={equipment} onExecuteOrder={execFor} compact />
        </RowControls>
      )}

      {/* Pool pump: the day's runtime gives way, the ON/OFF toggle stays
       * (reuse LightControl compact). */}
      {isPoolPump && (
        <>
          <RowReadings>
            <PoolPumpRuntime equipment={equipment} />
          </RowReadings>
          {equipment.enabled && (
            <RowControls>
              <LightControl equipment={equipment} onExecuteOrder={execFor} compact />
            </RowControls>
          )}
        </>
      )}

      {/* Pool heat pump: water temperature and mode give way, the setpoint stays */}
      {isPoolHeatPump && (
        <>
          <RowReadings>
            <PoolHeatPumpWaterTemp equipment={equipment} />
            <PoolHeatPumpModeBadge equipment={equipment} />
          </RowReadings>
          <RowControls>
            <PoolHeatPumpControl
              equipment={equipment}
              onExecuteOrder={execFor}
              compact
              withReadings={false}
            />
          </RowControls>
        </>
      )}

      {/* Timed command (spec 174 phase 2) — renders nothing unless the
          equipment was configured for one, so every other row is unchanged.
          The countdown gives way, the button stays. */}
      {equipment.timedCommand && equipment.enabled && (
        <>
          <RowReadings trailing>
            <TimedCountdownPill equipment={equipment} />
          </RowReadings>
          <RowControls>
            <TimedCommandControl equipment={equipment} withReadings={false} />
          </RowControls>
        </>
      )}
    </EquipmentRow>
  );
}

/**
 * Build the 4-value summary shown on a weather equipment row in the zone view:
 * temperature, humidity, 24h rain, wind strength — in that exact order.
 *
 * Falls back to `computedData.rain_24h` when the cumulative `sum_rain_24`
 * binding isn't attached (an equipment bound before its plugin published it).
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
  const rainBase =
    rainBindingFromData ??
    (rainComputed
      ? syntheticBindingFromComputed(equipment.id, rainComputed, { key: "sum_rain_24" })
      : undefined);
  const rain = rainBase ? { ...rainBase, unit: "mm/24h" } : null;

  return [temp, hum, rain, wind].filter((b): b is DataBindingWithValue => !!b);
}

/**
 * Up to five days. The first stays; the next ones give way from the last, so a
 * narrow row shows fewer days rather than a cut name (#1163).
 */
function CompactForecast({ equipment }: { equipment: EquipmentWithDetails }) {
  const days = parseForecastDays(equipment.dataBindings).slice(0, 5);
  if (days.length === 0) return null;

  return (
    <RowReadings>
      {days.map((day) => (
        <ForecastDay key={day.dayIndex} day={day} />
      ))}
    </RowReadings>
  );
}

function ForecastDay({ day }: { day: ReturnType<typeof parseForecastDays>[number] }) {
  const ConditionIcon = day.condition ? (CONDITION_ICONS[day.condition] ?? Cloud) : Cloud;
  const color = day.condition
    ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";
  return (
    <div data-forecast-day={day.dayIndex} className="flex items-center gap-0.5">
      <ConditionIcon size={14} strokeWidth={1.5} className={color} />
      {day.tempMax !== null && (
        <span className="text-micro tabular-nums text-text-secondary">
          {formatNumber(day.tempMax, { decimals: 0 })}°
        </span>
      )}
    </div>
  );
}

function CompactEnergyValues({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const computed = equipment.computedData ?? [];
  const energyDay = computed.find((c) => c.alias === "energy_day");
  // Live instantaneous power (issue #376), from the `power` binding. Updated
  // live via the WS store.
  const liveReading = resolvePowerReading(equipment, pickLivePowerBinding(equipment.dataBindings));
  const liveW = liveReading.watts;

  const dayWh = typeof energyDay?.value === "number" ? energyDay.value : null;
  const isProduction = equipment.type === "energy_production_meter";
  const valueColor = isProduction ? "text-success" : "text-text";
  const powerColor = isProduction ? "text-success" : "text-text-secondary";

  // The live power (or the age of a withheld one) first, the day total next.
  const items = [
    liveW !== null && (
      <span key="live" className={`text-small font-semibold ${powerColor} tabular-nums`}>
        {formatWatts(liveW).value}
        <span className="text-micro font-normal text-text-tertiary ml-0.5">
          {formatWatts(liveW).unit}
        </span>
      </span>
    ),
    liveReading.verdict === "stale" && (
      <span key="stale" className="text-small font-medium text-text-tertiary tabular-nums">
        —<span className="text-micro font-normal ml-1">{formatRelative(liveReading.since, t)}</span>
      </span>
    ),
    dayWh !== null && (
      <span key="day" className={`text-small ${valueColor} tabular-nums font-semibold`}>
        {formatEnergyParts(dayWh / 1000, { unit: "auto" }).value}
        <span className="text-micro font-normal text-text-tertiary ml-0.5">
          {formatEnergyParts(dayWh / 1000, { unit: "auto" }).unit}
        </span>
      </span>
    ),
  ].filter(Boolean);

  return <RowReadings gap="3">{items}</RowReadings>;
}

function CompactMediaPlayer({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const sourceBinding = equipment.dataBindings.find((b) => b.alias === "input_source");

  const isOn = powerBinding?.value === true;
  const source = typeof sourceBinding?.value === "string" ? sourceBinding.value : null;

  if (!isOn) {
    return <span className="text-micro text-text-tertiary flex-shrink-0">{t("controls.off")}</span>;
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {source && <span className="text-caption text-text-secondary font-medium">{source}</span>}
    </div>
  );
}

const COMPACT_SNAPSHOT_REFRESH_MS = 60_000;

/** Small snapshot thumbnail for the zone row, refreshed less often than the
 * equipment detail page's own view since many rows may be visible at once. */
function CompactCameraThumbnail({ equipmentId }: { equipmentId: string }) {
  const { url } = useCameraSnapshot(equipmentId, true, COMPACT_SNAPSHOT_REFRESH_MS);

  return (
    <div className="w-11 h-8 rounded-sm bg-black/80 overflow-hidden flex items-center justify-center flex-shrink-0">
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <Camera size={14} strokeWidth={1.5} className="text-white/40" />
      )}
    </div>
  );
}

function PoolPumpRuntime({ equipment }: { equipment: EquipmentWithDetails }) {
  const runtime = equipment.computedData?.find((c) => c.alias === "runtime_daily");
  const seconds = typeof runtime?.value === "number" ? runtime.value : 0;
  if (seconds === 0) return null;
  const runtimeStr = formatDuration(seconds);
  return (
    <span className="text-micro text-text-tertiary tabular-nums flex-shrink-0">{runtimeStr}</span>
  );
}

/**
 * Electric vehicle compact row (spec 183) — the battery level first (the only
 * number a glance at a car needs), the range, the charging state, and the age
 * of the car's own report when it is old: a sleeping car reports nothing.
 */
function CompactElectricVehicle({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const now = useStalenessClock();
  const s = electricVehicleStateOf(equipment, now);
  // In the order the comment above gives, which is also the reverse of the
  // order they give way in: the battery level stays, the report age goes
  // first (#1163).
  const items = [
    s.batteryLevel !== null && (
      <span key="battery" className="text-small font-semibold text-text tabular-nums">
        {formatPercent(s.batteryLevel)}
      </span>
    ),
    s.rangeKm !== null && (
      <span key="range" className="text-micro text-text-secondary tabular-nums">
        {formatWithUnit(s.rangeKm, "km")}
      </span>
    ),
    s.chargingState && (
      <span
        key="state"
        className="text-micro font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
      >
        {t(evChargingStateKey(s.chargingState))}
      </span>
    ),
    s.reportStale && s.reportedAt && (
      <span key="age" className="text-micro text-text-tertiary">
        {t("reading.ago", { age: formatRelative(s.reportedAt, t) })}
      </span>
    ),
  ].filter(Boolean);
  return <RowReadings>{items}</RowReadings>;
}

/**
 * EV charger compact row (spec 182) — the vehicle badge, the live power only
 * while it is worth reading (energy actually flowing), and the start/stop
 * toggle when the order is bound.
 */
function CompactEvCharger({
  equipment,
  onExecuteOrder,
}: {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}) {
  const s = evChargerStateOf(equipment);
  const watts = s.power.watts;

  const items = [
    s.vehicle && <EvVehicleBadge key="vehicle" vehicle={s.vehicle} />,
    watts !== null && watts > 0 && (
      <span key="power" className="text-small font-semibold text-text tabular-nums">
        {formatPower(watts)}
      </span>
    ),
  ].filter(Boolean);
  // With the start/stop toggle, every reading gives way to it; without one,
  // the row has no live control and keeps the vehicle.
  return (
    <>
      <RowReadings>{items}</RowReadings>
      {s.canToggle && equipment.enabled && (
        <RowControls>
          <LightControl equipment={equipment} onExecuteOrder={onExecuteOrder} compact />
        </RowControls>
      )}
    </>
  );
}

/**
 * UPS compact row (spec 156) — status pill + battery, and the remaining
 * autonomy only while the mains is gone. On mains, "3312 s of autonomy" is
 * noise; on battery it is the only number that matters.
 */
function CompactUps({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();
  const { status, raw } = upsStatusOf(equipment);
  const severity = upsSeverityOf(status);

  const charge = equipment.dataBindings.find((b) => b.category === "battery")?.value;
  const runtime = equipment.dataBindings.find((b) => b.category === "battery_runtime")?.value;
  const runtimeLabel = isOnBattery(status) ? formatRuntime(runtime) : null;

  const pill =
    severity === "ok"
      ? "bg-success/10 text-success"
      : severity === "warning"
        ? "bg-warning/10 text-warning-ink"
        : severity === "error"
          ? "bg-error/10 text-error"
          : "bg-border-light text-text-tertiary";

  const items = [
    <span key="status" className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${pill}`}>
      {status ? t(upsStatusKey(status)) : (raw ?? t(upsStatusKey(null)))}
    </span>,
    charge !== null && charge !== undefined && (
      <span key="charge" className="text-micro text-text-secondary tabular-nums">
        {formatPercent(Number(charge))}
      </span>
    ),
    runtimeLabel && (
      <span
        key="runtime"
        className="flex items-center gap-0.5 text-micro text-text-secondary tabular-nums"
      >
        <Timer size={10} />
        {runtimeLabel}
      </span>
    ),
  ].filter(Boolean);
  return <RowReadings>{items}</RowReadings>;
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
    return (
      <RowReadings>
        <span className="text-micro text-text-tertiary">{t("controls.off")}</span>
      </RowReadings>
    );
  }

  const isRunning = state === "running";
  const items = [
    <span
      key="state"
      className={`text-micro font-medium px-1.5 py-0.5 rounded-full ${
        isRunning ? "bg-active-bg text-active-ink" : "bg-border-light text-text-tertiary"
      }`}
    >
      {state === "running"
        ? t("common.running")
        : state === "paused"
          ? t("common.paused")
          : (state ?? "—")}
    </span>,
    isRunning && remainingStr && (
      <span
        key="remaining"
        className="flex items-center gap-0.5 text-micro text-text-secondary tabular-nums"
      >
        <Timer size={10} />
        {remainingStr}
      </span>
    ),
    isRunning && progress !== null && progress > 0 && (
      <span key="progress" className="text-micro text-text-tertiary tabular-nums">
        {formatPercent(progress)}
      </span>
    ),
  ].filter(Boolean);
  return <RowReadings>{items}</RowReadings>;
}

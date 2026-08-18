import { createElement } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";
import { useEquipmentState } from "../equipments/useEquipmentState";
import {
  getSensorBindings,
  formatSensorValue,
  formatBooleanSensor,
  isBooleanSensorCategory,
} from "../equipments/sensorUtils";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  AwningWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  GateWidgetIcon,
  HeaterWidgetIcon,
  WaterHeaterIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  PoolCoverIcon,
  WaterValveWidgetIcon,
  EnergyMeterIcon,
} from "./WidgetIcons";
import { resolveWidgetPresentation } from "./presentation/resolveWidgetPresentation";
import { CUSTOM_ICON_REGISTRY, shutterLevel } from "./widget-icons";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { solarWidgetState } from "./solarWidget";
import {
  parseForecastDays,
  CONDITION_ICONS,
  CONDITION_COLORS,
} from "../equipments/weatherForecastUtils";
import { findTempExtremes, findTempIndoor, findTempOutdoor } from "../equipments/weather-utils";
import { TempExtremes } from "../TempExtremes";
import { Cloud, WashingMachine, Camera, ShieldCheck, Fan } from "lucide-react";
import { gateNeedsConfirm } from "./gate-confirm";
import { vmcSpeedOf } from "../equipments/vmcSpeed";

interface MobileWidgetCardProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  /** Zone qualifier (spec 139), set only when a homonym shares the dashboard. */
  equipmentZone?: string;
  onClick?: () => void;
  editMode?: boolean;
}

export function MobileWidgetCard({
  widget,
  equipment,
  equipmentZone,
  onClick,
  editMode,
}: MobileWidgetCardProps) {
  const { t } = useTranslation();
  const label = widget.label || equipment.name;
  // Two half-width columns on a phone: joining the zone to the title would cut
  // it off exactly where it starts to disambiguate. Own line, quieter.
  const zone = widget.label ? undefined : equipmentZone;
  const { icon, stateLines } = useMobileState(widget, equipment, t);
  // Spec 146 — a guarded gate shows a tiny shield so it reads as protected.
  const guarded = !editMode && gateNeedsConfirm(equipment);

  return (
    <button
      onClick={onClick}
      className={`relative bg-surface border border-border rounded-[8px] p-2 flex flex-col items-center h-[120px] overflow-hidden w-full text-left ${
        editMode ? "" : "cursor-pointer active:scale-[0.98]"
      } transition-transform`}
    >
      {guarded && (
        <ShieldCheck
          size={11}
          strokeWidth={2}
          className="absolute top-1.5 right-1.5 text-text-tertiary/70"
          aria-label={t("controls.gate.confirmProtected")}
        />
      )}

      {/* Label */}
      <span
        className={`text-[12px] font-semibold text-text truncate w-full text-center ${
          editMode ? "pl-5 pr-8" : ""
        }`}
      >
        {label}
      </span>
      {zone && (
        <span className="text-[10px] text-text-tertiary truncate w-full text-center leading-tight">
          {zone}
        </span>
      )}

      {/* Icon */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className="scale-50 origin-center">{icon}</div>
      </div>

      {/* State summary */}
      {stateLines.length > 0 && (
        <span className="text-[11px] text-text-secondary truncate max-w-full">
          {stateLines.join(" · ")}
        </span>
      )}
    </button>
  );
}

function useMobileState(
  widget: DashboardWidget,
  equipment: EquipmentWithDetails,
  t: TFunction,
): { icon: React.ReactNode; stateLines: string[] } {
  const {
    isLight,
    isShutter,
    isAwning,
    isThermostat,
    isGate,
    isHeater,
    isSensor,
    isWeatherForecast,
    isEnergyMeter,
    isAppliance,
    isWaterValve,
    isPoolCover,
    isPoolHeatPump,
    isOn,
  } = useEquipmentState(equipment);

  // Spec 149 — migrated types read the presentation descriptor; a null
  // descriptor falls through to the legacy per-type branches below.
  const presentation = resolveWidgetPresentation(widget, equipment, t);
  if (presentation) {
    return {
      icon: presentation.icon({ surface: "mobile-card" }),
      stateLines: [presentation.state.primary, ...(presentation.state.secondary ?? [])],
    };
  }

  // Custom icon from registry
  const customEntry = widget.icon ? CUSTOM_ICON_REGISTRY[widget.icon] : undefined;

  if (isLight) {
    const brightness = equipment.dataBindings.find(
      (b) => b.alias === "brightness" || b.category === "light_brightness",
    );
    const pct =
      brightness && typeof brightness.value === "number"
        ? Math.round((brightness.value / 254) * 100)
        : null;
    const isDimmable = equipment.type === "light_dimmable" || equipment.type === "light_color";
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <LightBulbIcon on={isOn} />
      ),
      stateLines: [isDimmable && pct !== null ? `${pct}%` : isOn ? "ON" : "OFF"],
    };
  }

  if (isShutter) {
    const pos = equipment.dataBindings.find((b) => b.category === "shutter_position");
    const position = pos && typeof pos.value === "number" ? pos.value : null;
    const level = position !== null ? shutterLevel(position) : null;
    const text =
      position === 100
        ? t("controls.opened")
        : position === 0
          ? t("controls.closed")
          : position !== null
            ? `${position}%`
            : null;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <ShutterWidgetIcon level={level} />
      ),
      stateLines: text ? [text] : [],
    };
  }

  if (isAwning) {
    const pos = equipment.dataBindings.find((b) => b.category === "shutter_position");
    const position = pos && typeof pos.value === "number" ? pos.value : null;
    const text =
      position === 100
        ? t("controls.deployed")
        : position === 0
          ? t("controls.retracted")
          : position !== null
            ? `${position}%`
            : null;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <AwningWidgetIcon deployed={position !== null && position > 0} />
      ),
      stateLines: text ? [text] : [],
    };
  }

  if (isThermostat || isPoolHeatPump) {
    const temp = equipment.dataBindings.find((b) => b.alias === "temperature");
    const computedTemp = isPoolHeatPump
      ? equipment.computedData?.find((c) => c.alias === "effective_water_temperature")
      : null;
    const setpoint = equipment.dataBindings.find((b) => b.alias === "setpoint");
    const tempVal =
      isPoolHeatPump && typeof computedTemp?.value === "number"
        ? computedTemp.value
        : typeof temp?.value === "number"
          ? temp.value
          : null;
    const spVal = typeof setpoint?.value === "number" ? setpoint.value : null;
    const minBound = isPoolHeatPump ? 10 : 16;
    const level = spVal !== null ? (spVal - minBound) / (30 - minBound) : undefined;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <ThermometerIcon warm={isOn} level={level} />
      ),
      stateLines: tempVal !== null ? [`${tempVal.toFixed(1)}°C`] : [],
    };
  }

  if (isGate) {
    const stateBinding = equipment.dataBindings.find(
      (b) => b.alias === "state" && b.category === "gate_state",
    );
    const gateState = (stateBinding?.value as string) ?? "unknown";
    const isOpen = gateState === "open";
    const iconKey = widget.icon;
    const GateIcon =
      iconKey === "sliding_gate"
        ? SlidingGateIcon
        : iconKey === "garage_door"
          ? GarageDoorIcon
          : GateWidgetIcon;
    return {
      icon: <GateIcon open={isOpen} />,
      stateLines: [t(`controls.gate.${gateState}`)],
    };
  }

  if (isHeater) {
    const stateBinding = equipment.dataBindings.find(
      (b) => b.alias === "state" || b.category === "light_state",
    );
    const relayOn = stateBinding
      ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
      : false;
    const isComfort = !relayOn;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <HeaterWidgetIcon comfort={isComfort} />
      ),
      stateLines: [isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")],
    };
  }

  if (equipment.type === "weather") {
    const outdoor = findTempOutdoor(equipment.dataBindings);
    const indoor = findTempIndoor(equipment.dataBindings);
    const outdoorExtremes = findTempExtremes(equipment, "temperature_outdoor");
    const indoorExtremes = findTempExtremes(equipment, "temperature");
    const fmt = (b: typeof outdoor) =>
      b && typeof b.value === "number" ? `${b.value.toFixed(1)}°` : "—";
    const both = !!outdoor && !!indoor;
    // Icon slot is scaled 50% by MobileWidgetCard, so we size text 2x what
    // we want visible. Both: temps side by side with short "Ext./Int."
    // captions. Single: one temperature with its explicit scope label —
    // never implicit, since reading just "20.5°" leaves the user wondering
    // which one this is.
    const singleColumn = (
      b: typeof outdoor,
      captionKey: string,
      extremes: { min: number; max: number } | null,
    ) => (
      <div className="flex flex-col items-center gap-1 leading-none whitespace-nowrap">
        <span className="text-[18px] uppercase tracking-wide text-text-tertiary font-medium">
          {t(captionKey)}
        </span>
        <span className="font-mono font-bold text-[56px] text-text tabular-nums leading-none">
          {fmt(b)}
        </span>
        {extremes && <TempExtremes min={extremes.min} max={extremes.max} large />}
      </div>
    );
    return {
      icon: both ? (
        <div className="flex items-end gap-3 leading-none whitespace-nowrap">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[18px] uppercase tracking-wide text-text-tertiary font-medium">
              {t("weather.outdoorShort")}
            </span>
            <span className="font-mono font-bold text-[48px] text-text tabular-nums leading-none">
              {fmt(outdoor)}
            </span>
            {outdoorExtremes && (
              <TempExtremes min={outdoorExtremes.min} max={outdoorExtremes.max} large />
            )}
          </div>
          <div className="w-px self-stretch bg-border" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-[18px] uppercase tracking-wide text-text-tertiary font-medium">
              {t("weather.indoorShort")}
            </span>
            <span className="font-mono font-bold text-[48px] text-text tabular-nums leading-none">
              {fmt(indoor)}
            </span>
            {indoorExtremes && (
              <TempExtremes min={indoorExtremes.min} max={indoorExtremes.max} large />
            )}
          </div>
        </div>
      ) : outdoor ? (
        singleColumn(outdoor, "weather.outdoorShort", outdoorExtremes)
      ) : indoor ? (
        singleColumn(indoor, "weather.indoorShort", indoorExtremes)
      ) : (
        <div className="flex flex-col items-center gap-1 leading-none whitespace-nowrap">
          <span className="font-mono font-bold text-[56px] text-text tabular-nums">—</span>
        </div>
      ),
      stateLines: [],
    };
  }

  if (isSensor) {
    const sensorIcon = customEntry ? (
      createElement(customEntry.component, customEntry.previewProps)
    ) : (
      <MultiSensorIcon />
    );
    const allSensorBindings = getSensorBindings(equipment.dataBindings);
    const visibleBindings = widget.config?.visibleBindings;
    const sensorBindings =
      visibleBindings && visibleBindings.length > 0
        ? visibleBindings
            .map((alias) => allSensorBindings.find((b) => b.alias === alias))
            .filter((b): b is (typeof allSensorBindings)[number] => !!b)
        : allSensorBindings;
    const lines: string[] = [];
    for (const b of sensorBindings.slice(0, 2)) {
      if (b.value !== null && b.value !== undefined) {
        // Category-driven like the desktop SensorValues (#315, #325): a
        // boolean-category value goes through the category-aware formatter
        // whatever its runtime type, so a string "ON"/"OFF" contact renders
        // the same localized label as a real boolean instead of raw text.
        lines.push(
          isBooleanSensorCategory(b.category)
            ? formatBooleanSensor(b.category, b.value, t)
            : formatSensorValue(b.value, b.unit ?? undefined, t),
        );
      }
    }
    return { icon: sensorIcon, stateLines: lines };
  }

  if (isWeatherForecast) {
    const days = parseForecastDays(equipment.dataBindings);
    const tomorrow = days[0];
    if (tomorrow) {
      const ConditionIcon = tomorrow.condition
        ? (CONDITION_ICONS[tomorrow.condition] ?? Cloud)
        : Cloud;
      const conditionColor = tomorrow.condition
        ? (CONDITION_COLORS[tomorrow.condition] ?? "text-text-tertiary")
        : "text-text-tertiary";
      const lines: string[] = [];
      if (tomorrow.tempMax !== null) {
        let tempStr = `${Math.round(tomorrow.tempMax)}°`;
        if (tomorrow.tempMin !== null) tempStr += ` / ${Math.round(tomorrow.tempMin)}°`;
        lines.push(tempStr);
      }
      if (tomorrow.rainProb !== null && tomorrow.rainProb > 0) {
        lines.push(`💧${Math.round(tomorrow.rainProb)}%`);
      }
      return {
        icon: <ConditionIcon size={96} strokeWidth={1.2} className={conditionColor} />,
        stateLines: lines,
      };
    }
    return {
      icon: <Cloud size={96} strokeWidth={1.2} className="text-text-tertiary" />,
      stateLines: [],
    };
  }

  if (isAppliance) {
    const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
    const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
    const remainingBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time_str");
    const applianceOn = powerBinding?.value === true;
    const state = typeof stateBinding?.value === "string" ? stateBinding.value : "off";
    const remainingStr =
      typeof remainingBinding?.value === "string" ? remainingBinding.value : null;
    const isRunning = state === "running";

    const lines: string[] = [];
    if (!applianceOn || state === "off") {
      lines.push("OFF");
    } else if (isRunning && remainingStr) {
      lines.push(remainingStr);
    } else {
      lines.push(state === "paused" ? t("common.paused") : state === "ready" ? "Ready" : state);
    }
    return {
      icon: (
        <WashingMachine
          size={96}
          strokeWidth={1}
          className={isRunning ? "text-accent" : "text-text-tertiary"}
        />
      ),
      stateLines: lines,
    };
  }

  if (equipment.type === "solar_panel") {
    const { producing, lines } = solarWidgetState(equipment, t);
    return {
      icon: (
        <SolarPanelIcon
          size={96}
          strokeWidth={1.4}
          className={producing ? "text-primary" : "text-text-tertiary opacity-50"}
        />
      ),
      stateLines: lines,
    };
  }

  if (equipment.type === "water_heater") {
    const waterTemp = equipment.dataBindings.find((db) => db.alias === "water_temperature");
    const tempValue = typeof waterTemp?.value === "number" ? waterTemp.value : null;
    // Spec 152 — reflect the bound channel: the main on/off (light_state) when
    // present, else the dedicated solar channel (solar_state) for a heater on
    // permanent mains. `isOn` (light_state only) would read OFF forever there.
    const channelState =
      equipment.dataBindings.find((db) => db.alias === "state" || db.category === "light_state") ??
      equipment.dataBindings.find(
        (db) => db.category === "solar_state" || db.alias === "solar_state",
      );
    const heaterOn = channelState
      ? channelState.value === true || String(channelState.value).toUpperCase() === "ON"
      : false;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <WaterHeaterIcon on={heaterOn} />
      ),
      stateLines: [
        heaterOn ? "ON" : "OFF",
        ...(tempValue !== null ? [`${tempValue.toFixed(1)}°C`] : []),
      ],
    };
  }

  if (isWaterValve) {
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <WaterValveWidgetIcon open={isOn} />
      ),
      stateLines: [isOn ? t("water.open") : t("water.closed")],
    };
  }

  if (equipment.type === "vmc") {
    const speed = vmcSpeedOf(equipment);
    const running = speed === "v1" || speed === "v2";
    const label =
      speed === "v2"
        ? t("equipments.vmc.v2")
        : speed === "v1"
          ? t("equipments.vmc.v1")
          : t("equipments.vmc.off");
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <Fan size={96} strokeWidth={1.2} className={running ? "text-primary" : "text-text-tertiary"} />
      ),
      stateLines: [label],
    };
  }

  if (isPoolCover) {
    const pos = equipment.dataBindings.find(
      (b) => b.category === "shutter_position" || b.alias === "position",
    );
    const position = pos && typeof pos.value === "number" ? pos.value : null;
    const text =
      position === 100
        ? t("controls.opened")
        : position === 0
          ? t("controls.closed")
          : position !== null
            ? `${position}%`
            : null;
    return {
      icon: customEntry ? (
        createElement(customEntry.component, customEntry.previewProps)
      ) : (
        <PoolCoverIcon position={position} />
      ),
      stateLines: text ? [text] : [],
    };
  }

  if (equipment.type === "camera") {
    const monitoring = equipment.dataBindings.find((b) => b.category === "camera_monitoring");
    return {
      icon: <Camera size={96} strokeWidth={1.4} className="text-text-tertiary" />,
      stateLines:
        monitoring !== undefined
          ? [monitoring.value === true ? t("cameras.monitoring.on") : t("cameras.monitoring.off")]
          : [],
    };
  }

  // Energy meter — mirrors the desktop EnergyMeterEquipmentWidget (issue #323):
  // today's consumption from computedData `energy_day`, plus current power
  // (`demand_5min`) when present. Without this branch the card rendered blank.
  if (isEnergyMeter) {
    const computed = equipment.computedData ?? [];
    const energyDay = computed.find((c) => c.alias === "energy_day");
    const demandBinding = equipment.dataBindings.find((b) => b.alias === "demand_5min");
    const demandW = typeof demandBinding?.value === "number" ? demandBinding.value : null;
    const fmtWh = (wh: unknown): string =>
      typeof wh !== "number"
        ? "—"
        : wh >= 1000
          ? `${(wh / 1000).toFixed(1)} kWh`
          : `${Math.round(wh)} Wh`;
    const lines = [fmtWh(energyDay?.value)];
    if (demandW !== null) {
      lines.push(
        demandW >= 1000 ? `${(demandW / 1000).toFixed(1)} kW` : `${Math.round(demandW)} W`,
      );
    }
    return { icon: <EnergyMeterIcon />, stateLines: lines };
  }

  return { icon: null, stateLines: [] };
}

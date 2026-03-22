import { createElement } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardWidget, EquipmentWithDetails } from "../../types";
import { useEquipmentState } from "../equipments/useEquipmentState";
import { getSensorBindings, formatSensorValue } from "../equipments/sensorUtils";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  GateWidgetIcon,
  HeaterWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  PlugWidgetIcon,
} from "./WidgetIcons";
import { CUSTOM_ICON_REGISTRY, shutterLevel } from "./widget-icons";
import { parseForecastDays, CONDITION_ICONS, CONDITION_COLORS } from "../equipments/weatherForecastUtils";
import { Cloud, WashingMachine, Tv, Timer } from "lucide-react";

interface MobileWidgetCardProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  onClick?: () => void;
  editMode?: boolean;
}

export function MobileWidgetCard({ widget, equipment, onClick, editMode }: MobileWidgetCardProps) {
  const { t } = useTranslation();
  const label = widget.label || equipment.name;
  const { icon, stateLines } = useMobileState(widget, equipment, t);

  return (
    <button
      onClick={onClick}
      className={`bg-surface border border-border rounded-[8px] p-2 flex flex-col items-center h-[120px] overflow-hidden w-full text-left ${
        editMode ? "" : "cursor-pointer active:scale-[0.98]"
      } transition-transform`}
    >
      {/* Label */}
      <span className={`text-[12px] font-semibold text-text truncate w-full text-center ${
        editMode ? "pl-5 pr-8" : ""
      }`}>
        {label}
      </span>

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
  t: (key: string) => string,
): { icon: React.ReactNode; stateLines: string[] } {
  const {
    isLight,
    isShutter,
    isThermostat,
    isGate,
    isHeater,
    isSensor,
    isWeatherForecast,
    isMediaPlayer,
    isAppliance,
    isOn,
  } = useEquipmentState(equipment);

  // Custom icon from registry
  const customEntry = widget.icon ? CUSTOM_ICON_REGISTRY[widget.icon] : undefined;

  if (isLight) {
    const brightness = equipment.dataBindings.find(
      (b) => b.alias === "brightness" || b.category === "light_brightness",
    );
    const pct = brightness && typeof brightness.value === "number"
      ? Math.round((brightness.value / 254) * 100)
      : null;
    const isDimmable = equipment.type === "light_dimmable" || equipment.type === "light_color";
    return {
      icon: customEntry
        ? createElement(customEntry.component, customEntry.previewProps)
        : <LightBulbIcon on={isOn} />,
      stateLines: [isDimmable && pct !== null ? `${pct}%` : (isOn ? "ON" : "OFF")],
    };
  }

  if (isShutter) {
    const pos = equipment.dataBindings.find((b) => b.category === "shutter_position");
    const position = pos && typeof pos.value === "number" ? pos.value : null;
    const level = position !== null ? shutterLevel(position) : null;
    const text = position === 100
      ? t("controls.opened")
      : position === 0
        ? t("controls.closed")
        : position !== null
          ? `${position}%`
          : null;
    return {
      icon: customEntry
        ? createElement(customEntry.component, customEntry.previewProps)
        : <ShutterWidgetIcon level={level} />,
      stateLines: text ? [text] : [],
    };
  }

  if (isThermostat) {
    const temp = equipment.dataBindings.find((b) => b.alias === "temperature");
    const setpoint = equipment.dataBindings.find((b) => b.alias === "setpoint");
    const tempVal = typeof temp?.value === "number" ? temp.value : null;
    const spVal = typeof setpoint?.value === "number" ? setpoint.value : null;
    const level = spVal !== null ? (spVal - 16) / (30 - 16) : undefined;
    return {
      icon: customEntry
        ? createElement(customEntry.component, customEntry.previewProps)
        : <ThermometerIcon warm={isOn} level={level} />,
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
    const GateIcon = iconKey === "sliding_gate" ? SlidingGateIcon
      : iconKey === "garage_door" ? GarageDoorIcon
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
      icon: customEntry
        ? createElement(customEntry.component, customEntry.previewProps)
        : <HeaterWidgetIcon comfort={isComfort} />,
      stateLines: [isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")],
    };
  }

  if (isSensor) {
    const sensorIcon = customEntry
      ? createElement(customEntry.component, customEntry.previewProps)
      : <MultiSensorIcon />;
    const allSensorBindings = getSensorBindings(equipment.dataBindings);
    const visibleBindings = widget.config?.visibleBindings;
    const sensorBindings = visibleBindings && visibleBindings.length > 0
      ? visibleBindings.map((alias) => allSensorBindings.find((b) => b.alias === alias)).filter((b): b is typeof allSensorBindings[number] => !!b)
      : allSensorBindings;
    const lines: string[] = [];
    for (const b of sensorBindings.slice(0, 2)) {
      if (b.value !== null && b.value !== undefined) {
        lines.push(formatSensorValue(b.value, b.unit ?? undefined));
      }
    }
    return { icon: sensorIcon, stateLines: lines };
  }

  if (isWeatherForecast) {
    const days = parseForecastDays(equipment.dataBindings);
    const tomorrow = days[0];
    if (tomorrow) {
      const ConditionIcon = tomorrow.condition
        ? CONDITION_ICONS[tomorrow.condition] ?? Cloud
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
    return { icon: <Cloud size={96} strokeWidth={1.2} className="text-text-tertiary" />, stateLines: [] };
  }

  if (isAppliance) {
    const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
    const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
    const remainingBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time_str");
    const applianceOn = powerBinding?.value === true;
    const state = typeof stateBinding?.value === "string" ? stateBinding.value : "off";
    const remainingStr = typeof remainingBinding?.value === "string" ? remainingBinding.value : null;
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
      icon: <WashingMachine size={96} strokeWidth={1} className={isRunning ? "text-accent" : "text-text-tertiary"} />,
      stateLines: lines,
    };
  }

  if (isMediaPlayer) {
    const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
    const sourceBinding = equipment.dataBindings.find((b) => b.alias === "input_source");
    const tvOn = powerBinding?.value === true;
    const source = typeof sourceBinding?.value === "string" ? sourceBinding.value : null;
    return {
      icon: <Tv size={96} strokeWidth={1} className={tvOn ? "text-primary" : "text-text-tertiary"} />,
      stateLines: tvOn && source ? [source] : ["OFF"],
    };
  }

  // Switch / generic
  if (equipment.type === "switch") {
    return {
      icon: customEntry
        ? createElement(customEntry.component, customEntry.previewProps)
        : <PlugWidgetIcon on={isOn} />,
      stateLines: [isOn ? "ON" : "OFF"],
    };
  }

  return { icon: null, stateLines: [] };
}

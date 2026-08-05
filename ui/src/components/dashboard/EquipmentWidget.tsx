import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Power,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Square,
  Minus,
  Plus,
  Flame,
  Snowflake,
  WashingMachine,
  Timer,
  Camera,
} from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import type { DashboardWidget } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { useCameraSnapshot } from "../../hooks/useCameraSnapshot";
import { findOrderByCategory } from "../equipments/bindingUtils";
import { findTempExtremes, findTempIndoor, findTempOutdoor } from "../equipments/weather-utils";
import { TempExtremes } from "../TempExtremes";
import { useSliderOverride } from "../../hooks/useSliderOverride";
import { SensorValues } from "../equipments/SensorValues";
import { SolarPanelIcon } from "../icons/SolarPanelIcon";
import { solarWidgetState } from "./solarWidget";
import { createElement, type ReactNode } from "react";
import {
  LightBulbIcon,
  PlugWidgetIcon,
  ShutterWidgetIcon,
  AwningWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  GateWidgetIcon,
  HeaterWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  EnergyMeterIcon,
  PoolPumpIcon,
  PoolCoverIcon,
  WaterValveWidgetIcon,
} from "./WidgetIcons";
import { WeatherForecastWidget } from "./WeatherForecastWidget";
import { WidgetCard } from "./WidgetCard";
import { CUSTOM_ICON_REGISTRY, shutterLevel } from "./widget-icons";


/** Render the widget's custom icon (widget.icon -> CUSTOM_ICON_REGISTRY) when set,
 *  otherwise the equipment-type default. Mirrors the mobile card so a custom icon
 *  shows the same on phone and desktop (issue #318). */
function resolveWidgetIcon(iconKey: string | undefined, fallback: ReactNode): ReactNode {
  const custom = iconKey ? CUSTOM_ICON_REGISTRY[iconKey] : undefined;
  return custom ? createElement(custom.component, custom.previewProps) : fallback;
}

interface EquipmentWidgetProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  /** Click handler that opens the desktop detail drawer. Currently consumed only by the weather widget. */
  onOpenDetail?: () => void;
}

export function EquipmentWidget({ widget, equipment, onExecuteOrder, onOpenDetail }: EquipmentWidgetProps) {
  const {
    isLight,
    isShutterFamily,
    isSensor,
    isWeatherForecast,
    isEnergyMeter,
    isThermostat,
    isHeater,
    isGate,
    isAppliance,
    isWaterValve,
    isPoolPump,
    isPoolCover,
    isPoolHeatPump,
  } = useEquipmentState(equipment);

  const label = widget.label || equipment.name;
  const execOrder = (alias: string, value: unknown) => onExecuteOrder(equipment.id, alias, value);

  if (isLight) return <LightEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  // Awnings share the shutter widget shape (icon + position + 3-button row).
  // ShutterEquipmentWidget swaps the icon (AwningWidgetIcon) and the vocabulary
  // (deployed/retracted, extend/retract) when type === "awning".
  if (isShutterFamily) return <ShutterEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isThermostat || isPoolHeatPump) return <ThermostatEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isGate) return <GateEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isHeater) return <HeaterEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isEnergyMeter) return <EnergyMeterEquipmentWidget label={label} equipment={equipment} />;
  if (equipment.type === "solar_panel") return <SolarPanelEquipmentWidget label={label} equipment={equipment} />;
  if (equipment.type === "switch") return <SwitchEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isWeatherForecast) return <WeatherForecastWidget label={label} equipment={equipment} />;
  if (equipment.type === "weather") return <WeatherStationWidget label={label} equipment={equipment} onOpenDetail={onOpenDetail} />;
  if (isAppliance) return <ApplianceEquipmentWidget label={label} equipment={equipment} />;
  if (isWaterValve) return <WaterValveEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isPoolPump) return <PoolPumpEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isPoolCover) return <PoolCoverEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isSensor) return <SensorEquipmentWidget label={label} equipment={equipment} iconKey={widget.icon} visibleBindings={widget.config?.visibleBindings} />;
  if (equipment.type === "camera") return <CameraEquipmentWidget label={label} equipment={equipment} />;

  return <GenericEquipmentWidget label={label} equipment={equipment} />;
}

// ============================================================
// Shared widget card shell lives in WidgetCard.tsx (spec 098).
// ============================================================
// Light equipment widget
// ============================================================

function LightEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const brightnessBinding = equipment.dataBindings.find(
    (db) => db.alias === "brightness" || db.category === "light_brightness",
  );
  const deviceBrightness = brightnessBinding && typeof brightnessBinding.value === "number"
    ? brightnessBinding.value
    : null;
  const brightness = slider.displayValue(deviceBrightness);
  const brightnessPct = brightness !== null ? Math.round((brightness / 254) * 100) : null;

  const isDimmable = equipment.type === "light_dimmable" || equipment.type === "light_color";

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
  );
  const hasToggle = !!toggleBinding;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const alias = toggleBinding.alias;
      const onVal = toggleBinding.enumValues?.find(v => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find(v => /^off$/i.test(v)) ?? "OFF";
      const value = toggleBinding.type === "boolean" && alias !== "state"
        ? !isOn
        : (isOn ? offVal : onVal);
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(false);
    }
  };

  const handleBrightnessCommit = () =>
    slider.onCommit((v) => onExecuteOrder("brightness", v));

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <LightBulbIcon on={isOn} />)}
        <div className="flex items-center gap-2 pl-2">
          {isDimmable && brightness !== null ? (
            <>
              <input
                type="range"
                min={0}
                max={254}
                value={brightness}
                onPointerDown={slider.onStart}
                onChange={(e) => slider.onChange(Number(e.target.value))}
                onMouseUp={handleBrightnessCommit}
                onTouchEnd={handleBrightnessCommit}
                className="h-[60px] slider-active slider-slim"
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <div className="flex items-baseline gap-0.5">
                <span className="text-[16px] font-semibold text-text tabular-nums leading-none">
                  {brightnessPct}
                </span>
                <span className="text-[12px] font-medium text-text-tertiary">%</span>
              </div>
            </>
          ) : (
            <span
              className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
                isOn ? "bg-active/10 text-active" : "bg-border-light text-text-tertiary"
              }`}
            >
              {isOn ? "ON" : "OFF"}
            </span>
          )}
        </div>
      </div>

      {/* Zone 3: Bouton — toggle */}
      {hasToggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              isOn ? "!border-active/40 !text-active !bg-active/5" : ""
            }`}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} strokeWidth={1.5} />}
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Switch (smart plug) widget — plug picto + ON/OFF state + toggle.
// Mirrors LightEquipmentWidget without the brightness slider. The plug's
// on/off command is a `light_toggle` order (enum ON/OFF or boolean state),
// and the state indicator reads the `light_state` data binding.
// ============================================================

function SwitchEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
  );
  const hasToggle = !!toggleBinding;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const alias = toggleBinding.alias;
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value =
        toggleBinding.type === "boolean" && alias !== "state" ? !isOn : isOn ? offVal : onVal;
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + état */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <PlugWidgetIcon on={isOn} />)}
        <div className="flex items-center gap-2 pl-2">
          <span
            className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
              isOn ? "bg-active/10 text-active" : "bg-border-light text-text-tertiary"
            }`}
          >
            {isOn ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      {/* Zone 3: Bouton — toggle */}
      {hasToggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              isOn ? "!border-active/40 !text-active !bg-active/5" : ""
            }`}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} strokeWidth={1.5} />}
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Shutter equipment widget
// ============================================================

function ShutterEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  const isAwning = equipment.type === "awning";

  const positionBinding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position",
  );
  const devicePosition = positionBinding && typeof positionBinding.value === "number"
    ? positionBinding.value
    : null;
  const position = slider.displayValue(devicePosition);

  // Category-first resolver — mirrors the detail variant below (spec 110).
  // Without this, manually re-bound shutters (alias = device key) lose the
  // command buttons.
  const moveBinding = findOrderByCategory(
    equipment.orderBindings,
    ["pool_cover_move", "shutter_move"],
    ["state"],
    [/^shutter\d*_state$/],
  );
  const hasState = !!moveBinding;
  // Some bridges cannot actually stop the shutter mid-travel (e.g. Bubendorff
  // shutters via an "iDiamant with Netatmo" bridge, sowel-plugin-legrand-
  // control — confirmed live: a stop command only makes the motor pause
  // briefly before it continues to its original target). The integration
  // signals this by omitting "STOP" from the move order's enumValues.
  const hasStop = !moveBinding?.enumValues || moveBinding.enumValues.some((v) => v.toUpperCase() === "STOP");
  const level = position !== null ? shutterLevel(position) : null;

  // Awning vocabulary swap (mirrors ShutterControl):
  //   OPEN (RF up) = retract  · CLOSE (RF down) = extend (deploy)
  //   pos 0  = retracted    · pos 100 = deployed
  const pillAtHundred = isAwning ? t("controls.deployed") : t("controls.opened");
  const pillAtZero = isAwning ? t("controls.retracted") : t("controls.closed");
  const openTitle = isAwning ? t("controls.retract") : t("controls.open");
  const closeTitle = isAwning ? t("controls.extend") : t("controls.close");

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE") => {
    if (executing || !moveBinding) return;
    setExecuting(true);
    try {
      const enumMatch = moveBinding.enumValues?.find((v) => v.toUpperCase() === command);
      await onExecuteOrder(moveBinding.alias, enumMatch ?? command);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(
          iconKey,
          isAwning ? (
            <AwningWidgetIcon deployed={position !== null && position > 0} />
          ) : (
            <ShutterWidgetIcon level={level} />
          ),
        )}
        <div className="pl-2">
          {position === null ? (
            <span className="text-[16px] text-text-tertiary">{"\u2014"}</span>
          ) : position === 100 ? (
            <span className="text-[13px] font-medium text-success px-2 py-0.5 rounded bg-success/10">{pillAtHundred}</span>
          ) : position === 0 ? (
            <span className="text-[13px] font-medium text-text-secondary px-2 py-0.5 rounded bg-border-light">{pillAtZero}</span>
          ) : (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[16px] font-semibold text-text tabular-nums leading-none">{position}</span>
              <span className="text-[12px] font-medium text-text-tertiary">%</span>
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Bouton — up/stop/down */}
      {hasState && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={() => handleCommand("OPEN")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={openTitle}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <ChevronUp size={16} strokeWidth={2} />}
          </button>
          {hasStop && (
            <button
              onClick={() => handleCommand("STOP")}
              disabled={executing}
              className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-text-tertiary hover:text-text hover:bg-border-light active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("controls.stop")}
            >
              <Square size={11} strokeWidth={2.5} />
            </button>
          )}
          <button
            onClick={() => handleCommand("CLOSE")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={closeTitle}
          >
            <ChevronDown size={16} strokeWidth={2} />
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Thermostat equipment widget
// ============================================================

function ThermostatEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);
  const setpointOverride = useSliderOverride(5000);

  const isPoolHeatPump = equipment.type === "pool_heat_pump";

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "mode");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const effectiveWaterTemp = equipment.computedData?.find(
    (c) => c.alias === "effective_water_temperature",
  );
  const targetTempBinding = equipment.dataBindings.find((b) => b.alias === "setpoint");

  const isOn = isPoolHeatPump
    ? typeof modeBinding?.value === "string" && modeBinding.value.toUpperCase() !== "OFF"
    : powerBinding?.value === true;
  const insideTemp = isPoolHeatPump
    ? typeof effectiveWaterTemp?.value === "number"
      ? effectiveWaterTemp.value
      : null
    : typeof insideTempBinding?.value === "number"
      ? insideTempBinding.value
      : null;
  const deviceSetpoint = typeof targetTempBinding?.value === "number" ? targetTempBinding.value : null;
  const displaySetpoint = setpointOverride.displayValue(deviceSetpoint);

  const hasPowerOrder = !isPoolHeatPump && equipment.orderBindings.some((o) => o.alias === "power");
  const targetTempOrder = equipment.orderBindings.find((o) => o.alias === "setpoint");
  const targetMin = targetTempOrder?.min ?? (isPoolHeatPump ? 10 : 16);
  const targetMax = targetTempOrder?.max ?? 30;
  const STEP = 0.5;

  const thermometerLevel = displaySetpoint !== null
    ? (displaySetpoint - targetMin) / (targetMax - targetMin)
    : undefined;

  const handleSetpoint = (newValue: number) => {
    setpointOverride.onStart();
    setpointOverride.onChange(newValue);
    setpointOverride.onCommit((v) => onExecuteOrder("setpoint", v));
  };

  const exec = async (alias: string, value: unknown) => {
    if (executing) return;
    setExecuting(alias);
    try {
      await onExecuteOrder(alias, value);
    } finally {
      setExecuting(null);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + temp + power */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <ThermometerIcon warm={isOn} level={thermometerLevel} />)}
        <div className="flex flex-col items-start gap-2 pl-2">
          {insideTemp !== null ? (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[18px] font-semibold text-text tabular-nums leading-none font-mono">
                {insideTemp.toFixed(1)}
              </span>
              <span className="text-[12px] font-medium text-text-tertiary">°C</span>
            </div>
          ) : (
            <span className="text-[18px] text-text-tertiary">{"\u2014"}</span>
          )}
          {hasPowerOrder && equipment.enabled && (
            <button
              onClick={() => exec("power", !isOn)}
              disabled={executing === "power"}
              className={`w-7 h-7 flex items-center justify-center rounded-[5px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
                isOn
                  ? "!border-error/40 !text-error !bg-error/5 hover:!bg-error/10"
                  : "hover:border-primary/40 hover:text-primary hover:bg-primary/5"
              }`}
              title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
            >
              {executing === "power" ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>

      {/* Zone 3: Setpoint controls */}
      {targetTempOrder && displaySetpoint !== null && (
        <div className="flex items-center justify-center gap-2 mt-auto pt-1">
          <button
            onClick={() => handleSetpoint(Math.max(targetMin, displaySetpoint - STEP))}
            disabled={displaySetpoint <= targetMin}
            className="w-8 h-8 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer border border-border bg-surface text-text-tertiary hover:bg-border-light hover:text-text-secondary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus size={14} strokeWidth={2} />
          </button>
          <span className="text-[12px] font-medium text-text-secondary tabular-nums font-mono min-w-[42px] text-center">
            {displaySetpoint.toFixed(1)}°C
          </span>
          <button
            onClick={() => handleSetpoint(Math.min(targetMax, displaySetpoint + STEP))}
            disabled={displaySetpoint >= targetMax}
            className="w-8 h-8 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer border border-border bg-surface text-text-tertiary hover:bg-border-light hover:text-text-secondary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Gate equipment widget
// ============================================================

const GATE_ICON_MAP: Record<string, typeof GateWidgetIcon> = {
  gate: GateWidgetIcon,
  sliding_gate: SlidingGateIcon,
  garage_door: GarageDoorIcon,
};

function GateEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.category === "gate_state",
  );
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const isOpen = gateState === "open";

  // Category-first resolver (spec 110). Matches WidgetGrid's mobile-direct
  // path so all three gate code paths agree on the same binding.
  const commandBinding = findOrderByCategory(
    equipment.orderBindings,
    ["gate_trigger"],
    ["command"],
  );
  const hasCommand = !!commandBinding;
  const enumValues = commandBinding?.enumValues ?? [];
  const hasSingleAction = hasCommand && enumValues.length <= 1;

  const handleCommand = async () => {
    if (executing || !commandBinding || !hasSingleAction) return;
    setExecuting(true);
    try {
      await onExecuteOrder(commandBinding.alias, null);
    } finally {
      setExecuting(false);
    }
  };

  const IconComp = (iconKey && GATE_ICON_MAP[iconKey]) || GateWidgetIcon;

  return (
    <WidgetCard
      label={label}
      onClick={hasSingleAction ? handleCommand : undefined}
      className={hasSingleAction ? "cursor-pointer active:scale-[0.98] transition-transform" : ""}
    >
      {/* Icon centered */}
      <div className="flex-1 flex items-center justify-center">
        {executing ? (
          <Loader2 size={32} className="animate-spin text-text-tertiary" />
        ) : (
          <IconComp open={isOpen} />
        )}
      </div>

      {/* State text */}
      <div className="flex justify-center mt-auto pt-1">
        <span
          className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
            isOpen
              ? "bg-warning/10 text-warning"
              : gateState === "closed"
                ? "bg-success/10 text-success"
                : "bg-text-tertiary/10 text-text-tertiary"
          }`}
        >
          {t(`controls.gate.${gateState}`)}
        </span>
      </div>
    </WidgetCard>
  );
}

// ============================================================
// Heater equipment widget (fil pilote: relay ON = eco, OFF = comfort)
// ============================================================

function HeaterEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;
  const isComfort = !isOn;

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.alias === "state" && (ob.type === "enum" || ob.type === "boolean"),
  );
  const hasToggle = !!toggleBinding;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = isOn ? offVal : onVal;
      await onExecuteOrder("state", value);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <HeaterWidgetIcon comfort={isComfort} />)}
        <div className="pl-2">
          <span
            className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
              isComfort
                ? "bg-error/10 text-error"
                : "bg-primary/10 text-primary"
            }`}
          >
            {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
          </span>
        </div>
      </div>

      {/* Zone 3: Bouton — toggle */}
      {hasToggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              isComfort
                ? "hover:border-primary/40 hover:text-primary hover:bg-primary/5"
                : "hover:border-error/40 hover:text-error hover:bg-error/5"
            }`}
            title={isComfort ? t("controls.heater.switchEco") : t("controls.heater.switchComfort")}
          >
            {executing
              ? <Loader2 size={16} className="animate-spin" />
              : isComfort
                ? <Snowflake size={16} strokeWidth={1.5} />
                : <Flame size={16} strokeWidth={1.5} />
            }
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Sensor equipment widget (read-only — no buttons)
// ============================================================

function SensorEquipmentWidget({
  label,
  equipment,
  iconKey,
  visibleBindings,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  iconKey?: string;
  visibleBindings?: string[];
}) {
  const { sensorBindings, batteryBindings } = useEquipmentState(equipment);

  const customEntry = iconKey ? CUSTOM_ICON_REGISTRY[iconKey] : undefined;
  const sensorIcon = customEntry
    ? createElement(customEntry.component, customEntry.previewProps)
    : <MultiSensorIcon />;

  // Filter and order bindings according to visibleBindings config
  const filteredBindings = visibleBindings && visibleBindings.length > 0
    ? visibleBindings.map((alias) => sensorBindings.find((b) => b.alias === alias)).filter((b): b is typeof sensorBindings[number] => !!b)
    : sensorBindings;

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État — centered vertically (no bottom controls) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center flex-1 min-h-0">
        <div />
        {sensorIcon}
        <div className="flex flex-col items-start pl-2 overflow-y-auto max-h-full">
          <SensorValues sensorBindings={filteredBindings} batteryBindings={batteryBindings} layout="column" />
        </div>
      </div>
    </WidgetCard>
  );
}

// ============================================================
// Weather station widget (read-only — Netatmo + similar multi-module stations)
// ============================================================

function WeatherStationWidget({
  label,
  equipment,
  onOpenDetail,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onOpenDetail?: () => void;
}) {
  const { t } = useTranslation();

  const outdoor = findTempOutdoor(equipment.dataBindings);
  const indoor = findTempIndoor(equipment.dataBindings);
  const outdoorExtremes = findTempExtremes(equipment, "temperature_outdoor");
  const indoorExtremes = findTempExtremes(equipment, "temperature");

  const fmt = (b: typeof outdoor) =>
    b && typeof b.value === "number" ? b.value.toFixed(1) : "—";

  const clickClass = onOpenDetail
    ? "cursor-pointer transition-colors hover:bg-primary-light/30"
    : "";

  // Both bound → side by side with explicit labels.
  // Only one bound → keep the explicit label (outdoor or indoor) so the user
  // still knows which one they're reading — no implicit single.
  const both = !!outdoor && !!indoor;

  return (
    <WidgetCard label={label} onClick={onOpenDetail} className={clickClass}>
      <div className="flex items-stretch justify-center flex-1 min-h-0">
        {both ? (
          <div className="flex items-stretch gap-4 sm:gap-6">
            <WeatherTempColumn label={t("weather.outdoor")} value={fmt(outdoor)} extremes={outdoorExtremes} />
            <div className="w-px bg-border self-stretch" />
            <WeatherTempColumn label={t("weather.indoor")} value={fmt(indoor)} extremes={indoorExtremes} />
          </div>
        ) : outdoor ? (
          <WeatherTempColumn label={t("weather.outdoor")} value={fmt(outdoor)} extremes={outdoorExtremes} />
        ) : indoor ? (
          <WeatherTempColumn label={t("weather.indoor")} value={fmt(indoor)} extremes={indoorExtremes} />
        ) : (
          <WeatherTempColumn label={null} value="—" />
        )}
      </div>
    </WidgetCard>
  );
}

function WeatherTempColumn({
  label,
  value,
  extremes,
}: {
  label: string | null;
  value: string;
  extremes?: { min: number; max: number } | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1">
      {label && (
        <span className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
          {label}
        </span>
      )}
      <div className="flex items-baseline leading-none">
        <span className="font-mono font-bold text-[32px] sm:text-[36px] text-text tabular-nums leading-none">
          {value}
        </span>
        <span className="text-text-tertiary font-medium text-[14px] sm:text-[16px] leading-none ml-1">°C</span>
      </div>
      {extremes && <TempExtremes min={extremes.min} max={extremes.max} />}
    </div>
  );
}

// ============================================================
// Energy meter widget (read-only — displays computed energy data)
// ============================================================

function EnergyMeterEquipmentWidget({
  label,
  equipment,
}: {
  label: string;
  equipment: EquipmentWithDetails;
}) {
  const { t } = useTranslation();

  // Get energy values from computedData (energy_day, energy_hour, energy_month)
  const computed = equipment.computedData ?? [];
  const energyDay = computed.find((c) => c.alias === "energy_day");
  const energyHour = computed.find((c) => c.alias === "energy_hour");
  const energyMonth = computed.find((c) => c.alias === "energy_month");

  // Also check dataBindings for demand_5min (current power)
  const demandBinding = equipment.dataBindings.find((b) => b.alias === "demand_5min");
  const demandW = typeof demandBinding?.value === "number" ? demandBinding.value : null;

  const isProduction = equipment.type === "energy_production_meter";
  const primaryColor = isProduction ? "text-success" : "text-text";

  const formatWh = (wh: unknown): string => {
    if (typeof wh !== "number") return "\u2014";
    if (wh >= 1000) return (wh / 1000).toFixed(1);
    return String(Math.round(wh));
  };

  const unitWh = (wh: unknown): string => {
    if (typeof wh !== "number") return "";
    return wh >= 1000 ? "kWh" : "Wh";
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Icon + primary value (today) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <EnergyMeterIcon />
        <div className="flex flex-col items-start gap-1.5 pl-2">
          {/* Today's consumption — primary value (green for production meters) */}
          <div className="flex items-baseline gap-0.5">
            <span className={`text-[20px] font-semibold ${primaryColor} tabular-nums leading-none font-mono`}>
              {formatWh(energyDay?.value)}
            </span>
            <span className="text-[11px] font-medium text-text-tertiary">
              {unitWh(energyDay?.value)}
            </span>
          </div>
          <span className="text-[11px] text-text-tertiary">{t("energy.today")}</span>
        </div>
      </div>

      {/* Zone 3: Secondary values */}
      <div className="flex justify-center gap-4 mt-auto pt-1">
        {demandW !== null && (
          <div className="flex flex-col items-center">
            <span className="text-[13px] font-semibold text-text tabular-nums font-mono leading-none">
              {demandW >= 1000 ? (demandW / 1000).toFixed(1) : Math.round(demandW)}
            </span>
            <span className="text-[10px] text-text-tertiary">{demandW >= 1000 ? "kW" : "W"}</span>
          </div>
        )}
        {energyHour?.value != null && (
          <div className="flex flex-col items-center">
            <span className="text-[13px] font-semibold text-text tabular-nums font-mono leading-none">
              {formatWh(energyHour.value)}
            </span>
            <span className="text-[10px] text-text-tertiary">{t("energy.hour")}</span>
          </div>
        )}
        {energyMonth?.value != null && (
          <div className="flex flex-col items-center">
            <span className="text-[13px] font-semibold text-text tabular-nums font-mono leading-none">
              {formatWh(energyMonth.value)}
            </span>
            <span className="text-[10px] text-text-tertiary">{unitWh(energyMonth.value)}</span>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

// ============================================================
// Solar panel widget (spec 125) — one PV panel = one inverter channel
// ============================================================

function SolarPanelEquipmentWidget({
  label,
  equipment,
}: {
  label: string;
  equipment: EquipmentWithDetails;
}) {
  const { t } = useTranslation();

  // Centered layout matching the mobile card: PV logo on top, then power ·
  // current · voltage right under it (no click-through). "Veille" when the panel
  // is not producing (night/offline) rather than a fake live 0.
  const { producing, lines } = solarWidgetState(equipment, t);

  return (
    <WidgetCard label={label}>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <SolarPanelIcon
          strokeWidth={1.5}
          className={`${producing ? "text-primary" : "text-text-tertiary opacity-50"} w-[84px] h-[84px] sm:w-[104px] sm:h-[104px]`}
        />
        <span
          className={`text-[16px] font-semibold tabular-nums font-mono ${producing ? "text-text" : "text-text-tertiary"}`}
        >
          {lines.join("  ·  ")}
        </span>
      </div>
    </WidgetCard>
  );
}

// ============================================================
// Appliance widget (washing machine, etc.)
// ============================================================

function ApplianceEquipmentWidget({
  label,
  equipment,
}: {
  label: string;
  equipment: EquipmentWithDetails;
}) {
  const { t } = useTranslation();

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const stateBinding = equipment.dataBindings.find((b) => b.alias === "state");
  const remainingTimeStrBinding = equipment.dataBindings.find((b) => b.alias === "remaining_time_str");
  const progressBinding = equipment.dataBindings.find((b) => b.alias === "progress");

  const isOn = powerBinding?.value === true;
  const state = typeof stateBinding?.value === "string" ? stateBinding.value : "off";
  const remainingStr = typeof remainingTimeStrBinding?.value === "string" ? remainingTimeStrBinding.value : null;
  const progress = typeof progressBinding?.value === "number" ? progressBinding.value : 0;

  const isRunning = state === "running";

  return (
    <WidgetCard label={label}>
      {/* Icon + state */}
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 gap-1">
        <WashingMachine
          size={120}
          strokeWidth={0.8}
          className={isRunning ? "text-accent animate-pulse" : isOn ? "text-text-secondary" : "text-text-tertiary"}
        />

        {!isOn || state === "off" ? (
          <span className="text-[12px] text-text-tertiary">OFF</span>
        ) : isRunning ? (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[12px] font-medium text-accent">{t("common.running")}</span>
            {remainingStr && (
              <span className="flex items-center gap-1 text-[13px] font-mono tabular-nums text-text">
                <Timer size={12} />
                {remainingStr}
              </span>
            )}
            {progress > 0 && (
              <div className="w-16 h-1.5 bg-border-light rounded-full overflow-hidden mt-0.5">
                <div className="h-full bg-accent rounded-full" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        ) : (
          <span className="text-[12px] text-text-secondary">
            {state === "paused" ? t("common.paused") : state === "ready" ? "Ready" : state}
          </span>
        )}
      </div>
    </WidgetCard>
  );
}

// ============================================================
// Water valve equipment widget — pipe icon + ON/OFF toggle
// ============================================================

function WaterValveEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOpen = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
  );
  const hasToggle = !!toggleBinding;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = toggleBinding.type === "boolean"
        ? !isOpen
        : isOpen ? offVal : onVal;
      await onExecuteOrder(toggleBinding.alias, value);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <WaterValveWidgetIcon open={isOpen} />)}
        <div className="flex items-center gap-2 pl-2">
          <span
            className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
              isOpen ? "bg-active/10 text-active" : "bg-border-light text-text-tertiary"
            }`}
          >
            {isOpen ? t("water.open") : t("water.closed")}
          </span>
        </div>
      </div>

      {hasToggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              isOpen ? "!border-active/40 !text-active !bg-active/5" : ""
            }`}
            title={isOpen ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} strokeWidth={1.5} />}
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Pool pump equipment widget — ON/OFF toggle + daily runtime
// ============================================================

function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function PoolPumpEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" || db.category === "light_state",
  );
  const isOn = stateBinding
    ? stateBinding.value === true || String(stateBinding.value).toUpperCase() === "ON"
    : false;

  const runtime = equipment.computedData?.find((c) => c.alias === "runtime_daily");
  const runtimeSeconds = typeof runtime?.value === "number" ? runtime.value : 0;

  // Category-first resolver (spec 110). Putting category last in a hybrid
  // chain would let an unrelated boolean order on multi-relay pool pumps
  // (e.g. `auto_mode`) win over the real toggle.
  const toggleBinding =
    findOrderByCategory(
      equipment.orderBindings,
      ["pool_pump_toggle", "light_toggle", "toggle_power"],
      ["state"],
    ) ??
    equipment.orderBindings.find(
      (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
    );
  const hasToggle = !!toggleBinding;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = toggleBinding.type === "boolean"
        ? !isOn
        : isOn ? offVal : onVal;
      await onExecuteOrder(toggleBinding.alias, value);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {resolveWidgetIcon(iconKey, <PoolPumpIcon on={isOn} />)}
        <div className="flex flex-col items-start gap-1 pl-2">
          <span
            className={`text-[12px] font-medium px-2.5 py-0.5 rounded-full ${
              isOn ? "bg-active/10 text-active" : "bg-border-light text-text-tertiary"
            }`}
          >
            {isOn ? "ON" : "OFF"}
          </span>
          <span className="text-[11px] text-text-tertiary tabular-nums font-mono">
            {formatRuntime(runtimeSeconds)}
          </span>
        </div>
      </div>

      {hasToggle && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              isOn ? "!border-active/40 !text-active !bg-active/5" : ""
            }`}
            title={isOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} strokeWidth={1.5} />}
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Pool cover equipment widget — Open/Stop/Close + position
// ============================================================

function PoolCoverEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  // Lookup by binding category (not by alias) so we work regardless of
  // whether the binding alias was rewritten to "state"/"position" or kept
  // the raw plugin key (e.g. shutter_state on legacy Tasmota).
  const positionBinding = equipment.dataBindings.find(
    (db) =>
      db.category === "shutter_position" ||
      db.category === ("position" as never) ||
      db.alias === "position",
  );
  const devicePosition =
    positionBinding && typeof positionBinding.value === "number"
      ? positionBinding.value
      : null;
  const position = slider.displayValue(devicePosition);

  // Find the move-style order binding by, in order:
  //   1. binding category (pool_cover_move override, or shutter_move legacy)
  //   2. binding alias (state / shutter_state / shutter1_state / …)
  //   3. enum values that look like OPEN/CLOSE/STOP
  // This covers freshly auto-bound pool covers as well as bindings created
  // before the category-aware aliasing landed.
  const moveBinding = equipment.orderBindings.find(
    (ob) => ob.category === "pool_cover_move" || ob.category === "shutter_move",
  )
    ?? equipment.orderBindings.find(
      (ob) => ob.alias === "state" || /shutter\d*_state/.test(ob.alias),
    )
    ?? equipment.orderBindings.find((ob) => {
      if (ob.type !== "enum" || !ob.enumValues) return false;
      const upper = ob.enumValues.map((v) =>
        typeof v === "string" ? v.toUpperCase() : "",
      );
      return upper.includes("OPEN") && upper.includes("CLOSE");
    });

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE") => {
    if (executing || !moveBinding) return;
    setExecuting(true);
    try {
      const enumMatch = moveBinding.enumValues?.find((v) => v.toUpperCase() === command);
      await onExecuteOrder(moveBinding.alias, enumMatch ?? command);
    } finally {
      setExecuting(false);
    }
  };

  const hasState = !!moveBinding;
  // Some bridges cannot actually stop the cover/shutter mid-travel (e.g.
  // Bubendorff shutters via an "iDiamant with Netatmo" bridge,
  // sowel-plugin-legrand-control — confirmed live: a stop command only
  // makes the motor pause briefly before it continues to its original
  // target). The integration signals this by omitting "STOP" from the
  // move order's enumValues.
  const hasStop = !moveBinding?.enumValues || moveBinding.enumValues.some((v) => v.toUpperCase() === "STOP");

  return (
    <WidgetCard label={label}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {/* Nudge up only here — the icon is intrinsically centered in its
         * viewBox and the dashboard slot reads it slightly low. Mobile
         * containers center it correctly without this offset. */}
        <div className="-mt-3">
          {resolveWidgetIcon(iconKey, <PoolCoverIcon position={position} />)}
        </div>
        <div className="pl-2">
          {position === null ? (
            <span className="text-[16px] text-text-tertiary">{"\u2014"}</span>
          ) : position === 100 ? (
            <span className="text-[13px] font-medium text-success px-2 py-0.5 rounded bg-success/10">
              {t("controls.opened")}
            </span>
          ) : position === 0 ? (
            <span className="text-[13px] font-medium text-text-secondary px-2 py-0.5 rounded bg-border-light">
              {t("controls.closed")}
            </span>
          ) : (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[16px] font-semibold text-text tabular-nums leading-none">
                {position}
              </span>
              <span className="text-[12px] font-medium text-text-tertiary">%</span>
            </div>
          )}
        </div>
      </div>

      {hasState && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={() => handleCommand("OPEN")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("controls.open")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <ChevronLeft size={16} strokeWidth={2} />}
          </button>
          {hasStop && (
            <button
              onClick={() => handleCommand("STOP")}
              disabled={executing}
              className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-text-tertiary hover:text-text hover:bg-border-light active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("controls.stop")}
            >
              <Square size={11} strokeWidth={2.5} />
            </button>
          )}
          <button
            onClick={() => handleCommand("CLOSE")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("controls.close")}
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Camera widget (spec 133)
// ============================================================

function CameraEquipmentWidget({
  label,
  equipment,
}: {
  label: string;
  equipment: EquipmentWithDetails;
}) {
  const { t } = useTranslation();
  const hasSnapshot = equipment.dataBindings.some((b) => b.category === "camera_snapshot_url");
  const monitoringBinding = equipment.dataBindings.find((b) => b.category === "camera_monitoring");
  // Deliberately does NOT use GenericEquipmentWidget's primaryBinding fallback —
  // that would print the raw camera_snapshot_url/camera_stream_url string,
  // leaking an address the media-proxy route exists specifically to hide.
  const { url } = useCameraSnapshot(equipment.id, hasSnapshot, 60_000);

  return (
    <WidgetCard label={label}>
      <div className="flex-1 min-h-0 rounded-[4px] bg-black overflow-hidden flex items-center justify-center">
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Camera size={32} strokeWidth={1.5} className="text-white/40" />
        )}
      </div>
      {monitoringBinding && (
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full mt-2 self-center ${
            monitoringBinding.value === true
              ? "bg-success/10 text-success"
              : "bg-border-light text-text-tertiary"
          }`}
        >
          {monitoringBinding.value === true ? t("cameras.monitoring.on") : t("cameras.monitoring.off")}
        </span>
      )}
    </WidgetCard>
  );
}

// ============================================================
// Generic fallback widget
// ============================================================

function GenericEquipmentWidget({
  label,
  equipment,
}: {
  label: string;
  equipment: EquipmentWithDetails;
}) {
  const { t } = useTranslation();
  const { stateBinding, isOn } = useEquipmentState(equipment);
  const primaryBinding = equipment.dataBindings[0] ?? null;

  return (
    <WidgetCard label={label}>
      {equipment.dataBindings.length === 0 ? (
        <span className="text-[12px] text-text-tertiary text-center">{t("dashboard.noData")}</span>
      ) : (
        <div className="flex flex-col items-center py-2 gap-1">
          {primaryBinding && (
            <span className="text-[14px] text-text-secondary tabular-nums">
              {formatValue(primaryBinding.value, primaryBinding.unit)}
            </span>
          )}
          {stateBinding && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isOn ? "bg-success/10 text-success" : "bg-border-light text-text-tertiary"}`}>
              {isOn ? t("common.on") : t("common.off")}
            </span>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

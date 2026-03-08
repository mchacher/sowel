import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Power,
  Loader2,
  ChevronUp,
  ChevronDown,
  Square,
  Minus,
  Plus,
  DoorOpen,
  Flame,
  Snowflake,
} from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import type { DashboardWidget } from "../../types";
import { useEquipmentState, formatValue } from "../equipments/useEquipmentState";
import { useSliderOverride } from "../../hooks/useSliderOverride";
import { SensorValues } from "../equipments/SensorValues";
import { createElement } from "react";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  GateWidgetIcon,
  HeaterWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
} from "./WidgetIcons";
import { CUSTOM_ICON_REGISTRY, shutterLevel } from "./widget-icons";


interface EquipmentWidgetProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
}

export function EquipmentWidget({ widget, equipment, onExecuteOrder }: EquipmentWidgetProps) {
  const {
    isLight,
    isShutter,
    isSensor,
    isThermostat,
    isHeater,
    isGate,
  } = useEquipmentState(equipment);

  const label = widget.label || equipment.name;
  const execOrder = (alias: string, value: unknown) => onExecuteOrder(equipment.id, alias, value);

  if (isLight) return <LightEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} />;
  if (isShutter) return <ShutterEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} />;
  if (isThermostat) return <ThermostatEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} />;
  if (isGate) return <GateEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />;
  if (isHeater) return <HeaterEquipmentWidget label={label} equipment={equipment} onExecuteOrder={execOrder} />;
  if (isSensor) return <SensorEquipmentWidget label={label} equipment={equipment} iconKey={widget.icon} visibleBindings={widget.config?.visibleBindings} />;

  return <GenericEquipmentWidget label={label} equipment={equipment} />;
}

// ============================================================
// Shared widget card shell — 4-zone layout
// ============================================================

function WidgetCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col h-[240px] overflow-hidden">
      {/* Zone 1: Titre */}
      <span className="text-[17px] font-semibold text-text truncate mb-2 text-center">{label}</span>
      {children}
    </div>
  );
}

// ============================================================
// Light equipment widget
// ============================================================

function LightEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
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
        <LightBulbIcon on={isOn} />
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
// Shutter equipment widget
// ============================================================

function ShutterEquipmentWidget({
  label,
  equipment,
  onExecuteOrder,
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState(false);
  const slider = useSliderOverride();

  const positionBinding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position",
  );
  const devicePosition = positionBinding && typeof positionBinding.value === "number"
    ? positionBinding.value
    : null;
  const position = slider.displayValue(devicePosition);

  const hasState = equipment.orderBindings.some((ob) => ob.alias === "state");
  const level = position !== null ? shutterLevel(position) : null;

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE") => {
    if (executing || !hasState) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", command);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <ShutterWidgetIcon level={level} />
        <div className="pl-2">
          {position === null ? (
            <span className="text-[16px] text-text-tertiary">{"\u2014"}</span>
          ) : position === 100 ? (
            <span className="text-[13px] font-medium text-success px-2 py-0.5 rounded bg-success/10">{t("controls.opened")}</span>
          ) : position === 0 ? (
            <span className="text-[13px] font-medium text-text-secondary px-2 py-0.5 rounded bg-border-light">{t("controls.closed")}</span>
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
            title={t("controls.open")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <ChevronUp size={16} strokeWidth={2} />}
          </button>
          <button
            onClick={() => handleCommand("STOP")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-text-tertiary hover:text-text hover:bg-border-light active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("controls.stop")}
          >
            <Square size={11} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => handleCommand("CLOSE")}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("controls.close")}
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
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);
  const setpointOverride = useSliderOverride(5000);

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const targetTempBinding = equipment.dataBindings.find((b) => b.alias === "setpoint");

  const isOn = powerBinding?.value === true;
  const insideTemp = typeof insideTempBinding?.value === "number" ? insideTempBinding.value : null;
  const deviceSetpoint = typeof targetTempBinding?.value === "number" ? targetTempBinding.value : null;
  const displaySetpoint = setpointOverride.displayValue(deviceSetpoint);

  const hasPowerOrder = equipment.orderBindings.some((o) => o.alias === "power");
  const targetTempOrder = equipment.orderBindings.find((o) => o.alias === "setpoint");
  const targetMin = targetTempOrder?.min ?? 16;
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
        <ThermometerIcon warm={isOn} level={thermometerLevel} />
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
    (db) => db.alias === "state" && db.category === "gate_state",
  );
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const isOpen = gateState === "open";

  const commandBinding = equipment.orderBindings.find((ob) => ob.alias === "command");
  const hasCommand = !!commandBinding;

  const handleCommand = async () => {
    if (executing || !commandBinding) return;
    setExecuting(true);
    try {
      await onExecuteOrder("command", null);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <WidgetCard label={label}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        {(() => {
          const IconComp = (iconKey && GATE_ICON_MAP[iconKey]) || GateWidgetIcon;
          return <IconComp open={isOpen} />;
        })()}
        <div className="pl-2">
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
      </div>

      {/* Zone 3: Bouton — command */}
      {hasCommand && equipment.enabled && (
        <div className="flex justify-center gap-3 mt-auto pt-1">
          <button
            onClick={handleCommand}
            disabled={executing}
            className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("controls.gate.command")}
          >
            {executing ? <Loader2 size={16} className="animate-spin" /> : <DoorOpen size={16} strokeWidth={1.5} />}
          </button>
        </div>
      )}
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
}: {
  label: string;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
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
        <HeaterWidgetIcon comfort={isComfort} />
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

  // Filter bindings if config specifies visible ones
  const filteredBindings = visibleBindings && visibleBindings.length > 0
    ? sensorBindings.filter((b) => visibleBindings.includes(b.alias))
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

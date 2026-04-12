import { useState, useMemo, useCallback, createElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Power,
  Loader2,
  ChevronUp,
  ChevronDown,
  Square,
  Minus,
  Plus,
  Flame,
  Snowflake,
  Lightbulb,
  LightbulbOff,
} from "lucide-react";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren } from "../../types";
import { executeZoneOrder } from "../../api";
import { useEquipmentState } from "../equipments/useEquipmentState";
import { useSliderOverride } from "../../hooks/useSliderOverride";
import { SensorValues } from "../equipments/SensorValues";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  HeaterWidgetIcon,
  GateWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
} from "./WidgetIcons";
import { CUSTOM_ICON_REGISTRY, shutterLevel } from "./widget-icons";
import { BottomSheet } from "./BottomSheet";

// ============================================================
// Equipment detail sheets
// ============================================================

interface EquipmentDetailProps {
  widget: DashboardWidget;
  equipment: EquipmentWithDetails;
  onExecuteOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  onClose: () => void;
}

export function EquipmentDetailSheet({ widget, equipment, onExecuteOrder, onClose }: EquipmentDetailProps) {
  const { isLight, isShutter, isThermostat, isHeater, isSensor, isGate } = useEquipmentState(equipment);
  const label = widget.label || equipment.name;
  const execOrder = (alias: string, value: unknown) => onExecuteOrder(equipment.id, alias, value);

  // Get icon
  const customEntry = widget.icon ? CUSTOM_ICON_REGISTRY[widget.icon] : undefined;

  if (isLight && (equipment.type === "light_dimmable" || equipment.type === "light_color")) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <LightDetailContent equipment={equipment} onExecuteOrder={execOrder} />
      </BottomSheet>
    );
  }

  if (isShutter) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <ShutterDetailContent equipment={equipment} onExecuteOrder={execOrder} />
      </BottomSheet>
    );
  }

  if (isThermostat) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <ThermostatDetailContent equipment={equipment} onExecuteOrder={execOrder} />
      </BottomSheet>
    );
  }

  if (isHeater) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <HeaterDetailContent equipment={equipment} onExecuteOrder={execOrder} />
      </BottomSheet>
    );
  }

  if (isGate) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <GateDetailContent equipment={equipment} onExecuteOrder={execOrder} iconKey={widget.icon} />
      </BottomSheet>
    );
  }

  if (isSensor) {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <SensorDetailContent equipment={equipment} visibleBindings={widget.config?.visibleBindings} />
      </BottomSheet>
    );
  }

  return null;
}

// ============================================================
// Zone detail sheet
// ============================================================

const WIDGET_FAMILY_TYPES: Record<string, string[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve"],
};

function getDescendantZoneIds(zone: ZoneWithChildren): string[] {
  const ids = [zone.id];
  for (const child of zone.children) {
    ids.push(...getDescendantZoneIds(child));
  }
  return ids;
}

interface ZoneDetailProps {
  widget: DashboardWidget;
  zone: ZoneWithChildren | null;
  equipments: EquipmentWithDetails[];
  onClose: () => void;
}

export function ZoneDetailSheet({ widget, zone, equipments, onClose }: ZoneDetailProps) {
  const { t } = useTranslation();
  const label = widget.label || (zone ? `${zone.name}` : "");
  const family = widget.family;

  const zoneIds = useMemo(() => {
    if (!zone) return new Set<string>();
    return new Set(getDescendantZoneIds(zone));
  }, [zone]);

  const filteredEquipments = useMemo(() => {
    const types = family ? WIDGET_FAMILY_TYPES[family] ?? [] : [];
    return equipments.filter(
      (eq) => zoneIds.has(eq.zoneId) && types.includes(eq.type),
    );
  }, [equipments, zoneIds, family]);

  const [commandLoading, setCommandLoading] = useState<string | null>(null);

  const handleZoneCommand = useCallback(async (orderKey: string, value?: unknown) => {
    if (!widget.zoneId) return;
    setCommandLoading(orderKey);
    try {
      await executeZoneOrder(widget.zoneId, orderKey, value);
    } catch {
      // silent — user sees result via live updates
    } finally {
      setCommandLoading(null);
    }
  }, [widget.zoneId]);

  return (
    <BottomSheet open onClose={onClose} title={label}>
      {family === "lights" && (
        <ZoneLightsDetail
          equipments={filteredEquipments}
          commandLoading={commandLoading}
          onCommand={handleZoneCommand}
        />
      )}
      {family === "shutters" && (
        <ZoneShuttersDetail
          equipments={filteredEquipments}
          commandLoading={commandLoading}
          onCommand={handleZoneCommand}
        />
      )}
      {family === "heating" && (
        <ZoneHeatingDetail
          equipments={filteredEquipments}
          commandLoading={commandLoading}
          onCommand={handleZoneCommand}
        />
      )}
      {family === "sensors" && (
        <ZoneSensorsDetail equipments={filteredEquipments} />
      )}
      {filteredEquipments.length === 0 && (
        <p className="text-[13px] text-text-tertiary text-center py-4">
          {t("dashboard.noEquipments")}
        </p>
      )}
    </BottomSheet>
  );
}

// ============================================================
// Zone lights detail (mobile)
// ============================================================

function ZoneLightsDetail({
  equipments,
  commandLoading,
  onCommand,
}: {
  equipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();
  const slider = useSliderOverride();

  const { onCount, allDimmable, avgBrightness } = useMemo(() => {
    let on = 0;
    let dimmableCount = 0;
    const brightnessValues: number[] = [];
    for (const eq of equipments) {
      const stateBinding = eq.dataBindings.find((b) => b.category === "light_state");
      if (stateBinding) {
        const val = stateBinding.value;
        if (val === true || val === "ON" || val === 1) on++;
      }
      if (eq.type === "light_dimmable" || eq.type === "light_color") {
        dimmableCount++;
        const bb = eq.dataBindings.find((b) => b.category === "light_brightness");
        if (bb && typeof bb.value === "number") brightnessValues.push(bb.value);
      }
    }
    const avg = brightnessValues.length > 0
      ? Math.round(brightnessValues.reduce((a, b) => a + b, 0) / brightnessValues.length)
      : null;
    return {
      onCount: on,
      allDimmable: equipments.length > 0 && dimmableCount === equipments.length,
      avgBrightness: avg,
    };
  }, [equipments]);

  const anyOn = onCount > 0;
  const displayBrightness = slider.displayValue(avgBrightness);
  const brightnessPct = displayBrightness !== null ? Math.round((displayBrightness / 254) * 100) : null;

  const handleBrightnessCommit = () =>
    slider.onCommit((v) => {
      onCommand("allLightsBrightness", v);
      return Promise.resolve();
    });

  if (equipments.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <LightBulbIcon on={anyOn} />
      </div>

      <div className="text-center text-[13px] text-text-secondary">
        {onCount}/{equipments.length} {t("dashboard.family.lights").toLowerCase()}
      </div>

      {allDimmable && displayBrightness !== null && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={254}
            value={displayBrightness}
            onPointerDown={slider.onStart}
            onChange={(e) => slider.onChange(Number(e.target.value))}
            onMouseUp={handleBrightnessCommit}
            onTouchEnd={handleBrightnessCommit}
            className="flex-1 h-12 slider-active"
          />
          <span className="text-[18px] font-semibold text-text tabular-nums min-w-[40px] text-right">
            {brightnessPct}%
          </span>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => onCommand("allLightsOn")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
        >
          {commandLoading === "allLightsOn" ? <Loader2 size={18} className="animate-spin" /> : <Lightbulb size={18} strokeWidth={1.5} />}
          {t("zones.commands.allLightsOn")}
        </button>
        <button
          onClick={() => onCommand("allLightsOff")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
        >
          {commandLoading === "allLightsOff" ? <Loader2 size={18} className="animate-spin" /> : <LightbulbOff size={18} strokeWidth={1.5} />}
          {t("zones.commands.allLightsOff")}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Zone shutters detail (mobile)
// ============================================================

function ZoneShuttersDetail({
  equipments,
  commandLoading,
  onCommand,
}: {
  equipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();

  const avgPosition = useMemo(() => {
    const positions: number[] = [];
    for (const eq of equipments) {
      const binding = eq.dataBindings.find((b) => b.category === "shutter_position");
      if (binding && typeof binding.value === "number") positions.push(binding.value);
    }
    if (positions.length === 0) return null;
    return Math.round(positions.reduce((a, b) => a + b, 0) / positions.length);
  }, [equipments]);

  const level = avgPosition !== null ? shutterLevel(avgPosition) : null;

  if (equipments.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <ShutterWidgetIcon level={level} />
      </div>

      <div className="text-center text-[14px] font-medium text-text">
        {avgPosition === null
          ? "\u2014"
          : avgPosition === 100
            ? t("controls.opened")
            : avgPosition === 0
              ? t("controls.closed")
              : `${avgPosition}%`}
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onCommand("allShuttersOpen")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
        >
          {commandLoading === "allShuttersOpen" ? <Loader2 size={18} className="animate-spin" /> : <ChevronUp size={20} strokeWidth={2} />}
          {t("zones.commands.allShuttersOpen")}
        </button>
        <button
          onClick={() => onCommand("allShuttersStop")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
        >
          {commandLoading === "allShuttersStop" ? <Loader2 size={18} className="animate-spin" /> : <Square size={14} strokeWidth={2.5} />}
        </button>
        <button
          onClick={() => onCommand("allShuttersClose")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center gap-2 rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
        >
          {commandLoading === "allShuttersClose" ? <Loader2 size={18} className="animate-spin" /> : <ChevronDown size={20} strokeWidth={2} />}
          {t("zones.commands.allShuttersClose")}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Zone heating detail (mobile)
// ============================================================

function ZoneHeatingDetail({
  equipments,
  commandLoading,
  onCommand,
}: {
  equipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();
  const setpointOverride = useSliderOverride(5000);
  const SETPOINT_MIN = 16;
  const SETPOINT_MAX = 30;
  const STEP = 0.5;

  const { avgTemp, avgSetpoint, anyOn } = useMemo(() => {
    const temps: number[] = [];
    const setpoints: number[] = [];
    let on = false;
    for (const eq of equipments) {
      const tempBinding = eq.dataBindings.find((b) => b.alias === "temperature");
      if (tempBinding && typeof tempBinding.value === "number") temps.push(tempBinding.value);
      const spBinding = eq.dataBindings.find((b) => b.alias === "setpoint");
      if (spBinding && typeof spBinding.value === "number") setpoints.push(spBinding.value);
      const power = eq.dataBindings.find((b) => b.alias === "power");
      if (power?.value === true) on = true;
    }
    const avg = (arr: number[]) => arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return { avgTemp: avg(temps), avgSetpoint: avg(setpoints), anyOn: on };
  }, [equipments]);

  const displaySetpoint = setpointOverride.displayValue(avgSetpoint);
  const thermometerLevel = displaySetpoint !== null
    ? (displaySetpoint - SETPOINT_MIN) / (SETPOINT_MAX - SETPOINT_MIN)
    : undefined;

  const handleSetpoint = (newValue: number) => {
    setpointOverride.onStart();
    setpointOverride.onChange(newValue);
    setpointOverride.onCommit(async (v) => {
      onCommand("allThermostatsSetpoint", v);
    });
  };

  if (equipments.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center gap-6">
        <ThermometerIcon warm={anyOn} level={thermometerLevel} />
        <div className="flex flex-col items-center">
          {avgTemp !== null ? (
            <span className="text-[32px] font-semibold text-text tabular-nums font-mono leading-none">
              {avgTemp.toFixed(1)}°C
            </span>
          ) : (
            <span className="text-[32px] text-text-tertiary">{"\u2014"}</span>
          )}
        </div>
      </div>

      {displaySetpoint !== null && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => handleSetpoint(Math.max(SETPOINT_MIN, displaySetpoint - STEP))}
            disabled={displaySetpoint <= SETPOINT_MIN}
            className="w-14 h-14 flex items-center justify-center rounded-[8px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.95] disabled:opacity-30"
          >
            <Minus size={20} strokeWidth={2} />
          </button>
          <span className="text-[24px] font-semibold text-text tabular-nums font-mono min-w-[80px] text-center">
            {displaySetpoint.toFixed(1)}°C
          </span>
          <button
            onClick={() => handleSetpoint(Math.min(SETPOINT_MAX, displaySetpoint + STEP))}
            disabled={displaySetpoint >= SETPOINT_MAX}
            className="w-14 h-14 flex items-center justify-center rounded-[8px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.95] disabled:opacity-30"
          >
            <Plus size={20} strokeWidth={2} />
          </button>
        </div>
      )}

      <button
        onClick={() => onCommand(anyOn ? "allThermostatsPowerOff" : "allThermostatsPowerOn")}
        disabled={commandLoading !== null}
        className={`h-12 flex items-center justify-center gap-2 rounded-[6px] text-[14px] font-medium transition-all cursor-pointer ${
          anyOn
            ? "bg-error/10 text-error border border-error/30 hover:bg-error/20"
            : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
        }`}
      >
        {(commandLoading === "allThermostatsPowerOn" || commandLoading === "allThermostatsPowerOff")
          ? <Loader2 size={18} className="animate-spin" />
          : <Power size={18} strokeWidth={1.5} />}
        {anyOn ? t("controls.turnOff") : t("controls.turnOn")}
      </button>
    </div>
  );
}

// ============================================================
// Zone sensors detail (mobile)
// ============================================================

function ZoneSensorsDetail({ equipments }: { equipments: EquipmentWithDetails[] }) {
  const aggregates = useMemo(() => {
    const temps: number[] = [];
    const humidities: number[] = [];
    for (const eq of equipments) {
      for (const b of eq.dataBindings) {
        if (b.category === "temperature" && typeof b.value === "number") temps.push(b.value);
        if (b.category === "humidity" && typeof b.value === "number") humidities.push(b.value);
      }
    }
    const avg = (arr: number[]) => arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return { avgTemp: avg(temps), avgHumidity: avg(humidities) };
  }, [equipments]);

  if (equipments.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <MultiSensorIcon />
      </div>
      <div className="flex flex-col items-center gap-2">
        {aggregates.avgTemp !== null && (
          <div className="flex items-baseline gap-1">
            <span className="text-[28px] font-semibold text-text tabular-nums font-mono leading-none">
              {aggregates.avgTemp.toFixed(1)}
            </span>
            <span className="text-[14px] font-medium text-text-tertiary">°C</span>
          </div>
        )}
        {aggregates.avgHumidity !== null && (
          <div className="flex items-baseline gap-1">
            <span className="text-[22px] font-semibold text-text tabular-nums font-mono leading-none">
              {Math.round(aggregates.avgHumidity)}
            </span>
            <span className="text-[14px] font-medium text-text-tertiary">%</span>
          </div>
        )}
        {aggregates.avgTemp === null && aggregates.avgHumidity === null && (
          <span className="text-[18px] text-text-tertiary">{"\u2014"}</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Light detail content (dimmable)
// ============================================================

function LightDetailContent({
  equipment,
  onExecuteOrder,
}: {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
}) {
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

  const toggleBinding = equipment.orderBindings.find(
    (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
  );

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
    <div className="flex flex-col gap-6">
      {/* Icon centered */}
      <div className="flex justify-center">
        <LightBulbIcon on={isOn} />
      </div>

      {/* Brightness slider — full width horizontal */}
      {brightness !== null && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={254}
            value={brightness}
            onPointerDown={slider.onStart}
            onChange={(e) => slider.onChange(Number(e.target.value))}
            onMouseUp={handleBrightnessCommit}
            onTouchEnd={handleBrightnessCommit}
            className="flex-1 h-12 slider-active"
          />
          <span className="text-[18px] font-semibold text-text tabular-nums min-w-[40px] text-right">
            {brightnessPct}%
          </span>
        </div>
      )}

      {/* Toggle buttons */}
      {toggleBinding && equipment.enabled && (
        <div className="flex gap-3">
          <button
            onClick={handleToggle}
            disabled={executing}
            className={`flex-1 h-12 flex items-center justify-center gap-2 rounded-[6px] transition-all text-[14px] font-medium cursor-pointer ${
              isOn
                ? "bg-active/10 text-active-text border border-active/30"
                : "bg-border-light text-text-secondary border border-border hover:bg-border"
            }`}
          >
            {executing ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} strokeWidth={1.5} />}
            {isOn ? "ON" : "OFF"}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Shutter detail content
// ============================================================

function ShutterDetailContent({
  equipment,
  onExecuteOrder,
}: {
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
  const level = position !== null ? shutterLevel(position) : null;

  const hasState = equipment.orderBindings.some((ob) => ob.alias === "state");
  const hasPosition = equipment.orderBindings.some((ob) => ob.alias === "position");

  const handleCommand = async (command: "OPEN" | "STOP" | "CLOSE") => {
    if (executing || !hasState) return;
    setExecuting(true);
    try {
      await onExecuteOrder("state", command);
    } finally {
      setExecuting(false);
    }
  };

  const handlePositionCommit = () =>
    slider.onCommit((v) => onExecuteOrder("position", v));

  return (
    <div className="flex flex-col gap-6">
      {/* Icon centered */}
      <div className="flex justify-center">
        <ShutterWidgetIcon level={level} />
      </div>

      {/* Position slider — full width horizontal */}
      {position !== null && hasPosition && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={position}
            onPointerDown={slider.onStart}
            onChange={(e) => slider.onChange(Number(e.target.value))}
            onMouseUp={handlePositionCommit}
            onTouchEnd={handlePositionCommit}
            className="flex-1 h-12"
          />
          <span className="text-[18px] font-semibold text-text tabular-nums min-w-[40px] text-right">
            {position === 100 ? t("controls.opened") : position === 0 ? t("controls.closed") : `${position}%`}
          </span>
        </div>
      )}

      {/* Action buttons — full width */}
      {hasState && equipment.enabled && (
        <div className="flex gap-3">
          <button
            onClick={() => handleCommand("OPEN")}
            disabled={executing}
            className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          >
            <ChevronUp size={20} strokeWidth={2} />
          </button>
          <button
            onClick={() => handleCommand("STOP")}
            disabled={executing}
            className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          >
            <Square size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => handleCommand("CLOSE")}
            disabled={executing}
            className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          >
            <ChevronDown size={20} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Thermostat detail content
// ============================================================

function ThermostatDetailContent({
  equipment,
  onExecuteOrder,
}: {
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
    <div className="flex flex-col gap-6">
      {/* Thermometer + current temp */}
      <div className="flex items-center justify-center gap-6">
        <ThermometerIcon warm={isOn} level={thermometerLevel} />
        <div className="flex flex-col items-center">
          {insideTemp !== null ? (
            <span className="text-[32px] font-semibold text-text tabular-nums font-mono leading-none">
              {insideTemp.toFixed(1)}°C
            </span>
          ) : (
            <span className="text-[32px] text-text-tertiary">{"\u2014"}</span>
          )}
        </div>
      </div>

      {/* Setpoint controls — large */}
      {targetTempOrder && displaySetpoint !== null && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => handleSetpoint(Math.max(targetMin, displaySetpoint - STEP))}
            disabled={displaySetpoint <= targetMin}
            className="w-14 h-14 flex items-center justify-center rounded-[8px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.95] disabled:opacity-30"
          >
            <Minus size={20} strokeWidth={2} />
          </button>
          <span className="text-[24px] font-semibold text-text tabular-nums font-mono min-w-[80px] text-center">
            {displaySetpoint.toFixed(1)}°C
          </span>
          <button
            onClick={() => handleSetpoint(Math.min(targetMax, displaySetpoint + STEP))}
            disabled={displaySetpoint >= targetMax}
            className="w-14 h-14 flex items-center justify-center rounded-[8px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.95] disabled:opacity-30"
          >
            <Plus size={20} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Power toggle */}
      {hasPowerOrder && equipment.enabled && (
        <button
          onClick={() => exec("power", !isOn)}
          disabled={executing === "power"}
          className={`h-12 flex items-center justify-center gap-2 rounded-[6px] text-[14px] font-medium transition-all cursor-pointer ${
            isOn
              ? "bg-error/10 text-error border border-error/30 hover:bg-error/20"
              : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
          }`}
        >
          {executing === "power"
            ? <Loader2 size={18} className="animate-spin" />
            : <Power size={18} strokeWidth={1.5} />}
          {isOn ? t("controls.turnOff") : t("controls.turnOn")}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Heater detail content
// ============================================================

function HeaterDetailContent({
  equipment,
  onExecuteOrder,
}: {
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
    <div className="flex flex-col gap-6">
      {/* Icon centered */}
      <div className="flex justify-center">
        <HeaterWidgetIcon comfort={isComfort} />
      </div>

      {/* Mode display */}
      <div className="flex justify-center">
        <span
          className={`text-[14px] font-medium px-4 py-2 rounded-full ${
            isComfort
              ? "bg-error/10 text-error"
              : "bg-primary/10 text-primary"
          }`}
        >
          {isComfort ? t("controls.heater.comfort") : t("controls.heater.eco")}
        </span>
      </div>

      {/* Toggle button */}
      {toggleBinding && equipment.enabled && (
        <button
          onClick={handleToggle}
          disabled={executing}
          className={`h-12 flex items-center justify-center gap-2 rounded-[6px] text-[14px] font-medium transition-all cursor-pointer border ${
            isComfort
              ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
              : "bg-error/10 text-error border-error/30 hover:bg-error/20"
          }`}
        >
          {executing
            ? <Loader2 size={18} className="animate-spin" />
            : isComfort
              ? <Snowflake size={18} strokeWidth={1.5} />
              : <Flame size={18} strokeWidth={1.5} />}
          {isComfort ? t("controls.heater.switchEco") : t("controls.heater.switchComfort")}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Gate detail content (multi-action gates)
// ============================================================

const GATE_ICON_MAP: Record<string, typeof GateWidgetIcon> = {
  gate: GateWidgetIcon,
  sliding_gate: SlidingGateIcon,
  garage_door: GarageDoorIcon,
};

function GateDetailContent({
  equipment,
  onExecuteOrder,
  iconKey,
}: {
  equipment: EquipmentWithDetails;
  onExecuteOrder: (alias: string, value: unknown) => Promise<void>;
  iconKey?: string;
}) {
  const { t } = useTranslation();
  const [executing, setExecuting] = useState<string | null>(null);

  const stateBinding = equipment.dataBindings.find(
    (db) => db.alias === "state" && db.category === "gate_state",
  );
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const isOpen = gateState === "open";

  const commandBinding = equipment.orderBindings.find((ob) => ob.alias === "command");
  const enumValues = commandBinding?.enumValues ?? [];

  const handleCommand = async (value: string | null) => {
    if (executing || !commandBinding) return;
    const key = value ?? "command";
    setExecuting(key);
    try {
      await onExecuteOrder("command", value);
    } finally {
      setExecuting(null);
    }
  };

  const IconComp = (iconKey && GATE_ICON_MAP[iconKey]) || GateWidgetIcon;

  return (
    <div className="flex flex-col gap-6">
      {/* Icon centered */}
      <div className="flex justify-center">
        <IconComp open={isOpen} />
      </div>

      {/* State */}
      <div className="flex justify-center">
        <span
          className={`text-[14px] font-medium px-4 py-2 rounded-full ${
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

      {/* Command buttons */}
      {commandBinding && equipment.enabled && (
        <div className="flex flex-col gap-2">
          {enumValues.length > 1 ? (
            enumValues.map((val) => (
              <button
                key={val}
                onClick={() => handleCommand(val)}
                disabled={executing !== null}
                className="h-12 flex items-center justify-center gap-2 rounded-[6px] text-[14px] font-medium transition-all cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40"
              >
                {executing === val ? <Loader2 size={18} className="animate-spin" /> : null}
                {val}
              </button>
            ))
          ) : (
            <button
              onClick={() => handleCommand(null)}
              disabled={executing !== null}
              className="h-12 flex items-center justify-center gap-2 rounded-[6px] text-[14px] font-medium transition-all cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40"
            >
              {executing ? <Loader2 size={18} className="animate-spin" /> : null}
              {t("controls.gate.command")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sensor detail content
// ============================================================

function SensorDetailContent({
  equipment,
  visibleBindings,
}: {
  equipment: EquipmentWithDetails;
  visibleBindings?: string[];
}) {
  const { sensorBindings, batteryBindings } = useEquipmentState(equipment);

  const filteredBindings = visibleBindings && visibleBindings.length > 0
    ? visibleBindings.map((alias) => sensorBindings.find((b) => b.alias === alias)).filter((b): b is typeof sensorBindings[number] => !!b)
    : sensorBindings;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <MultiSensorIcon />
      </div>
      <SensorValues sensorBindings={filteredBindings} batteryBindings={batteryBindings} layout="column" />
    </div>
  );
}


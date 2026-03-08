import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Lightbulb,
  LightbulbOff,
  ChevronUp,
  Square,
  ChevronDown,
  Minus,
  Plus,
  Power,
} from "lucide-react";
import type { DashboardWidget, EquipmentWithDetails, ZoneWithChildren, WidgetFamily } from "../../types";
import { executeZoneOrder } from "../../api";
import { useSliderOverride } from "../../hooks/useSliderOverride";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  shutterLevel,
  ThermometerIcon,
  MultiSensorIcon,
} from "./WidgetIcons";


const WIDGET_FAMILY_TYPES: Record<WidgetFamily, string[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
};

interface ZoneWidgetProps {
  widget: DashboardWidget;
  zone: ZoneWithChildren | null;
  equipments: EquipmentWithDetails[];
}

function getDescendantZoneIds(zone: ZoneWithChildren): string[] {
  const ids = [zone.id];
  for (const child of zone.children) {
    ids.push(...getDescendantZoneIds(child));
  }
  return ids;
}

export function ZoneWidget({ widget, zone, equipments }: ZoneWidgetProps) {
  const { t } = useTranslation();
  const [commandLoading, setCommandLoading] = useState<string | null>(null);

  const family = widget.family!;
  const familyTypes = WIDGET_FAMILY_TYPES[family];

  const zoneIds = useMemo(() => {
    if (!zone) return new Set<string>();
    return new Set(getDescendantZoneIds(zone));
  }, [zone]);

  const filteredEquipments = useMemo(() => {
    return equipments.filter(
      (eq) => zoneIds.has(eq.zoneId) && familyTypes.includes(eq.type),
    );
  }, [equipments, zoneIds, familyTypes]);

  const zoneName = zone?.name ?? t("dashboard.unknownZone");
  const familyLabel = t(`dashboard.family.${family}`);
  const label = widget.label || zoneName;

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

  if (family === "shutters") {
    return (
      <ZoneShutterWidget
        label={label}
        filteredEquipments={filteredEquipments}
        commandLoading={commandLoading}
        onCommand={handleZoneCommand}
      />
    );
  }

  if (family === "lights") {
    return (
      <ZoneLightsWidget
        label={label}
        filteredEquipments={filteredEquipments}
        commandLoading={commandLoading}
        onCommand={handleZoneCommand}
      />
    );
  }

  if (family === "heating") {
    return (
      <ZoneHeatingWidget
        label={label}
        filteredEquipments={filteredEquipments}
        commandLoading={commandLoading}
        onCommand={handleZoneCommand}
      />
    );
  }

  if (family === "sensors") {
    return (
      <ZoneSensorsWidget
        label={label}
        filteredEquipments={filteredEquipments}
      />
    );
  }

  return null;
}

// ============================================================
// Shared zone widget card shell
// ============================================================

function ZoneWidgetCard({ label, children, empty }: { label: string; children: React.ReactNode; empty?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col h-[240px] overflow-hidden">
      <span className="text-[17px] font-semibold text-text truncate mb-2 text-center">{label}</span>
      {empty ? (
        <span className="text-[12px] text-text-tertiary text-center">{t("dashboard.noEquipments")}</span>
      ) : (
        children
      )}
    </div>
  );
}

// ============================================================
// Lights zone widget
// ============================================================

function ZoneLightsWidget({
  label,
  filteredEquipments,
  commandLoading,
  onCommand,
}: {
  label: string;
  filteredEquipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();
  const slider = useSliderOverride();

  const { onCount, allDimmable, avgBrightness } = useMemo(() => {
    let on = 0;
    let dimmableCount = 0;
    const brightnessValues: number[] = [];

    for (const eq of filteredEquipments) {
      const stateBinding = eq.dataBindings.find((b) => b.category === "light_state");
      if (stateBinding) {
        const val = stateBinding.value;
        if (val === true || val === "ON" || val === 1) on++;
      }
      if (eq.type === "light_dimmable" || eq.type === "light_color") {
        dimmableCount++;
        const brightnessBinding = eq.dataBindings.find((b) => b.category === "light_brightness");
        if (brightnessBinding && typeof brightnessBinding.value === "number") {
          brightnessValues.push(brightnessBinding.value);
        }
      }
    }

    const avg = brightnessValues.length > 0
      ? Math.round(brightnessValues.reduce((a, b) => a + b, 0) / brightnessValues.length)
      : null;

    return {
      onCount: on,
      allDimmable: filteredEquipments.length > 0 && dimmableCount === filteredEquipments.length,
      avgBrightness: avg,
    };
  }, [filteredEquipments]);

  const anyOn = onCount > 0;
  const displayBrightness = slider.displayValue(avgBrightness);
  const brightnessPct = displayBrightness !== null ? Math.round((displayBrightness / 254) * 100) : null;

  const handleBrightnessCommit = () =>
    slider.onCommit((v) => {
      onCommand("allLightsBrightness", v);
      return Promise.resolve();
    });

  return (
    <ZoneWidgetCard label={label} empty={filteredEquipments.length === 0}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <LightBulbIcon on={anyOn} />
        <div className="flex items-center gap-2 pl-2">
          {allDimmable && displayBrightness !== null ? (
            <>
              <input
                type="range"
                min={0}
                max={254}
                value={displayBrightness}
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
            <span className="text-[13px] font-medium text-text-secondary">
              {onCount}/{filteredEquipments.length}
            </span>
          )}
        </div>
      </div>

      {/* Zone 3: Bouton */}
      <div className="flex justify-center gap-3 mt-auto pt-1">
        <button
          onClick={() => onCommand("allLightsOn")}
          disabled={commandLoading !== null}
          className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("zones.commands.allLightsOn")}
        >
          {commandLoading === "allLightsOn" ? <Loader2 size={16} className="animate-spin" /> : <Lightbulb size={16} strokeWidth={1.5} />}
        </button>
        <button
          onClick={() => onCommand("allLightsOff")}
          disabled={commandLoading !== null}
          className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-text-tertiary hover:text-text hover:bg-border-light active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("zones.commands.allLightsOff")}
        >
          {commandLoading === "allLightsOff" ? <Loader2 size={16} className="animate-spin" /> : <LightbulbOff size={16} strokeWidth={1.5} />}
        </button>
      </div>
    </ZoneWidgetCard>
  );
}

// ============================================================
// Shutter zone widget
// ============================================================

function ZoneShutterWidget({
  label,
  filteredEquipments,
  commandLoading,
  onCommand,
}: {
  label: string;
  filteredEquipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();

  const avgPosition = useMemo(() => {
    const positions: number[] = [];
    for (const eq of filteredEquipments) {
      const binding = eq.dataBindings.find((b) => b.category === "shutter_position");
      if (binding && typeof binding.value === "number") {
        positions.push(binding.value);
      }
    }
    if (positions.length === 0) return null;
    return Math.round(positions.reduce((a, b) => a + b, 0) / positions.length);
  }, [filteredEquipments]);

  const level = avgPosition !== null ? shutterLevel(avgPosition) : null;

  return (
    <ZoneWidgetCard label={label} empty={filteredEquipments.length === 0}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <ShutterWidgetIcon level={level} />
        <div className="pl-2">
          {avgPosition === null ? (
            <span className="text-[16px] text-text-tertiary">{"\u2014"}</span>
          ) : avgPosition === 100 ? (
            <span className="text-[13px] font-medium text-success px-2 py-0.5 rounded bg-success/10">{t("controls.opened")}</span>
          ) : avgPosition === 0 ? (
            <span className="text-[13px] font-medium text-text-secondary px-2 py-0.5 rounded bg-border-light">{t("controls.closed")}</span>
          ) : (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[16px] font-semibold text-text tabular-nums leading-none">{avgPosition}</span>
              <span className="text-[12px] font-medium text-text-tertiary">%</span>
            </div>
          )}
        </div>
      </div>

      {/* Zone 3: Bouton */}
      <div className="flex justify-center gap-3 mt-auto pt-1">
        <button
          onClick={() => onCommand("allShuttersOpen")}
          disabled={commandLoading !== null}
          className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("zones.commands.allShuttersOpen")}
        >
          {commandLoading === "allShuttersOpen" ? <Loader2 size={16} className="animate-spin" /> : <ChevronUp size={16} strokeWidth={2} />}
        </button>
        <button
          onClick={() => onCommand("allShuttersStop")}
          disabled={commandLoading !== null}
          className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-text-tertiary hover:text-text hover:bg-border-light active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("zones.commands.allShuttersStop")}
        >
          {commandLoading === "allShuttersStop" ? <Loader2 size={16} className="animate-spin" /> : <Square size={11} strokeWidth={2.5} />}
        </button>
        <button
          onClick={() => onCommand("allShuttersClose")}
          disabled={commandLoading !== null}
          className="w-10 h-10 flex items-center justify-center rounded-[6px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-primary hover:bg-primary/5 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("zones.commands.allShuttersClose")}
        >
          {commandLoading === "allShuttersClose" ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} strokeWidth={2} />}
        </button>
      </div>
    </ZoneWidgetCard>
  );
}

// ============================================================
// Heating zone widget — thermometer icon + avg temperature
// ============================================================

function ZoneHeatingWidget({
  label,
  filteredEquipments,
  commandLoading,
  onCommand,
}: {
  label: string;
  filteredEquipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();
  const setpointOverride = useSliderOverride(5000);

  const SETPOINT_MIN = 16;
  const SETPOINT_MAX = 30;
  const SETPOINT_STEP = 0.5;

  const { avgTemp, avgSetpoint, anyOn } = useMemo(() => {
    const temps: number[] = [];
    const setpoints: number[] = [];
    let on = false;

    for (const eq of filteredEquipments) {
      const tempBinding = eq.dataBindings.find((b) => b.alias === "temperature");
      if (tempBinding && typeof tempBinding.value === "number") {
        temps.push(tempBinding.value);
      }
      const spBinding = eq.dataBindings.find((b) => b.alias === "setpoint");
      if (spBinding && typeof spBinding.value === "number") {
        setpoints.push(spBinding.value);
      }
      const power = eq.dataBindings.find((b) => b.alias === "power");
      if (power?.value === true) on = true;
      if (!power) {
        const state = eq.dataBindings.find((b) => b.alias === "state" || b.category === "light_state");
        if (state != null) on = true;
      }
    }

    const avg = (arr: number[]) => arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : null;

    return { avgTemp: avg(temps), avgSetpoint: avg(setpoints), anyOn: on };
  }, [filteredEquipments]);

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

  return (
    <ZoneWidgetCard label={label} empty={filteredEquipments.length === 0}>
      {/* Zone 2: Picto + temp + power */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <ThermometerIcon warm={anyOn} level={thermometerLevel} />
        <div className="flex flex-col items-start gap-2 pl-2">
          {avgTemp !== null ? (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[18px] font-semibold text-text tabular-nums leading-none font-mono">
                {avgTemp.toFixed(1)}
              </span>
              <span className="text-[12px] font-medium text-text-tertiary">°C</span>
            </div>
          ) : (
            <span className="text-[18px] text-text-tertiary">{"\u2014"}</span>
          )}
          <button
            onClick={() => onCommand(anyOn ? "allThermostatsPowerOff" : "allThermostatsPowerOn")}
            disabled={commandLoading !== null}
            className={`w-7 h-7 flex items-center justify-center rounded-[5px] transition-all duration-150 cursor-pointer border border-border bg-surface text-text-secondary active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
              anyOn
                ? "!border-error/40 !text-error !bg-error/5 hover:!bg-error/10"
                : "hover:border-primary/40 hover:text-primary hover:bg-primary/5"
            }`}
            title={anyOn ? t("controls.turnOff") : t("controls.turnOn")}
          >
            {commandLoading === "allThermostatsPowerOn" || commandLoading === "allThermostatsPowerOff"
              ? <Loader2 size={14} className="animate-spin" />
              : <Power size={14} strokeWidth={1.5} />
            }
          </button>
        </div>
      </div>

      {/* Zone 3: Setpoint controls */}
      {displaySetpoint !== null && (
        <div className="flex items-center justify-center gap-2 mt-auto pt-1">
          <button
            onClick={() => handleSetpoint(Math.max(SETPOINT_MIN, displaySetpoint - SETPOINT_STEP))}
            disabled={displaySetpoint <= SETPOINT_MIN}
            className="w-8 h-8 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer border border-border bg-surface text-text-tertiary hover:bg-border-light hover:text-text-secondary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Minus size={14} strokeWidth={2} />
          </button>
          <span className="text-[12px] font-medium text-text-secondary tabular-nums font-mono min-w-[42px] text-center">
            {displaySetpoint.toFixed(1)}°C
          </span>
          <button
            onClick={() => handleSetpoint(Math.min(SETPOINT_MAX, displaySetpoint + SETPOINT_STEP))}
            disabled={displaySetpoint >= SETPOINT_MAX}
            className="w-8 h-8 flex items-center justify-center rounded-[5px] transition-colors cursor-pointer border border-border bg-surface text-text-tertiary hover:bg-border-light hover:text-text-secondary active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </div>
      )}
    </ZoneWidgetCard>
  );
}

// ============================================================
// Sensors zone widget — gauge icon + primary values
// ============================================================

function ZoneSensorsWidget({
  label,
  filteredEquipments,
}: {
  label: string;
  filteredEquipments: EquipmentWithDetails[];
}) {
  // Aggregate key sensor values: avg temperature, avg humidity
  const aggregates = useMemo(() => {
    const temps: number[] = [];
    const humidities: number[] = [];

    for (const eq of filteredEquipments) {
      for (const b of eq.dataBindings) {
        if (b.category === "temperature" && typeof b.value === "number") {
          temps.push(b.value);
        }
        if (b.category === "humidity" && typeof b.value === "number") {
          humidities.push(b.value);
        }
      }
    }

    const avg = (arr: number[]) => arr.length > 0
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : null;

    return {
      avgTemp: avg(temps),
      avgHumidity: avg(humidities),
    };
  }, [filteredEquipments]);

  return (
    <ZoneWidgetCard label={label} empty={filteredEquipments.length === 0}>
      {/* Zone 2: Picto + État horizontal */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center h-[104px] my-auto">
        <div />
        <MultiSensorIcon />
        <div className="flex flex-col items-start gap-1 pl-2">
          {aggregates.avgTemp !== null && (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[18px] font-semibold text-text tabular-nums leading-none font-mono">
                {aggregates.avgTemp.toFixed(1)}
              </span>
              <span className="text-[12px] font-medium text-text-tertiary">°C</span>
            </div>
          )}
          {aggregates.avgHumidity !== null && (
            <div className="flex items-baseline gap-0.5">
              <span className="text-[14px] font-semibold text-text tabular-nums leading-none font-mono">
                {Math.round(aggregates.avgHumidity)}
              </span>
              <span className="text-[12px] font-medium text-text-tertiary">%</span>
            </div>
          )}
          {aggregates.avgTemp === null && aggregates.avgHumidity === null && (
            <span className="text-[18px] text-text-tertiary">{"\u2014"}</span>
          )}
        </div>
      </div>
    </ZoneWidgetCard>
  );
}

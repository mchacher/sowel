import { useState, useMemo, useCallback, createElement } from "react";
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
  Lightbulb,
  LightbulbOff,
  CloudRain,
  Wind,
  Thermometer,
} from "lucide-react";
import type {
  DashboardWidget,
  DataBindingWithValue,
  EquipmentWithDetails,
  ZoneWithChildren,
} from "../../types";
import { executeZoneOrder } from "../../api";
import { useEquipmentState } from "../equipments/useEquipmentState";
import { findOrderByCategory } from "../equipments/bindingUtils";
import { allSupportStop } from "../../lib/binding-utils";
import { useSliderOverride } from "../../hooks/useSliderOverride";
import { SensorValues } from "../equipments/SensorValues";
import {
  formatSensorValue,
  getBatteryColor,
  getBatteryIcon,
  SENSOR_DATA_CATEGORIES,
} from "../equipments/sensorUtils";
import { syntheticBindingFromComputed } from "../equipments/weather-utils";
import {
  LightBulbIcon,
  ShutterWidgetIcon,
  AwningWidgetIcon,
  ThermometerIcon,
  MultiSensorIcon,
  HeaterWidgetIcon,
  GateWidgetIcon,
  SlidingGateIcon,
  GarageDoorIcon,
  PoolCoverIcon,
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
  const { isLight, isShutter, isAwning, isThermostat, isHeater, isSensor, isGate, isPoolHeatPump } = useEquipmentState(equipment);
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

  if (isShutter || isAwning || equipment.type === "pool_cover") {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <ShutterDetailContent equipment={equipment} onExecuteOrder={execOrder} />
      </BottomSheet>
    );
  }

  if (isThermostat || isPoolHeatPump) {
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

  if (equipment.type === "weather") {
    return (
      <BottomSheet open onClose={onClose} title={label}
        icon={customEntry ? <div className="scale-[0.35]">{createElement(customEntry.component, customEntry.previewProps)}</div> : undefined}
      >
        <WeatherDetailContent equipment={equipment} />
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
// Weather station detail (mobile bottom sheet)
// ============================================================

/** i18n key for each weather-specific binding key (mirrors WeatherPanel.KEY_LABELS). */
const WEATHER_KEY_LABELS: Record<string, string> = {
  temperature: "category.temperature",
  humidity: "category.humidity",
  pressure: "category.pressure",
  wind_strength: "weather.windSpeed",
  wind_angle: "weather.windDirection",
  gust_strength: "weather.gustSpeed",
  gust_angle: "weather.gustDirection",
  rain: "weather.rainCurrent",
  sum_rain_1: "weather.rain1h",
  sum_rain_24: "weather.rain24h",
  // Sowel-computed cumulative rain (alias differs from the Netatmo native bindings).
  rain_1h: "weather.rain1h",
  rain_24h: "weather.rain24h",
  noise: "category.noise",
  co2: "category.co2",
};

/** Display order for the weather binding list (most useful values first). */
const WEATHER_KEY_ORDER = [
  "temperature",
  "humidity",
  "rain_24h",
  "rain_1h",
  "sum_rain_24",
  "sum_rain_1",
  "wind_strength",
  "gust_strength",
  "wind_angle",
  "gust_angle",
  "pressure",
  "co2",
  "noise",
];

/**
 * Weather binding keys explicitly hidden from the mobile bottom sheet.
 * The instantaneous rain rate (mm/h) is noise compared to the 24h cumulative,
 * which is the value people actually act on.
 */
const WEATHER_KEY_HIDDEN = new Set(["rain"]);

/** Computed-data aliases surfaced on weather equipments (in addition to dataBindings). */
const WEATHER_COMPUTED_ALIASES = ["rain_24h", "rain_1h"];

/** Maps a computed alias to the binding key it should pretend to be. */
const COMPUTED_RAIN_TO_KEY: Record<string, string> = {
  rain_24h: "sum_rain_24",
  rain_1h: "sum_rain_1",
};

type WeatherKind = "outdoor" | "indoor" | "wind" | "rain";

/** Classify a device by the categories its bindings expose. */
function detectWeatherKind(bindings: readonly DataBindingWithValue[]): WeatherKind {
  const cats = new Set(bindings.map((b) => b.category));
  if (cats.has("wind")) return "wind";
  if (cats.has("rain")) return "rain";
  if (cats.has("temperature_outdoor") || cats.has("humidity_outdoor")) return "outdoor";
  return "indoor";
}

const KIND_SORT: Record<WeatherKind, number> = { outdoor: 0, indoor: 1, wind: 2, rain: 3 };

function getKindIcon(kind: WeatherKind) {
  switch (kind) {
    case "wind":
      return <Wind size={16} strokeWidth={1.5} />;
    case "rain":
      return <CloudRain size={16} strokeWidth={1.5} />;
    case "outdoor":
    case "indoor":
      return <Thermometer size={16} strokeWidth={1.5} />;
  }
}

function WeatherDetailContent({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t } = useTranslation();

  // Group sensor bindings by physical device. Mirrors the layout used in
  // the equipment detail page (WeatherPanel) so a user who knows that view
  // gets the same mental model here, just rendered as compact sections
  // instead of card grid.
  const sensorBindings = equipment.dataBindings.filter(
    (b) =>
      SENSOR_DATA_CATEGORIES.includes(b.category) &&
      b.category !== "battery" &&
      !WEATHER_KEY_HIDDEN.has(b.key),
  );

  interface DeviceGroup {
    deviceName: string;
    bindings: DataBindingWithValue[];
    battery: DataBindingWithValue | null;
  }
  const byDevice = new Map<string, DeviceGroup>();
  for (const b of sensorBindings) {
    let g = byDevice.get(b.deviceId);
    if (!g) {
      g = { deviceName: b.deviceName, bindings: [], battery: null };
      byDevice.set(b.deviceId, g);
    }
    g.bindings.push(b);
  }
  // Attach one battery per device group
  for (const bat of equipment.dataBindings.filter((b) => b.category === "battery")) {
    const g = byDevice.get(bat.deviceId);
    if (g) g.battery = bat;
  }

  // Inject synthetic rain rows from computedData (rain_24h / rain_1h) so the
  // sheet still surfaces cumulative rain even when only the bare instantaneous
  // `rain` binding is attached. Attach to the existing rain device if any,
  // otherwise create a virtual "Pluviomètre" group.
  const rainHost = sensorBindings.find((b) => b.category === "rain");
  const rainDeviceId = rainHost?.deviceId ?? "computed-rain";
  const rainDeviceName = rainHost?.deviceName ?? t("weather.rainCurrent");
  const existingRainKeys = new Set(
    (byDevice.get(rainDeviceId)?.bindings ?? []).map((b) => b.key),
  );
  for (const c of (equipment.computedData ?? []).filter((c) =>
    WEATHER_COMPUTED_ALIASES.includes(c.alias),
  )) {
    const targetKey = COMPUTED_RAIN_TO_KEY[c.alias];
    if (!targetKey || existingRainKeys.has(targetKey)) continue;
    const synthetic = syntheticBindingFromComputed(equipment.id, c, {
      key: targetKey,
      deviceId: rainDeviceId,
      deviceName: rainDeviceName,
    });
    let g = byDevice.get(rainDeviceId);
    if (!g) {
      g = { deviceName: rainDeviceName, bindings: [], battery: null };
      byDevice.set(rainDeviceId, g);
    }
    g.bindings.push(synthetic);
    existingRainKeys.add(targetKey);
  }

  // Order rows within each device by WEATHER_KEY_ORDER.
  const sortBindings = (a: DataBindingWithValue, b: DataBindingWithValue): number => {
    const ia = WEATHER_KEY_ORDER.indexOf(a.key);
    const ib = WEATHER_KEY_ORDER.indexOf(b.key);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.key.localeCompare(b.key);
  };

  // Sort devices: outdoor first (matches compact widget), indoor next,
  // then wind, then rain. Empty groups are dropped silently.
  const devices = [...byDevice.entries()]
    .filter(([, g]) => g.bindings.length > 0)
    .map(([id, g]) => ({
      id,
      deviceName: g.deviceName,
      bindings: [...g.bindings].sort(sortBindings),
      battery: g.battery,
      kind: detectWeatherKind(g.bindings),
    }))
    .sort((a, b) => KIND_SORT[a.kind] - KIND_SORT[b.kind]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-[10px] flex items-center justify-center bg-primary-light text-primary">
          <CloudRain size={28} strokeWidth={1.5} />
        </div>
      </div>
      <div className="space-y-3">
        {devices.map((dev) => {
          const batteryLevel =
            dev.battery && typeof dev.battery.value === "number"
              ? dev.battery.value
              : null;
          return (
            <div
              key={dev.id}
              className="rounded-[8px] border border-border-light overflow-hidden"
            >
              <div className="bg-border-light/40 px-3 py-2 flex items-center gap-2">
                <span className="text-text-tertiary">{getKindIcon(dev.kind)}</span>
                <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary flex-1 min-w-0 truncate">
                  {dev.deviceName}
                </span>
                {dev.battery && (
                  <span
                    className={`flex items-center gap-1 flex-shrink-0 ${getBatteryColor(batteryLevel)}`}
                  >
                    {getBatteryIcon(batteryLevel, 13, 1.5)}
                    <span className="text-[11px] tabular-nums">
                      {batteryLevel !== null ? `${batteryLevel}%` : "?"}
                    </span>
                  </span>
                )}
              </div>
              <div className="divide-y divide-border-light">
                {dev.bindings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-baseline justify-between px-3 py-2"
                  >
                    <span className="text-[13px] text-text-secondary">
                      {WEATHER_KEY_LABELS[b.key] ? t(WEATHER_KEY_LABELS[b.key]) : b.key}
                    </span>
                    <span className="text-[14px] font-mono font-semibold text-text tabular-nums">
                      {formatSensorValue(b.value, undefined, t)}
                      {b.unit && (
                        <span className="text-text-tertiary font-normal text-[12px] ml-1">
                          {b.unit}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Zone detail sheet
// ============================================================

const WIDGET_FAMILY_TYPES: Record<string, string[]> = {
  lights: ["light_onoff", "light_dimmable", "light_color"],
  shutters: ["shutter"],
  awnings: ["awning"],
  heating: ["thermostat", "heater"],
  sensors: ["sensor"],
  water: ["water_valve", "water_heater"],
  pool: ["pool_pump", "pool_cover", "pool_heat_pump"],
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
  /** Path-aware zone label (spec 139), preferred over the bare zone name. */
  zoneLabel?: string;
  equipments: EquipmentWithDetails[];
  onClose: () => void;
}

export function ZoneDetailSheet({ widget, zone, zoneLabel, equipments, onClose }: ZoneDetailProps) {
  const { t } = useTranslation();
  const label = widget.label || zoneLabel || (zone ? `${zone.name}` : "");
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
      {family === "awnings" && (
        <ZoneAwningsDetail
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
  const hasStop = useMemo(() => allSupportStop(equipments), [equipments]);

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
          className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          title={t("zones.commands.allShuttersOpen")}
        >
          {commandLoading === "allShuttersOpen" ? <Loader2 size={18} className="animate-spin" /> : <ChevronUp size={20} strokeWidth={2} />}
        </button>
        {hasStop && (
          <button
            onClick={() => onCommand("allShuttersStop")}
            disabled={commandLoading !== null}
            className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
            title={t("zones.commands.allShuttersStop")}
          >
            {commandLoading === "allShuttersStop" ? <Loader2 size={18} className="animate-spin" /> : <Square size={14} strokeWidth={2.5} />}
          </button>
        )}
        <button
          onClick={() => onCommand("allShuttersClose")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          title={t("zones.commands.allShuttersClose")}
        >
          {commandLoading === "allShuttersClose" ? <Loader2 size={18} className="animate-spin" /> : <ChevronDown size={20} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Zone awnings detail (mobile)
// ============================================================

function ZoneAwningsDetail({
  equipments,
  commandLoading,
  onCommand,
}: {
  equipments: EquipmentWithDetails[];
  commandLoading: string | null;
  onCommand: (orderKey: string, value?: unknown) => void;
}) {
  const { t } = useTranslation();

  const { deployedCount, total } = useMemo(() => {
    let deployed = 0;
    for (const eq of equipments) {
      const b = eq.dataBindings.find((d) => d.category === "shutter_position");
      if (b && typeof b.value === "number" && b.value > 0) deployed += 1;
    }
    return { deployedCount: deployed, total: equipments.length };
  }, [equipments]);
  const hasStop = useMemo(() => allSupportStop(equipments), [equipments]);

  if (total === 0) return null;

  const stateText =
    deployedCount === total
      ? t("controls.deployed")
      : deployedCount === 0
        ? t("controls.retracted")
        : `${deployedCount}/${total}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <AwningWidgetIcon deployed={deployedCount > 0} />
      </div>

      <div className="text-center text-[14px] font-medium text-text">{stateText}</div>

      <div className="flex gap-3">
        <button
          onClick={() => onCommand("allAwningsRetract")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          title={t("zones.commands.allAwningsRetract")}
        >
          {commandLoading === "allAwningsRetract" ? <Loader2 size={18} className="animate-spin" /> : <ChevronUp size={20} strokeWidth={2} />}
        </button>
        {hasStop && (
          <button
            onClick={() => onCommand("allAwningsStop")}
            disabled={commandLoading !== null}
            className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
            title={t("zones.commands.allAwningsStop")}
          >
            {commandLoading === "allAwningsStop" ? <Loader2 size={18} className="animate-spin" /> : <Square size={14} strokeWidth={2.5} />}
          </button>
        )}
        <button
          onClick={() => onCommand("allAwningsExtend")}
          disabled={commandLoading !== null}
          className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
          title={t("zones.commands.allAwningsExtend")}
        >
          {commandLoading === "allAwningsExtend" ? <Loader2 size={18} className="animate-spin" /> : <ChevronDown size={20} strokeWidth={2} />}
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

  // Category-first resolver — see spec 110.
  const toggleBinding =
    findOrderByCategory(equipment.orderBindings, ["light_toggle", "toggle_power"], ["state"]) ??
    equipment.orderBindings.find(
      (ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"),
    );
  const brightnessOrderBinding = findOrderByCategory(
    equipment.orderBindings,
    ["set_brightness"],
    ["brightness"],
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

  const handleBrightnessCommit = () => {
    if (!brightnessOrderBinding) return;
    slider.onCommit((v) => onExecuteOrder(brightnessOrderBinding.alias, v));
  };

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

  const isAwning = equipment.type === "awning";

  const positionBinding = equipment.dataBindings.find(
    (db) => db.category === "shutter_position",
  );
  const devicePosition = positionBinding && typeof positionBinding.value === "number"
    ? positionBinding.value
    : null;
  const position = slider.displayValue(devicePosition);
  const level = position !== null ? shutterLevel(position) : null;

  // Awning vocabulary — mirrors ShutterControl + ShutterEquipmentWidget.
  const labelHundred = isAwning ? t("controls.deployed") : t("controls.opened");
  const labelZero = isAwning ? t("controls.retracted") : t("controls.closed");

  // Resolve the move + position-set bindings by category first, falling back
  // to the conventional alias (`state`, `position`) and finally to any
  // shutter-flavoured key. Matches EquipmentWidget's resolver so manually-
  // rebound shutters (alias defaulting to the device key) keep working here.
  const moveBinding =
    equipment.orderBindings.find(
      (ob) => ob.category === "pool_cover_move" || ob.category === "shutter_move",
    ) ??
    equipment.orderBindings.find(
      (ob) => ob.alias === "state" || /shutter\d*_state/.test(ob.alias),
    );
  const positionOrderBinding =
    equipment.orderBindings.find((ob) => ob.category === "set_shutter_position") ??
    equipment.orderBindings.find(
      (ob) => ob.alias === "position" || /shutter\d*_position/.test(ob.alias),
    );
  const hasState = !!moveBinding;
  const hasPosition = !!positionOrderBinding;
  // Some bridges cannot actually stop the shutter mid-travel (e.g. Bubendorff
  // shutters via an "iDiamant with Netatmo" bridge, sowel-plugin-legrand-
  // control — confirmed live: a stop command only makes the motor pause
  // briefly before it continues to its original target). The integration
  // signals this by omitting "STOP" from the move order's enumValues.
  const hasStop = !moveBinding?.enumValues || moveBinding.enumValues.some((v) => v.toUpperCase() === "STOP");

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

  const handlePositionCommit = () => {
    if (!positionOrderBinding) return;
    slider.onCommit((v) => onExecuteOrder(positionOrderBinding.alias, v));
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Icon centered — pool covers + awnings get their own picto */}
      <div className="flex justify-center">
        {equipment.type === "pool_cover" ? (
          <PoolCoverIcon position={position} />
        ) : isAwning ? (
          <AwningWidgetIcon deployed={position !== null && position > 0} />
        ) : (
          <ShutterWidgetIcon level={level} />
        )}
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
            {position === 100 ? labelHundred : position === 0 ? labelZero : `${position}%`}
          </span>
        </div>
      )}

      {/* Action buttons — full width. Pool covers slide horizontally so we
       * use ←/→ arrows; window shutters stay with up/down. */}
      {hasState && equipment.enabled && (() => {
        const isHorizontal = equipment.type === "pool_cover";
        const OpenIcon = isHorizontal ? ChevronLeft : ChevronUp;
        const CloseIcon = isHorizontal ? ChevronRight : ChevronDown;
        return (
          <div className="flex gap-3">
            <button
              onClick={() => handleCommand("OPEN")}
              disabled={executing}
              className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
            >
              <OpenIcon size={20} strokeWidth={2} />
            </button>
            {hasStop && (
              <button
                onClick={() => handleCommand("STOP")}
                disabled={executing}
                className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
              >
                <Square size={14} strokeWidth={2.5} />
              </button>
            )}
            <button
              onClick={() => handleCommand("CLOSE")}
              disabled={executing}
              className="flex-1 h-12 flex items-center justify-center rounded-[6px] border border-border bg-surface text-text-secondary hover:bg-border-light transition-colors cursor-pointer active:scale-[0.97]"
            >
              <CloseIcon size={20} strokeWidth={2} />
            </button>
          </div>
        );
      })()}
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

  const isPoolHeatPump = equipment.type === "pool_heat_pump";

  const powerBinding = equipment.dataBindings.find((b) => b.alias === "power");
  const modeBinding = equipment.dataBindings.find((b) => b.alias === "mode");
  const insideTempBinding = equipment.dataBindings.find((b) => b.alias === "temperature");
  const effectiveWaterTemp = equipment.computedData?.find(
    (c) => c.alias === "effective_water_temperature",
  );
  const targetTempBinding = equipment.dataBindings.find((b) => b.alias === "setpoint");

  // pool_heat_pump has no power order; its "on" state is derived from `mode`.
  // The water temperature exposed is the computed `effective_water_temperature`
  // — gated by filtration / mode so we only show a representative value.
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

  // Category-first resolver (spec 110). Heater toggle is `toggle_power` /
  // `light_toggle` depending on the underlying device. We keep the
  // type-must-be-toggleable filter so the button is hidden (not just
  // disabled) when the binding is a non-togglable type.
  const toggleBindingRaw = findOrderByCategory(
    equipment.orderBindings,
    ["toggle_power", "light_toggle"],
    ["state"],
  );
  const toggleBinding =
    toggleBindingRaw && (toggleBindingRaw.type === "enum" || toggleBindingRaw.type === "boolean")
      ? toggleBindingRaw
      : undefined;

  const handleToggle = async () => {
    if (executing || !toggleBinding) return;
    setExecuting(true);
    try {
      const onVal = toggleBinding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON";
      const offVal = toggleBinding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF";
      const value = isOn ? offVal : onVal;
      await onExecuteOrder(toggleBinding.alias, value);
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
    (db) => db.category === "gate_state",
  );
  const gateState = (stateBinding?.value as string) ?? "unknown";
  const isOpen = gateState === "open";

  // Category-first resolver (spec 110). Aligns with WidgetGrid and
  // GateEquipmentWidget so all three gate code paths agree.
  const commandBinding = findOrderByCategory(
    equipment.orderBindings,
    ["gate_trigger"],
    ["command"],
  );
  const enumValues = commandBinding?.enumValues ?? [];

  const handleCommand = async (value: string | null) => {
    if (executing || !commandBinding) return;
    const key = value ?? "command";
    setExecuting(key);
    try {
      await onExecuteOrder(commandBinding.alias, value);
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
  const { sensorBindings, batteryBindings, batteryAlert } = useEquipmentState(equipment);

  const filteredBindings = visibleBindings && visibleBindings.length > 0
    ? visibleBindings.map((alias) => sensorBindings.find((b) => b.alias === alias)).filter((b): b is typeof sensorBindings[number] => !!b)
    : sensorBindings;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <MultiSensorIcon />
      </div>
      <SensorValues
        sensorBindings={filteredBindings}
        batteryBindings={batteryBindings}
        batteryAlert={batteryAlert}
        layout="column"
      />
    </div>
  );
}


import { useTranslation } from "react-i18next";
import { Wind, CloudRain, Thermometer } from "lucide-react";
import type { ComputedDataEntry, DataBindingWithValue } from "../../types";
import { getBatteryIcon, getBatteryColor, formatSensorValue } from "./sensorUtils";
import { angleToCompass, syntheticBindingFromComputed } from "./weather-utils";
import { TempExtremes } from "../TempExtremes";

interface WeatherPanelProps {
  bindings: DataBindingWithValue[];
  equipmentId: string;
  /** Sowel-computed values (e.g. rain_24h, rain_1h) — surfaced when the matching `sum_rain_*` binding is missing. */
  computedData?: ComputedDataEntry[];
}

/** Map from a computed alias to the binding key we want it to mimic. */
const COMPUTED_RAIN_TO_KEY: Record<string, string> = {
  rain_24h: "sum_rain_24",
  rain_1h: "sum_rain_1",
};

/** i18n key for each weather-specific property key. */
const KEY_LABELS: Record<string, string> = {
  wind_strength: "weather.windSpeed",
  wind_angle: "weather.windDirection",
  gust_strength: "weather.gustSpeed",
  gust_angle: "weather.gustDirection",
  rain: "weather.rainCurrent",
  sum_rain_1: "weather.rain1h",
  sum_rain_24: "weather.rain24h",
  temperature: "category.temperature",
  humidity: "category.humidity",
  pressure: "category.pressure",
  noise: "category.noise",
  co2: "category.co2",
};

/** Which key is the "hero" value shown big for each device type. */
const PRIMARY_KEY: Record<string, string> = {
  wind: "wind_strength",
  rain: "sum_rain_24",
  default: "temperature",
};

/** Display order for keys within each device type. */
const KEY_ORDER: Record<string, string[]> = {
  wind: ["wind_strength", "wind_angle", "gust_strength", "gust_angle"],
  rain: ["sum_rain_24", "sum_rain_1", "rain"],
};

/**
 * Arrow pointing in the direction the wind is going (= angle + 180°).
 * `angle` is the meteorological "from" angle (0° = from North).
 * Returns null when the angle isn't a finite number.
 */
function WindArrow({ angle, size = 18 }: { angle: number | null; size?: number }) {
  if (angle === null || !Number.isFinite(angle)) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${angle}deg)`, transformOrigin: "center" }}
      aria-hidden="true"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

type DeviceKind = "wind" | "rain" | "outdoor";

function detectKind(bindings: DataBindingWithValue[]): DeviceKind {
  const cats = new Set(bindings.map((b) => b.category));
  if (cats.has("wind")) return "wind";
  if (cats.has("rain")) return "rain";
  return "outdoor";
}

function getKindIcon(kind: DeviceKind) {
  switch (kind) {
    case "wind":
      return <Wind size={22} strokeWidth={1.5} />;
    case "rain":
      return <CloudRain size={22} strokeWidth={1.5} />;
    default:
      return <Thermometer size={22} strokeWidth={1.5} />;
  }
}

function getKindColor(kind: DeviceKind): string {
  switch (kind) {
    case "wind":
      return "text-primary bg-primary/10";
    case "rain":
      return "text-primary bg-primary/10";
    default:
      return "text-accent bg-accent/10";
  }
}

/** Sort order for device kinds so they always appear in a consistent order. */
const KIND_SORT: Record<DeviceKind, number> = { outdoor: 0, wind: 1, rain: 2 };

export function WeatherPanel({ bindings, equipmentId, computedData }: WeatherPanelProps) {
  // Group bindings by device
  const byDevice = new Map<string, { deviceName: string; bindings: DataBindingWithValue[] }>();
  for (const b of bindings) {
    let group = byDevice.get(b.deviceId);
    if (!group) {
      group = { deviceName: b.deviceName, bindings: [] };
      byDevice.set(b.deviceId, group);
    }
    group.bindings.push(b);
  }

  // Inject synthetic rain bindings (from computedData) into the rain device group
  // if the matching sum_rain_* binding isn't already attached. Attaches to an
  // existing rain-category device when present, otherwise creates a synthetic
  // "Pluviomètre" group.
  if (computedData && computedData.length > 0) {
    const rainHostBinding = bindings.find((b) => b.category === "rain");
    const rainDeviceId = rainHostBinding?.deviceId ?? "computed-rain";
    const rainDeviceName = rainHostBinding?.deviceName ?? "Pluviomètre";
    const existingKeys = new Set(
      (byDevice.get(rainDeviceId)?.bindings ?? []).map((b) => b.key),
    );

    for (const c of computedData) {
      const targetKey = COMPUTED_RAIN_TO_KEY[c.alias];
      if (!targetKey || existingKeys.has(targetKey)) continue;
      const synthetic = syntheticBindingFromComputed(equipmentId, c, {
        key: targetKey,
        deviceId: rainDeviceId,
        deviceName: rainDeviceName,
      });
      let group = byDevice.get(rainDeviceId);
      if (!group) {
        group = { deviceName: rainDeviceName, bindings: [] };
        byDevice.set(rainDeviceId, group);
      }
      group.bindings.push(synthetic);
      existingKeys.add(targetKey);
    }
  }

  const devices = [...byDevice.values()].map((g) => {
    const sensorBindings = g.bindings.filter((b) => b.category !== "battery");
    const batteryBinding = g.bindings.find((b) => b.category === "battery");
    const kind = detectKind(sensorBindings);
    return { ...g, sensorBindings, batteryBinding, kind };
  });

  // Sort: outdoor first, then wind, then rain
  devices.sort((a, b) => KIND_SORT[a.kind] - KIND_SORT[b.kind]);

  return (
    <div className="grid gap-4 mb-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((dev) => (
        <WeatherDeviceCard
          key={dev.deviceName}
          deviceName={dev.deviceName}
          kind={dev.kind}
          sensorBindings={dev.sensorBindings}
          batteryBinding={dev.batteryBinding ?? null}
          computedData={computedData}
        />
      ))}
    </div>
  );
}

function WeatherDeviceCard({
  deviceName,
  kind,
  sensorBindings,
  batteryBinding,
  computedData,
}: {
  deviceName: string;
  kind: DeviceKind;
  sensorBindings: DataBindingWithValue[];
  batteryBinding: DataBindingWithValue | null;
  computedData?: ComputedDataEntry[];
}) {
  const { t } = useTranslation();
  const batteryLevel =
    batteryBinding && typeof batteryBinding.value === "number"
      ? batteryBinding.value
      : null;

  // Find the primary (hero) binding
  const primaryKey = PRIMARY_KEY[kind] ?? PRIMARY_KEY.default;
  const primaryBinding = sensorBindings.find((b) => b.key === primaryKey);

  // Today's min/max envelope (spec 134) — only meaningful when the hero is a
  // temperature; the tracker's computed aliases derive from the binding alias.
  const heroExtremes = (() => {
    if (
      !primaryBinding ||
      (primaryBinding.category !== "temperature" &&
        primaryBinding.category !== "temperature_outdoor")
    ) {
      return null;
    }
    const min = computedData?.find((c) => c.alias === `${primaryBinding.alias}_min_today`)?.value;
    const max = computedData?.find((c) => c.alias === `${primaryBinding.alias}_max_today`)?.value;
    return typeof min === "number" && typeof max === "number" ? { min, max } : null;
  })();

  // For the wind module, surface direction next to the hero (arrow + compass label).
  const windAngleBinding =
    kind === "wind"
      ? sensorBindings.find((b) => b.key === "wind_angle")
      : undefined;
  const windAngle =
    windAngleBinding && typeof windAngleBinding.value === "number"
      ? windAngleBinding.value
      : null;

  // Sort remaining bindings by defined order, primary excluded.
  // wind_angle is folded into the hero (arrow + compass) so we drop it from the secondary list.
  const order = KEY_ORDER[kind];
  const secondaryBindings = sensorBindings
    .filter((b) => b !== primaryBinding)
    .filter((b) => !(kind === "wind" && b.key === "wind_angle"))
    .sort((a, b) => {
      if (!order) return 0;
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

  return (
    <div className="bg-surface rounded-[10px] border border-border p-4 flex flex-col">
      {/* Header: icon + name + battery */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={`w-10 h-10 rounded-[8px] flex items-center justify-center flex-shrink-0 ${getKindColor(kind)}`}
        >
          {getKindIcon(kind)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-text truncate">
            {deviceName}
          </div>
        </div>
        {batteryBinding && (
          <span
            className={`flex items-center gap-1 flex-shrink-0 ${getBatteryColor(batteryLevel)}`}
          >
            {getBatteryIcon(batteryLevel, 16, 1.5)}
            <span className="text-[12px] tabular-nums font-medium">
              {batteryLevel !== null ? `${batteryLevel}%` : "?"}
            </span>
          </span>
        )}
      </div>

      {/* Hero value */}
      {primaryBinding && (
        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2">
            <span className="text-[32px] font-bold font-mono text-text leading-none tabular-nums">
              {formatSensorValue(primaryBinding.value, undefined, t)}
            </span>
            {primaryBinding.unit && (
              <span className="text-[16px] text-text-tertiary">
                {primaryBinding.unit}
              </span>
            )}
            {kind === "wind" && windAngle !== null && (
              <span className="text-primary inline-flex items-center">
                <WindArrow angle={windAngle} size={20} />
              </span>
            )}
          </div>
          {heroExtremes && (
            <div className="mt-1.5 flex justify-center">
              <TempExtremes min={heroExtremes.min} max={heroExtremes.max} />
            </div>
          )}
          <div className="text-[12px] text-text-tertiary mt-1">
            {KEY_LABELS[primaryBinding.key]
              ? t(KEY_LABELS[primaryBinding.key])
              : primaryBinding.key}
            {kind === "wind" && windAngle !== null && (
              <> · {angleToCompass(windAngle)}</>
            )}
          </div>
        </div>
      )}

      {/* Secondary values */}
      {secondaryBindings.length > 0 && (
        <div className="border-t border-border-light pt-3 space-y-2">
          {secondaryBindings.map((b) => (
            <div key={b.id} className="flex items-baseline justify-between">
              <span className="text-[13px] text-text-secondary">
                {KEY_LABELS[b.key] ? t(KEY_LABELS[b.key]) : b.key}
              </span>
              <span className="text-[15px] font-semibold font-mono text-text tabular-nums">
                {formatSensorValue(b.value, undefined, t)}
                {b.unit && (
                  <span className="text-[12px] text-text-tertiary font-normal ml-0.5">
                    {b.unit}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

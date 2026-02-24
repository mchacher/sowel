import { useTranslation } from "react-i18next";
import { Wind, CloudRain, Thermometer } from "lucide-react";
import type { DataBindingWithValue } from "../../types";
import { getBatteryIcon, getBatteryColor, formatSensorValue } from "./sensorUtils";

interface WeatherPanelProps {
  bindings: DataBindingWithValue[];
}

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
  rain: ["rain", "sum_rain_1", "sum_rain_24"],
};

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
      return "text-sky-500 bg-sky-500/10";
    case "rain":
      return "text-blue-500 bg-blue-500/10";
    default:
      return "text-orange-500 bg-orange-500/10";
  }
}

/** Sort order for device kinds so they always appear in a consistent order. */
const KIND_SORT: Record<DeviceKind, number> = { outdoor: 0, wind: 1, rain: 2 };

export function WeatherPanel({ bindings }: WeatherPanelProps) {
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
}: {
  deviceName: string;
  kind: DeviceKind;
  sensorBindings: DataBindingWithValue[];
  batteryBinding: DataBindingWithValue | null;
}) {
  const { t } = useTranslation();
  const batteryLevel =
    batteryBinding && typeof batteryBinding.value === "number"
      ? batteryBinding.value
      : null;

  // Find the primary (hero) binding
  const primaryKey = PRIMARY_KEY[kind] ?? PRIMARY_KEY.default;
  const primaryBinding = sensorBindings.find((b) => b.key === primaryKey);

  // Sort remaining bindings by defined order, primary excluded
  const order = KEY_ORDER[kind];
  const secondaryBindings = sensorBindings
    .filter((b) => b !== primaryBinding)
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
          <span className="text-[32px] font-bold font-mono text-text leading-none tabular-nums">
            {formatSensorValue(primaryBinding.value, undefined, t)}
          </span>
          {primaryBinding.unit && (
            <span className="text-[16px] text-text-tertiary ml-1">
              {primaryBinding.unit}
            </span>
          )}
          <div className="text-[12px] text-text-tertiary mt-1">
            {KEY_LABELS[primaryBinding.key]
              ? t(KEY_LABELS[primaryBinding.key])
              : primaryBinding.key}
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

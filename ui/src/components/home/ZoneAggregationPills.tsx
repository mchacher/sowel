import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Thermometer,
  Droplets,
  Sun,
  PersonStanding,
  Lightbulb,
  DoorOpen,
  SquareStack,
  Droplet,
  Flame,
} from "lucide-react";
import { ShutterIcon } from "../icons/ShutterIcons";
import { WaterValveIcon } from "../icons/WaterValveIcon";
import { ZoneSparkline } from "../history/ZoneSparkline";
import type { ZoneAggregatedData } from "../../types";

interface ZoneAggregationPillsProps {
  data: ZoneAggregatedData;
  zoneId?: string;
  historyEnabled?: boolean;
}

interface StatusItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  color: string;
  alert?: boolean;
  /** If set, show a sparkline for this category. */
  sparklineCategory?: string;
}

export function ZoneAggregationPills({ data, zoneId, historyEnabled }: ZoneAggregationPillsProps) {
  const { t } = useTranslation();
  const items: StatusItem[] = [];
  const duration = useRelativeTime(data.motionSince, t);

  // Temperature
  if (data.temperature !== null) {
    items.push({
      key: "temp",
      icon: <Thermometer size={14} strokeWidth={1.5} />,
      label: `${data.temperature}°C`,
      color: "text-primary",
      sparklineCategory: "temperature",
    });
  }

  // Humidity
  if (data.humidity !== null) {
    items.push({
      key: "hum",
      icon: <Droplets size={14} strokeWidth={1.5} />,
      label: `${data.humidity}%`,
      color: "text-primary",
      sparklineCategory: "humidity",
    });
  }

  // Luminosity
  if (data.luminosity !== null) {
    items.push({
      key: "lux",
      icon: <Sun size={14} strokeWidth={1.5} />,
      label: `${data.luminosity} lx`,
      color: "text-primary",
      sparklineCategory: "luminosity",
    });
  }

  // Motion
  if (data.motionSensors > 0) {
    const label = data.motion ? t("aggregation.motion") : t("aggregation.calm");
    const suffix = duration ? ` · ${duration}` : "";
    items.push({
      key: "motion",
      icon: <PersonStanding size={14} strokeWidth={1.5} />,
      label: `${label}${suffix}`,
      color: data.motion ? "text-active-text" : "text-text-tertiary",
    });
  }

  // Lights
  if (data.lightsTotal > 0) {
    const isOn = data.lightsOn > 0;
    items.push({
      key: "lights",
      icon: <Lightbulb size={14} strokeWidth={1.5} />,
      label: `${data.lightsOn}/${data.lightsTotal}`,
      color: isOn ? "text-active-text" : "text-text-tertiary",
    });
  }

  // Shutters
  if (data.shuttersTotal > 0) {
    const someOpen = data.shuttersOpen > 0;
    const pos = data.averageShutterPosition;
    const positionSuffix = pos !== null
      ? ` · ${pos === 0 ? "Fermé" : pos === 100 ? "Ouvert" : `${pos}%`}`
      : "";
    items.push({
      key: "shutters",
      icon: <ShutterIcon size={14} strokeWidth={1.5} position={pos} />,
      label: `${data.shuttersOpen}/${data.shuttersTotal}${positionSuffix}`,
      color: someOpen ? "text-primary" : "text-text-tertiary",
    });
  }

  // Water valves
  if (data.waterValvesTotal > 0) {
    const someOpen = data.waterValvesOpen > 0;
    const flowSuffix =
      someOpen && data.waterFlowTotal !== null && data.waterFlowTotal > 0
        ? ` · ${data.waterFlowTotal} m³/h`
        : "";
    items.push({
      key: "water-valves",
      icon: <WaterValveIcon size={14} strokeWidth={1.5} />,
      label: `${data.waterValvesOpen}/${data.waterValvesTotal}${flowSuffix}`,
      color: someOpen ? "text-active-text" : "text-text-tertiary",
    });
  }

  // Open doors
  if (data.openDoors > 0) {
    items.push({
      key: "doors",
      icon: <DoorOpen size={14} strokeWidth={1.5} />,
      label: t("aggregation.open", { count: data.openDoors }),
      color: "text-active-text",
    });
  }

  // Open windows
  if (data.openWindows > 0) {
    items.push({
      key: "windows",
      icon: <SquareStack size={14} strokeWidth={1.5} />,
      label: t("aggregation.open", { count: data.openWindows }),
      color: "text-active-text",
    });
  }

  // Water leak alert
  if (data.waterLeak) {
    items.push({
      key: "water",
      icon: <Droplet size={14} strokeWidth={1.5} />,
      label: t("aggregation.waterLeak"),
      color: "text-error",
      alert: true,
    });
  }

  // Smoke alert
  if (data.smoke) {
    items.push({
      key: "smoke",
      icon: <Flame size={14} strokeWidth={1.5} />,
      label: t("aggregation.smoke"),
      color: "text-error",
      alert: true,
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex items-center rounded-[8px] border border-border bg-surface px-1 py-1 overflow-x-auto">
      {items.map((item, index) => (
        <div key={item.key} className="flex items-center">
          {index > 0 && (
            <div className="w-px h-4 bg-border mx-1 flex-shrink-0" />
          )}
          <div
            className={`
              flex items-center gap-1.5 px-2 py-0.5 rounded-[5px]
              text-[13px] font-medium tabular-nums whitespace-nowrap
              ${item.color}
              ${item.alert ? "bg-error/8" : ""}
            `}
          >
            {item.icon}
            <span>{item.label}</span>
            {historyEnabled && zoneId && item.sparklineCategory && (
              <ZoneSparkline zoneId={zoneId} category={item.sparklineCategory} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Relative time hook — refreshes every 30s, zero CPU when no timestamp
// ============================================================

function useRelativeTime(since: string | null, t: (key: string) => string): string | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return null;
  return formatDuration(since, t);
}

function formatDuration(since: string, t: (key: string) => string): string | null {
  const ms = Date.now() - new Date(since).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${t("time.min")}`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) {
    return remainMinutes > 0 ? `${hours}${t("time.hour")}${String(remainMinutes).padStart(2, "0")}` : `${hours}${t("time.hour")}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}${t("time.day")}`;
}

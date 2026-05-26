import { Fragment, useEffect, useState } from "react";
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

type PillVariant = "default" | "active" | "calm" | "alert";

interface ZoneAggregationPillsProps {
  data: ZoneAggregatedData;
  zoneId?: string;
  historyEnabled?: boolean;
}

interface StatusItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  /** Mobile-only label override. When undefined, uses `label` on all viewports. Empty string = icon-only on mobile. */
  mobileLabel?: string;
  variant: PillVariant;
  /** Override for the icon color in the default variant. Ignored for non-default variants. */
  iconTint?: string;
  /** Override for the value/label color in the default variant. Ignored for non-default variants. */
  valueTint?: string;
  /** If set, show a sparkline for this category (sensor pills only). */
  sparklineCategory?: string;
}

export function ZoneAggregationPills({
  data,
  zoneId,
  historyEnabled,
}: ZoneAggregationPillsProps) {
  const { t } = useTranslation();
  const duration = useRelativeTime(data.motionSince, t);

  // Spec 116: append "(N unavailable)" hint when offline equipments of this
  // category were excluded from the aggregation.
  const unavail = (cat: string): string => {
    const count = data.unavailableEquipmentsByCategory?.[cat as never] as
      | number
      | undefined;
    return count && count > 0
      ? ` ${t("zones.aggregate.unavailable", { count })}`
      : "";
  };

  // ── Cluster 1: Sensors (passive measurement) ────────────────
  const sensorPills: StatusItem[] = [];

  if (data.temperature !== null) {
    sensorPills.push({
      key: "temp",
      icon: <Thermometer size={14} strokeWidth={1.5} />,
      label: `${data.temperature}°C${unavail("temperature")}`,
      variant: "default",
      iconTint: "text-primary",
      valueTint: "text-text",
      sparklineCategory: "temperature",
    });
  }

  if (data.humidity !== null) {
    sensorPills.push({
      key: "hum",
      icon: <Droplets size={14} strokeWidth={1.5} />,
      label: `${data.humidity}%${unavail("humidity")}`,
      variant: "default",
      iconTint: "text-primary",
      valueTint: "text-text",
      sparklineCategory: "humidity",
    });
  }

  if (data.luminosity !== null) {
    sensorPills.push({
      key: "lux",
      icon: <Sun size={14} strokeWidth={1.5} />,
      label: `${data.luminosity} lx${unavail("luminosity")}`,
      variant: "default",
      iconTint: "text-primary",
      valueTint: "text-text",
      sparklineCategory: "luminosity",
    });
  }

  // ── Cluster 2: Counters / states (active devices) ───────────
  const counterPills: StatusItem[] = [];

  if (data.motionSensors > 0) {
    const label = data.motion ? t("aggregation.motion") : t("aggregation.calm");
    const suffix = duration ? ` · ${duration}` : "";
    counterPills.push({
      key: "motion",
      icon: <PersonStanding size={14} strokeWidth={1.5} />,
      label: `${label}${suffix}`,
      // Mobile: when motion is active, drop the "Mouvement" word but keep the duration.
      // The icon color signals motion; the word is redundant. Calm stays verbatim.
      mobileLabel: data.motion ? (duration ?? "") : `${label}${suffix}`,
      variant: data.motion ? "active" : "calm",
    });
  }

  if (data.lightsTotal > 0) {
    const isOn = data.lightsOn > 0;
    counterPills.push({
      key: "lights",
      icon: <Lightbulb size={14} strokeWidth={1.5} />,
      label: `${data.lightsOn}/${data.lightsTotal}${unavail("light_state")}`,
      variant: isOn ? "active" : "default",
      iconTint: "text-text-tertiary",
      valueTint: "text-text-tertiary",
    });
  }

  if (data.shuttersTotal > 0) {
    const someOpen = data.shuttersOpen > 0;
    const pos = data.averageShutterPosition;
    const positionSuffix =
      pos !== null
        ? ` · ${pos === 0 ? "Fermé" : pos === 100 ? "Ouvert" : `${pos}%`}`
        : "";
    counterPills.push({
      key: "shutters",
      icon: <ShutterIcon size={14} strokeWidth={1.5} position={pos} />,
      label: `${data.shuttersOpen}/${data.shuttersTotal}${positionSuffix}${unavail("shutter_position")}`,
      variant: "default",
      iconTint: "text-text-secondary",
      valueTint: someOpen ? "text-text" : "text-text-tertiary",
    });
  }

  if (data.waterValvesTotal > 0) {
    const someOpen = data.waterValvesOpen > 0;
    const flowSuffix =
      someOpen && data.waterFlowTotal !== null && data.waterFlowTotal > 0
        ? ` · ${data.waterFlowTotal} m³/h`
        : "";
    counterPills.push({
      key: "water-valves",
      icon: <WaterValveIcon size={14} strokeWidth={1.5} />,
      label: `${data.waterValvesOpen}/${data.waterValvesTotal}${flowSuffix}`,
      variant: someOpen ? "active" : "default",
      iconTint: "text-text-tertiary",
      valueTint: "text-text-tertiary",
    });
  }

  // ── Cluster 3: Alerts (anomalies) ───────────────────────────
  const alertPills: StatusItem[] = [];

  if (data.openDoors > 0) {
    alertPills.push({
      key: "doors",
      icon: <DoorOpen size={14} strokeWidth={1.5} />,
      label: t("aggregation.open", { count: data.openDoors }),
      variant: "default",
      iconTint: "text-active-text",
      valueTint: "text-active-text",
    });
  }

  if (data.openWindows > 0) {
    alertPills.push({
      key: "windows",
      icon: <SquareStack size={14} strokeWidth={1.5} />,
      label: t("aggregation.open", { count: data.openWindows }),
      variant: "default",
      iconTint: "text-active-text",
      valueTint: "text-active-text",
    });
  }

  if (data.waterLeak) {
    alertPills.push({
      key: "water",
      icon: <Droplet size={14} strokeWidth={1.5} />,
      label: t("aggregation.waterLeak"),
      variant: "alert",
    });
  }

  if (data.smoke) {
    alertPills.push({
      key: "smoke",
      icon: <Flame size={14} strokeWidth={1.5} />,
      label: t("aggregation.smoke"),
      variant: "alert",
    });
  }

  const clusters = [sensorPills, counterPills, alertPills].filter(
    (c) => c.length > 0,
  );

  if (clusters.length === 0) return null;

  return (
    <div className="flex items-center rounded-[8px] border border-border bg-surface px-1 py-1 overflow-x-auto">
      {clusters.map((cluster, ci) => (
        <Fragment key={ci}>
          {ci > 0 && (
            <div className="w-px h-5 bg-border mx-2 flex-shrink-0" />
          )}
          {cluster.map((item, ii) => (
            <Fragment key={item.key}>
              {ii > 0 && (
                <div className="w-px h-4 bg-border-light mx-1 flex-shrink-0" />
              )}
              <StripPill
                item={item}
                zoneId={zoneId}
                historyEnabled={historyEnabled}
              />
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

// ============================================================
// StripPill — variant → class mapping. Kept in-file for locality.
// ============================================================

interface StripPillProps {
  item: StatusItem;
  zoneId?: string;
  historyEnabled?: boolean;
}

function variantClasses(variant: PillVariant): {
  pill: string;
  icon: string;
  value: string;
} {
  switch (variant) {
    case "alert":
      return {
        pill: "bg-error/10 font-semibold",
        icon: "text-error",
        value: "text-error",
      };
    case "active":
      return {
        pill: "",
        icon: "text-active-text",
        value: "text-active-text",
      };
    case "calm":
      return {
        pill: "",
        icon: "text-success",
        value: "text-success font-semibold",
      };
    default:
      return { pill: "", icon: "", value: "" };
  }
}

function StripPill({ item, zoneId, historyEnabled }: StripPillProps) {
  const v = variantClasses(item.variant);
  const iconClass = v.icon || item.iconTint || "text-text-tertiary";
  const valueClass = v.value || item.valueTint || "text-text";
  const hasMobileOverride = item.mobileLabel !== undefined;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] text-[13px] font-medium tabular-nums whitespace-nowrap ${v.pill}`}
    >
      <span className={`flex-shrink-0 ${iconClass}`}>{item.icon}</span>
      {hasMobileOverride ? (
        <>
          {item.mobileLabel && <span className={`sm:hidden ${valueClass}`}>{item.mobileLabel}</span>}
          <span className={`hidden sm:inline ${valueClass}`}>{item.label}</span>
        </>
      ) : (
        <span className={valueClass}>{item.label}</span>
      )}
      {historyEnabled && zoneId && item.sparklineCategory && (
        <span className="hidden sm:inline-flex">
          <ZoneSparkline zoneId={zoneId} category={item.sparklineCategory} />
        </span>
      )}
    </div>
  );
}

// ============================================================
// Relative time hook — refreshes every 30s, zero CPU when no timestamp
// ============================================================

function useRelativeTime(
  since: string | null,
  t: (key: string) => string,
): string | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return null;
  return formatDuration(since, t);
}

function formatDuration(
  since: string,
  t: (key: string) => string,
): string | null {
  const ms = Date.now() - new Date(since).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${t("time.min")}`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (hours < 24) {
    return remainMinutes > 0
      ? `${hours}${t("time.hour")}${String(remainMinutes).padStart(2, "0")}`
      : `${hours}${t("time.hour")}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}${t("time.day")}`;
}

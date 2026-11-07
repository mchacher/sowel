import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Thermometer,
  Droplets,
  Sun,
  PersonStanding,
  Lightbulb,
  DoorClosed,
  DoorOpen,
  SquareStack,
  Droplet,
  Flame,
  Zap,
  Moon,
} from "lucide-react";
import { ShutterIcon } from "../icons/ShutterIcons";
import { WaterValveIcon } from "../icons/WaterValveIcon";
import { ZoneSparkline } from "../history/ZoneSparkline";
import type { ZoneAggregatedData } from "../../types";
import { formatDuration, formatPercent, formatPower, formatRange, formatTemperature, formatWithUnit } from "../../lib/format";
import { ROOT_ZONE_ID } from "../../lib/constants";

type PillVariant = "default" | "active" | "info" | "calm" | "alert";

/**
 * Spec 170 — watts below the kilowatt, kilowatts above, so a house drawing four
 * figures does not print six characters of noise in a pill. Unit symbols are not
 * translated, like the `m³/h` suffix on the water-valve pill.
 */
function formatWatts(watts: number): string {
  return formatPower(watts);
}

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
  /** Name read before the value by screen readers and shown on hover, when the icon alone says it. */
  name?: string;
  /** Shown below lg only: the desktop top bar already carries it. */
  compactOnly?: boolean;
}

export function ZoneAggregationPills({
  data,
  zoneId,
  historyEnabled,
}: ZoneAggregationPillsProps) {
  const { t } = useTranslation();
  const duration = useRelativeTime(data.motionSince);

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
      label: `${formatTemperature(data.temperature, { style: "compact" })}${unavail("temperature")}`,
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
      label: `${formatPercent(data.humidity)}${unavail("humidity")}`,
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
      label: `${formatWithUnit(data.luminosity, "lx")}${unavail("luminosity")}`,
      variant: "default",
      iconTint: "text-primary",
      valueTint: "text-text",
      sparklineCategory: "luminosity",
    });
  }

  // Spec 196, pr6-soleil — sunrise and sunset of the home. The desktop top bar
  // shows them on every page; phones and tablets have no room there, so the
  // root zone's strip carries them below lg (on desktop it would only repeat
  // the bar and push the strip into a sideways scroll).
  if (zoneId === ROOT_ZONE_ID && data.sunrise !== null && data.sunset !== null) {
    const isDay = data.isDaylight === true;
    sensorPills.push({
      key: "sun",
      icon: isDay ? <Sun size={14} strokeWidth={1.5} /> : <Moon size={14} strokeWidth={1.5} />,
      label: formatRange(data.sunrise, data.sunset),
      name: t("header.sun"),
      variant: "default",
      // The sun glyph is the one tolerated amber outside "on" (spec 196).
      iconTint: isDay ? "text-active" : "text-text-tertiary",
      valueTint: "text-text-secondary",
      compactOnly: true,
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
      // Motion is activity, not something switched on: primary, not amber.
      variant: data.motion ? "info" : "calm",
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
    // Compared once rounded, as shown: an average of 99.6 reads « Ouvert », not « 100 % ».
    const shownPos = pos !== null ? Math.round(pos) : null;
    const positionSuffix =
      shownPos !== null
        ? ` · ${shownPos === 0 ? t("controls.closed") : shownPos === 100 ? t("controls.opened") : formatPercent(shownPos)}`
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

  // Spec 190 — motorised doors, apart from the shutters and from the door
  // contact sensors (the `openDoors` alert below).
  if (data.doorsTotal > 0) {
    const someOpen = data.doorsOpen > 0;
    counterPills.push({
      key: "door-equipments",
      icon: someOpen ? <DoorOpen size={14} strokeWidth={1.5} /> : <DoorClosed size={14} strokeWidth={1.5} />,
      label: `${data.doorsOpen}/${data.doorsTotal}`,
      // Open/closed is neutral (spec 196): the word and the icon say it.
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

  // Spec 170 — the zone's live draw, summed from its submeters. Rendered only
  // when the zone actually measures something: `null` means no meter here, and
  // a pill reading "0 W" there would be a measurement the zone never made.
  if (data.powerTotal !== null) {
    counterPills.push({
      key: "power",
      icon: <Zap size={14} strokeWidth={1.5} />,
      label: formatWatts(data.powerTotal),
      // Energy is not "on": a neutral value, never amber.
      variant: "default",
      iconTint: "text-text-tertiary",
      valueTint: data.powerTotal > 0 ? "text-text" : "text-text-tertiary",
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
      iconTint: "text-text-secondary",
      valueTint: "text-text",
    });
  }

  if (data.openWindows > 0) {
    alertPills.push({
      key: "windows",
      icon: <SquareStack size={14} strokeWidth={1.5} />,
      label: t("aggregation.open", { count: data.openWindows }),
      variant: "default",
      iconTint: "text-text-secondary",
      valueTint: "text-text",
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

  // Below lg (phones and tablets) the strip wraps instead of scrolling
  // sideways (spec 196): the separators would dangle at line ends there, so
  // the gap replaces them. A separator next to a compact-only pill (hidden
  // from lg) never shows.
  return (
    <div className="card flex flex-wrap lg:flex-nowrap items-center gap-x-2 gap-y-1 lg:gap-x-0 px-1 py-1 lg:overflow-x-auto">
      {clusters.map((cluster, ci) => (
        <Fragment key={ci}>
          {ci > 0 && (
            <div
              className={`w-px h-5 bg-border mx-2 flex-shrink-0 ${
                cluster.every(isCompactOnly) || clusters.slice(0, ci).flat().every(isCompactOnly)
                  ? "hidden"
                  : "hidden lg:block"
              }`}
            />
          )}
          {cluster.map((item, ii) => (
            <Fragment key={item.key}>
              {ii > 0 && (
                <div
                  className={`w-px h-4 bg-border-light mx-1 flex-shrink-0 ${
                    item.compactOnly || cluster.slice(0, ii).every(isCompactOnly) ? "hidden" : "hidden lg:block"
                  }`}
                />
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

/** A separator next to pills hidden from lg is hidden with them, so none dangles. */
function isCompactOnly(item: StatusItem): boolean {
  return item.compactOnly === true;
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
      // Something on or running now: lights on, water flowing.
      return {
        pill: "",
        icon: "text-active-ink",
        value: "text-active-ink",
      };
    case "info":
      return {
        pill: "",
        icon: "text-primary",
        value: "text-primary",
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
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-small font-medium tabular-nums whitespace-nowrap ${v.pill} ${
        item.compactOnly ? "lg:hidden" : ""
      }`}
      title={item.name}
    >
      <span className={`flex-shrink-0 ${iconClass}`}>{item.icon}</span>
      {item.name && <span className="sr-only">{item.name}</span>}
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

function useRelativeTime(since: string | null): string | null {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return null;
  return sinceDuration(since);
}

/** How long since `since`, whole minutes at least (« 24 min », « 2 h 05 »); null under a minute. */
function sinceDuration(since: string): string | null {
  const seconds = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  if (seconds < 60) return null;
  // Whole minutes: the pill refreshes every 30 s, seconds would only flicker.
  return formatDuration(seconds - (seconds % 60));
}

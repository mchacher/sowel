import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudRain,
  Snowflake,
  CloudLightning,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DataBindingWithValue } from "../../types";

/** Map weather condition strings to Lucide icons. */
export const CONDITION_ICONS: Record<string, LucideIcon> = {
  sunny: Sun,
  partly_cloudy: CloudSun,
  cloudy: Cloud,
  foggy: CloudFog,
  rainy: CloudRain,
  snowy: Snowflake,
  stormy: CloudLightning,
};

/** Map weather condition strings to Tailwind color classes. */
export const CONDITION_COLORS: Record<string, string> = {
  sunny: "text-amber-500",
  partly_cloudy: "text-amber-400",
  cloudy: "text-text-tertiary",
  foggy: "text-text-tertiary",
  rainy: "text-primary",
  snowy: "text-blue-400",
  stormy: "text-purple-500",
};

/** Forecast confidence published by the plugin from spec 159 onwards. */
export type ForecastConfidence = "high" | "medium" | "low";

/**
 * How a confidence looks, once.
 *
 * Traffic-light coding: green reads "act on it", red "do not build on this
 * day". The amber middle is a deliberate call by the maintainer, even though
 * the accent is otherwise reserved for "a light is on right now", so the same
 * hue carries two meanings across the app. Lifted out of WeatherForecastPanel by spec 168:
 * the dashboard tile and the detail sheet render the same three bands, and
 * three copies of "what a fairly reliable day looks like" is the shape of drift this
 * codebase keeps having to undo.
 */
export const CONFIDENCE_STYLES: Record<ForecastConfidence, string> = {
  high: "border-success text-success bg-success/10",
  medium: "border-warning text-warning bg-warning/10",
  low: "border-error text-error bg-error/10",
};

const CONFIDENCE_VALUES: readonly string[] = ["high", "medium", "low"];

export interface ForecastDay {
  dayIndex: number;
  condition: string | null;
  tempMin: number | null;
  tempMax: number | null;
  rainProb: number | null;
  windGusts: number | null;
  /** Spread in °C behind the daily maximum. Null before plugin 2.0. */
  tempMaxSpread: number | null;
  /** Null before plugin 2.0, and whenever the plugin cannot honestly claim one. */
  confidence: ForecastConfidence | null;
}

/** Parse bindings grouped by jN_ prefix into forecast day objects. */
export function parseForecastDays(bindings: DataBindingWithValue[]): ForecastDay[] {
  const dayMap = new Map<number, ForecastDay>();

  for (const b of bindings) {
    const match = b.alias.match(/^j(\d+)_(.+)$/);
    if (!match) continue;

    const dayIndex = Number(match[1]);
    const metric = match[2];

    let day = dayMap.get(dayIndex);
    if (!day) {
      day = {
        dayIndex,
        condition: null,
        tempMin: null,
        tempMax: null,
        rainProb: null,
        windGusts: null,
        tempMaxSpread: null,
        confidence: null,
      };
      dayMap.set(dayIndex, day);
    }

    if (metric === "condition" && typeof b.value === "string") {
      day.condition = b.value;
    } else if (metric === "temp_max_spread" && Number.isFinite(b.value)) {
      day.tempMaxSpread = b.value as number;
    } else if (
      metric === "confidence" &&
      typeof b.value === "string" &&
      CONFIDENCE_VALUES.includes(b.value)
    ) {
      day.confidence = b.value as ForecastConfidence;
    } else if (metric === "temp_min" && Number.isFinite(b.value)) {
      day.tempMin = b.value as number;
    } else if (metric === "temp_max" && Number.isFinite(b.value)) {
      day.tempMax = b.value as number;
    } else if (metric === "rain_prob" && Number.isFinite(b.value)) {
      day.rainProb = b.value as number;
    } else if (metric === "wind_gusts" && Number.isFinite(b.value)) {
      day.windGusts = b.value as number;
    }
  }

  return [...dayMap.values()].sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * The model, or model combination, the plugin resolved the forecast from.
 *
 * A flat binding rather than a `jN_` one, and absent before plugin 2.0.
 */
export function parseModelUsed(bindings: DataBindingWithValue[]): string | null {
  const binding = bindings.find((b) => b.alias === "model_used");
  if (!binding || typeof binding.value !== "string") return null;
  const value = binding.value.trim();
  return value === "" || value === "none" ? null : value;
}

/**
 * Human labels for the Open-Meteo model ids the plugin can resolve to.
 *
 * Kept short and factual: the provider plus the grid, which is what makes one
 * model different from another to a household. An id absent from the map is
 * shown as is rather than guessed at.
 */
const MODEL_LABELS: Record<string, string> = {
  meteofrance_arome_france: "AROME 2.5 km",
  meteofrance_arpege_europe: "ARPEGE 11 km",
  icon_d2: "ICON-D2 2.2 km",
  icon_eu: "ICON-EU 7 km",
  ncep_hrrr_conus: "HRRR 3 km",
  knmi_harmonie_arome_netherlands: "HARMONIE-AROME 2 km",
  dmi_harmonie_arome_europe: "DMI HARMONIE 2 km",
  italia_meteo_arpae_icon_2i: "ICON-2I 2 km",
  metno_seamless: "MET Norway",
  ukmo_global_deterministic_10km: "UKMO 10 km",
  gfs_seamless: "GFS",
  ecmwf_ifs025: "ECMWF IFS 25 km",
  best_match: "Open-Meteo best match",
};

/** Display label for a resolved model id, or the id itself when unknown. */
export function modelLabel(modelId: string): string {
  return MODEL_LABELS[modelId] ?? modelId;
}

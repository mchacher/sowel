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

export interface ForecastDay {
  dayIndex: number;
  condition: string | null;
  tempMin: number | null;
  tempMax: number | null;
  rainProb: number | null;
  windGusts: number | null;
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
      day = { dayIndex, condition: null, tempMin: null, tempMax: null, rainProb: null, windGusts: null };
      dayMap.set(dayIndex, day);
    }

    if (metric === "condition" && typeof b.value === "string") {
      day.condition = b.value;
    } else if (metric === "temp_min" && typeof b.value === "number") {
      day.tempMin = b.value;
    } else if (metric === "temp_max" && typeof b.value === "number") {
      day.tempMax = b.value;
    } else if (metric === "rain_prob" && typeof b.value === "number") {
      day.rainProb = b.value;
    } else if (metric === "wind_gusts" && typeof b.value === "number") {
      day.windGusts = b.value;
    }
  }

  return [...dayMap.values()].sort((a, b) => a.dayIndex - b.dayIndex);
}

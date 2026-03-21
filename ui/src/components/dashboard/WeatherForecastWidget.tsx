import { useTranslation } from "react-i18next";
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
import type { EquipmentWithDetails } from "../../types";
import { parseForecastDays } from "../equipments/WeatherForecastPanel";

const CONDITION_ICONS: Record<string, LucideIcon> = {
  sunny: Sun,
  partly_cloudy: CloudSun,
  cloudy: Cloud,
  foggy: CloudFog,
  rainy: CloudRain,
  snowy: Snowflake,
  stormy: CloudLightning,
};

const CONDITION_COLORS: Record<string, string> = {
  sunny: "text-amber-500",
  partly_cloudy: "text-amber-400",
  cloudy: "text-text-tertiary",
  foggy: "text-text-tertiary",
  rainy: "text-primary",
  snowy: "text-blue-400",
  stormy: "text-purple-500",
};

interface WeatherForecastWidgetProps {
  label: string;
  equipment: EquipmentWithDetails;
}

export function WeatherForecastWidget({ label, equipment }: WeatherForecastWidgetProps) {
  const { i18n } = useTranslation();
  const days = parseForecastDays(equipment.dataBindings);
  const locale = i18n.language === "fr" ? "fr-FR" : "en-US";

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col h-[160px] sm:h-[240px] overflow-hidden">
      {/* Title */}
      <span className="text-[17px] font-semibold text-text truncate mb-2 text-center">{label}</span>

      {/* Forecast mini-cards row */}
      <div className="flex items-center justify-center gap-2 flex-1 min-h-0 overflow-x-auto">
        {days.slice(0, 5).map((day) => {
          const today = new Date();
          const dayDate = new Date(today);
          dayDate.setDate(today.getDate() + day.dayIndex);
          const shortDay = dayDate.toLocaleDateString(locale, { weekday: "short" });
          const capitalizedDay = shortDay.charAt(0).toUpperCase() + shortDay.slice(1);

          const ConditionIcon = day.condition ? CONDITION_ICONS[day.condition] ?? Cloud : Cloud;
          const conditionColor = day.condition ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary") : "text-text-tertiary";

          return (
            <div key={day.dayIndex} className="flex flex-col items-center gap-0.5 min-w-[48px]">
              <span className="text-[10px] font-medium text-text-tertiary">{capitalizedDay}</span>
              <div className={conditionColor}>
                <ConditionIcon size={18} strokeWidth={1.5} />
              </div>
              {day.tempMax !== null && (
                <span className="text-[12px] font-semibold text-text tabular-nums font-mono leading-none">
                  {Math.round(day.tempMax)}&deg;
                </span>
              )}
              {day.tempMin !== null && (
                <span className="text-[10px] text-text-tertiary tabular-nums font-mono leading-none">
                  {Math.round(day.tempMin)}&deg;
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

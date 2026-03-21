import { useTranslation } from "react-i18next";
import { Cloud, Droplets, Wind } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import {
  parseForecastDays,
  CONDITION_ICONS,
  CONDITION_COLORS,
} from "../equipments/weatherForecastUtils";

interface WeatherForecastWidgetProps {
  label: string;
  equipment: EquipmentWithDetails;
}

const CONDITION_LABELS: Record<string, { fr: string; en: string }> = {
  sunny: { fr: "Ensoleillé", en: "Sunny" },
  partly_cloudy: { fr: "Éclaircies", en: "Partly cloudy" },
  cloudy: { fr: "Nuageux", en: "Cloudy" },
  foggy: { fr: "Brouillard", en: "Foggy" },
  rainy: { fr: "Pluie", en: "Rainy" },
  snowy: { fr: "Neige", en: "Snowy" },
  stormy: { fr: "Orage", en: "Stormy" },
};

export function WeatherForecastWidget({ label, equipment }: WeatherForecastWidgetProps) {
  const { i18n } = useTranslation();
  const days = parseForecastDays(equipment.dataBindings);
  const tomorrow = days[0]; // J+1
  const locale = i18n.language === "fr" ? "fr-FR" : "en-US";
  const lang = i18n.language === "fr" ? "fr" : "en";

  if (!tomorrow) return null;

  const dayDate = new Date();
  dayDate.setDate(dayDate.getDate() + tomorrow.dayIndex);
  const dayName = dayDate.toLocaleDateString(locale, { weekday: "long" });
  const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);

  const ConditionIcon = tomorrow.condition
    ? CONDITION_ICONS[tomorrow.condition] ?? Cloud
    : Cloud;
  const conditionColor = tomorrow.condition
    ? (CONDITION_COLORS[tomorrow.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";
  const conditionLabel = tomorrow.condition
    ? CONDITION_LABELS[tomorrow.condition]?.[lang] ?? tomorrow.condition
    : "";

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold text-text-secondary truncate">{label}</span>
        <span className="text-[11px] text-text-tertiary">{capitalizedDay}</span>
      </div>

      {/* Main content */}
      <div className="flex items-center gap-3 flex-1">
        {/* Icon */}
        <div className={`${conditionColor} flex-shrink-0`}>
          <ConditionIcon size={36} strokeWidth={1.5} />
        </div>

        {/* Temps + condition */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            {tomorrow.tempMax !== null && (
              <span className="text-[24px] font-bold font-mono text-text tabular-nums leading-none">
                {Math.round(tomorrow.tempMax)}°
              </span>
            )}
            {tomorrow.tempMin !== null && (
              <span className="text-[14px] font-mono text-text-tertiary tabular-nums leading-none">
                {Math.round(tomorrow.tempMin)}°
              </span>
            )}
          </div>
          <span className="text-[12px] text-text-secondary mt-0.5 block">{conditionLabel}</span>
        </div>

        {/* Rain + Wind */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {tomorrow.rainProb !== null && (
            <div className="flex items-center gap-1">
              <Droplets size={12} strokeWidth={1.5} className="text-primary" />
              <span className="text-[12px] text-text-secondary font-mono tabular-nums">
                {Math.round(tomorrow.rainProb)}%
              </span>
            </div>
          )}
          {tomorrow.windGusts !== null && (
            <div className="flex items-center gap-1">
              <Wind size={12} strokeWidth={1.5} className="text-text-tertiary" />
              <span className="text-[12px] text-text-secondary font-mono tabular-nums">
                {Math.round(tomorrow.windGusts)} km/h
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

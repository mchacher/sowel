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

const CONDITION_LABELS_FR: Record<string, string> = {
  sunny: "Ensoleillé",
  partly_cloudy: "Éclaircies",
  cloudy: "Nuageux",
  foggy: "Brouillard",
  rainy: "Pluie",
  snowy: "Neige",
  stormy: "Orage",
};

const CONDITION_LABELS_EN: Record<string, string> = {
  sunny: "Sunny",
  partly_cloudy: "Partly cloudy",
  cloudy: "Cloudy",
  foggy: "Foggy",
  rainy: "Rainy",
  snowy: "Snowy",
  stormy: "Stormy",
};

export function WeatherForecastWidget({ label, equipment }: WeatherForecastWidgetProps) {
  const { i18n } = useTranslation();
  const days = parseForecastDays(equipment.dataBindings);
  const tomorrow = days[0]; // J+1
  const locale = i18n.language === "fr" ? "fr-FR" : "en-US";
  const conditionLabels = i18n.language === "fr" ? CONDITION_LABELS_FR : CONDITION_LABELS_EN;

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
    ? conditionLabels[tomorrow.condition] ?? tomorrow.condition
    : "";

  return (
    <div className="bg-surface border border-border rounded-[10px] p-3 flex flex-col h-[160px] sm:h-[240px] overflow-hidden">
      {/* Zone 1: Titre — same as WidgetCard */}
      <span className="text-[17px] font-semibold text-text truncate mb-2 text-center">{label}</span>

      {/* Zone 2: Content */}
      <div className="flex items-center justify-center gap-4 flex-1 min-h-0">
        {/* Icon */}
        <div className={`${conditionColor} flex-shrink-0`}>
          <ConditionIcon size={40} strokeWidth={1.5} />
        </div>

        {/* Data */}
        <div className="flex flex-col items-start gap-1">
          {/* Temperature */}
          <div className="flex items-baseline gap-1.5">
            {tomorrow.tempMax !== null && (
              <span className="text-[28px] font-bold font-mono text-text tabular-nums leading-none">
                {Math.round(tomorrow.tempMax)}
              </span>
            )}
            <span className="text-[14px] text-text-tertiary">°C</span>
            {tomorrow.tempMin !== null && (
              <span className="text-[14px] font-mono text-text-tertiary tabular-nums ml-1">
                {Math.round(tomorrow.tempMin)}°
              </span>
            )}
          </div>

          {/* Condition label + day */}
          <span className="text-[12px] text-text-secondary">{conditionLabel} · {capitalizedDay}</span>

          {/* Rain + Wind */}
          <div className="flex items-center gap-3 mt-1">
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
    </div>
  );
}

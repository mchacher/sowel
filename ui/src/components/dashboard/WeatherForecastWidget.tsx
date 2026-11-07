import { useTranslation } from "react-i18next";
import { dateLocale } from "../../lib/locale";
import { Cloud, Droplets, Wind } from "lucide-react";
import type { EquipmentWithDetails } from "../../types";
import {
  parseForecastDays,
  CONDITION_ICONS,
  CONDITION_COLORS,
} from "../equipments/weatherForecastUtils";
import { ForecastConfidenceMark } from "./ForecastConfidenceMark";
import { WidgetCard } from "./WidgetCard";
import { formatNumber, formatPercent, formatWithUnit } from "../../lib/format";

interface WeatherForecastWidgetProps {
  label: string;
  sublabel?: string;
  equipment: EquipmentWithDetails;
  /** Opens the detail sheet. Absent in edit mode, where the card is dragged. */
  onOpenDetail?: () => void;
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

export function WeatherForecastWidget({
  label,
  sublabel,
  equipment,
  onOpenDetail,
}: WeatherForecastWidgetProps) {
  const { i18n } = useTranslation();
  const days = parseForecastDays(equipment.dataBindings);
  const tomorrow = days[0]; // J+1
  const conditionLabels =
    dateLocale(i18n.language) === "fr-FR" ? CONDITION_LABELS_FR : CONDITION_LABELS_EN;

  if (!tomorrow) return null;

  const ConditionIcon = tomorrow.condition ? (CONDITION_ICONS[tomorrow.condition] ?? Cloud) : Cloud;
  const conditionColor = tomorrow.condition
    ? (CONDITION_COLORS[tomorrow.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";
  const conditionLabel = tomorrow.condition
    ? (conditionLabels[tomorrow.condition] ?? tomorrow.condition)
    : "";

  return (
    <WidgetCard
      label={label}
      sublabel={sublabel}
      onClick={onOpenDetail}
      className={onOpenDetail ? "cursor-pointer transition-colors hover:bg-primary-light/30" : ""}
    >
      {/* Zone 2: Content — vertical on mobile, horizontal on desktop. The
          confidence rides with it rather than being pushed to the very bottom
          of a 240px card, where it read as detached from the day it qualifies. */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-1.5 sm:gap-6">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-4">
          {/* Icon — 36px mobile, 72px desktop (wrapped in div for proper hide/show) */}
          <div className={`${conditionColor} flex-shrink-0`}>
            <span className="block sm:hidden">
              <ConditionIcon size={36} strokeWidth={1.2} />
            </span>
            <span className="hidden sm:block">
              <ConditionIcon size={72} strokeWidth={1.2} />
            </span>
          </div>

          {/* Data */}
          <div className="flex flex-col items-center sm:items-start gap-0">
            {/* Temperature, short form « 13° 8° ». Forecasts stay whole degrees: an
                exception to pr3-zero (spec 196, Edge Cases), a forecast has no tenth. */}
            <div className="flex items-baseline gap-1">
              {tomorrow.tempMax !== null && (
                <span className="text-title sm:text-display font-semibold text-text tabular-nums leading-none">
                  {formatNumber(tomorrow.tempMax, { decimals: 0 })}°
                </span>
              )}
              {tomorrow.tempMin !== null && (
                <span className="text-caption sm:text-body text-text-tertiary tabular-nums ml-1">
                  {formatNumber(tomorrow.tempMin, { decimals: 0 })}°
                </span>
              )}
            </div>

            {/* Condition label */}
            <span className="text-micro sm:text-caption text-text-secondary leading-tight truncate">
              {conditionLabel}
            </span>

            {/* Rain + Wind */}
            <div className="flex items-center gap-2 sm:gap-3">
              {tomorrow.rainProb !== null && (
                <div className="flex items-center gap-0.5">
                  <Droplets size={10} strokeWidth={1.5} className="text-primary" />
                  <span className="text-micro sm:text-caption text-text-secondary tabular-nums">
                    {formatPercent(tomorrow.rainProb)}
                  </span>
                </div>
              )}
              {tomorrow.windGusts !== null && (
                <div className="flex items-center gap-0.5">
                  <Wind size={10} strokeWidth={1.5} className="text-text-tertiary" />
                  <span className="text-micro sm:text-caption text-text-secondary tabular-nums">
                    {formatWithUnit(tomorrow.windGusts, "km/h")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* How much the sources agree on tomorrow. */}
        <ForecastConfidenceMark confidence={tomorrow.confidence} />
      </div>
    </WidgetCard>
  );
}

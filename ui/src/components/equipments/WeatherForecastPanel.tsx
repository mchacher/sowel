import { Droplets, Wind, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DataBindingWithValue } from "../../types";
import {
  parseForecastDays,
  CONDITION_ICONS,
  CONDITION_COLORS,
  type ForecastDay,
} from "./weatherForecastUtils";

interface WeatherForecastPanelProps {
  bindings: DataBindingWithValue[];
}

export function WeatherForecastPanel({ bindings }: WeatherForecastPanelProps) {
  const { i18n } = useTranslation();
  const days = parseForecastDays(bindings);

  if (days.length === 0) {
    return null;
  }

  const locale = i18n.language === "fr" ? "fr-FR" : "en-US";

  return (
    <div className="mb-6">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {days.map((day) => (
          <ForecastDayCard key={day.dayIndex} day={day} locale={locale} />
        ))}
      </div>
    </div>
  );
}

function ForecastDayCard({ day, locale }: { day: ForecastDay; locale: string }) {
  const today = new Date();
  const dayDate = new Date(today);
  dayDate.setDate(today.getDate() + day.dayIndex);
  const dayName = dayDate.toLocaleDateString(locale, { weekday: "long" });
  const capitalizedDayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);

  const ConditionIcon = day.condition ? CONDITION_ICONS[day.condition] ?? Cloud : Cloud;
  const conditionColor = day.condition
    ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";

  return (
    <div className="flex-shrink-0 min-w-[140px] bg-surface rounded-[10px] border border-border p-4 flex flex-col items-center gap-2">
      {/* Day name */}
      <span className="text-[13px] font-semibold text-text">{capitalizedDayName}</span>

      {/* Condition icon */}
      <div className={`my-1 ${conditionColor}`}>
        <ConditionIcon size={32} strokeWidth={1.5} />
      </div>

      {/* Temperature max */}
      {day.tempMax !== null && (
        <div className="flex items-baseline gap-0.5">
          <span className="text-[22px] font-bold font-mono text-text tabular-nums leading-none">
            {Math.round(day.tempMax)}
          </span>
          <span className="text-[13px] text-text-tertiary">&deg;C</span>
        </div>
      )}

      {/* Temperature min */}
      {day.tempMin !== null && (
        <div className="flex items-baseline gap-0.5">
          <span className="text-[15px] font-medium font-mono text-text-secondary tabular-nums leading-none">
            {Math.round(day.tempMin)}
          </span>
          <span className="text-[11px] text-text-tertiary">&deg;C</span>
        </div>
      )}

      {/* Rain probability */}
      {day.rainProb !== null && (
        <div className="flex items-center gap-1 mt-1">
          <Droplets size={13} strokeWidth={1.5} className="text-primary" />
          <span className="text-[12px] text-text-secondary tabular-nums font-mono">
            {Math.round(day.rainProb)}%
          </span>
        </div>
      )}

      {/* Wind gusts */}
      {day.windGusts !== null && (
        <div className="flex items-center gap-1">
          <Wind size={13} strokeWidth={1.5} className="text-text-tertiary" />
          <span className="text-[12px] text-text-secondary tabular-nums font-mono">
            {Math.round(day.windGusts)} km/h
          </span>
        </div>
      )}
    </div>
  );
}

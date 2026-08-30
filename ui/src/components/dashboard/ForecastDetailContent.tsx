import { useTranslation } from "react-i18next";
import { Cloud, Droplets, Wind } from "lucide-react";
import { dateLocale } from "../../lib/locale";
import type { EquipmentWithDetails } from "../../types";
import {
  parseForecastDays,
  parseModelUsed,
  modelLabel,
  CONDITION_ICONS,
  CONDITION_COLORS,
  CONFIDENCE_STYLES,
  type ForecastDay,
} from "../equipments/weatherForecastUtils";

/**
 * The forecast behind the dashboard tile (spec 168).
 *
 * A vertical row per day, not the horizontal cards of the equipment page. The
 * sheet is a fixed-width surface on both viewports, so a horizontal scroller
 * inside it hides the last days behind a gesture nothing announces; stacking
 * puts all five on screen and lets the confidence read down a column.
 */
export function ForecastDetailContent({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t, i18n } = useTranslation();
  const days = parseForecastDays(equipment.dataBindings);
  const locale = dateLocale(i18n.language);

  const modelUsed = parseModelUsed(equipment.dataBindings);
  const medianMatch = modelUsed?.match(/^median\((\d+)\)$/);
  const sourceLabel = medianMatch
    ? t("equipments.forecast.medianOf", { count: Number(medianMatch[1]) })
    : modelUsed && modelLabel(modelUsed);

  if (days.length === 0) {
    return <p className="text-[13px] text-text-tertiary py-4">{t("dashboard.forecast.empty")}</p>;
  }

  return (
    <div>
      <div className="flex flex-col">
        {days.map((day) => (
          <ForecastRow key={day.dayIndex} day={day} locale={locale} />
        ))}
      </div>
      {modelUsed && (
        <p className="mt-3 text-[12px] text-text-tertiary">
          {t("equipments.forecast.source", { model: sourceLabel })}
        </p>
      )}
    </div>
  );
}

function ForecastRow({ day, locale }: { day: ForecastDay; locale: string }) {
  const { t } = useTranslation();
  const date = new Date();
  date.setDate(date.getDate() + day.dayIndex);
  const name = date.toLocaleDateString(locale, { weekday: "long" });
  const dayName = name.charAt(0).toUpperCase() + name.slice(1);

  const ConditionIcon = day.condition ? (CONDITION_ICONS[day.condition] ?? Cloud) : Cloud;
  const conditionColor = day.condition
    ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border-light last:border-b-0">
      <span className="w-[76px] shrink-0 text-[13px] font-semibold text-text truncate">
        {dayName}
      </span>

      <span className={`${conditionColor} shrink-0`}>
        <ConditionIcon size={22} strokeWidth={1.5} />
      </span>

      <span className="flex items-baseline gap-1 font-mono tabular-nums shrink-0">
        <span className="text-[16px] font-bold text-text">
          {day.tempMax !== null ? `${Math.round(day.tempMax)}°` : "—"}
        </span>
        {day.tempMin !== null && (
          <span className="text-[13px] text-text-tertiary">/ {Math.round(day.tempMin)}°</span>
        )}
      </span>

      <span className="flex items-center gap-3 min-w-0">
        {day.rainProb !== null && (
          <span className="flex items-center gap-1 text-[12px] text-text-secondary font-mono tabular-nums">
            <Droplets size={12} strokeWidth={1.5} className="text-primary shrink-0" />
            {Math.round(day.rainProb)}%
          </span>
        )}
        {day.windGusts !== null && (
          <span className="flex items-center gap-1 text-[12px] text-text-secondary font-mono tabular-nums">
            <Wind size={12} strokeWidth={1.5} className="text-text-tertiary shrink-0" />
            {Math.round(day.windGusts)}
          </span>
        )}
      </span>

      {/* No pill at all when the plugin cannot qualify the day. An empty or
          grey badge would read as a verdict, and "we do not know" is not one. */}
      {day.confidence && (
        <span
          className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            CONFIDENCE_STYLES[day.confidence]
          }`}
          title={
            day.tempMaxSpread !== null && day.tempMaxSpread > 0
              ? t("equipments.forecast.confidenceHint", { spread: day.tempMaxSpread.toFixed(1) })
              : undefined
          }
        >
          {t(`equipments.forecast.confidence.${day.confidence}`)}
        </span>
      )}
    </div>
  );
}

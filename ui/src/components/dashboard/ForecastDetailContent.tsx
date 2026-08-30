import { useTranslation } from "react-i18next";
import { Cloud, Wind } from "lucide-react";
import { dateLocale } from "../../lib/locale";
import type { EquipmentWithDetails } from "../../types";
import {
  parseForecastDays,
  parseModelUsed,
  modelLabel,
  CONDITION_ICONS,
  CONDITION_COLORS,
  CONFIDENCE_BAR,
  CONFIDENCE_BAR_UNKNOWN,
  type ForecastDay,
} from "../equipments/weatherForecastUtils";

/**
 * The forecast behind the dashboard tile (spec 168, option C2).
 *
 * The same card anatomy as the equipment page, narrowed so the five days fit
 * across a 390px sheet without a sideways scroll. The equipment page can
 * afford the scroll; a sheet cannot, because the days you scroll past are
 * exactly the ones the forecast is least sure about.
 *
 * Rain is dropped here on purpose: the tile already carries it for tomorrow,
 * and at 68px a column has room for one metric, not two. Wind is the one that
 * changes what you do with a shutter or an awning.
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
      <div className="flex items-stretch gap-1.5 sm:gap-3">
        {days.map((day) => (
          <ForecastDayColumn key={day.dayIndex} day={day} locale={locale} />
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

function ForecastDayColumn({ day, locale }: { day: ForecastDay; locale: string }) {
  const { t } = useTranslation();
  const date = new Date();
  date.setDate(date.getDate() + day.dayIndex);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const longName = capitalize(date.toLocaleDateString(locale, { weekday: "long" }));
  const shortName = date.toLocaleDateString(locale, { weekday: "short" }).replace(/\.$/, "");

  const ConditionIcon = day.condition ? (CONDITION_ICONS[day.condition] ?? Cloud) : Cloud;
  const conditionColor = day.condition
    ? (CONDITION_COLORS[day.condition] ?? "text-text-tertiary")
    : "text-text-tertiary";
  const confidenceLabel = day.confidence
    ? t(`equipments.forecast.confidence.${day.confidence}`)
    : undefined;

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5 rounded-[10px] border border-border bg-surface px-1 py-2.5 sm:px-3 sm:py-4">
      <span className="text-[11px] sm:text-[13px] font-semibold text-text truncate max-w-full">
        <span className="sm:hidden">{shortName}</span>
        <span className="hidden sm:inline">{longName}</span>
      </span>

      <span className={`${conditionColor} my-0.5`}>
        <span className="block sm:hidden">
          <ConditionIcon size={24} strokeWidth={1.5} />
        </span>
        <span className="hidden sm:block">
          <ConditionIcon size={32} strokeWidth={1.5} />
        </span>
      </span>

      <span className="flex items-baseline gap-0.5">
        <span className="text-[17px] sm:text-[22px] font-bold font-mono text-text tabular-nums leading-none">
          {day.tempMax !== null ? Math.round(day.tempMax) : "—"}
        </span>
        <span className="text-[11px] sm:text-[13px] text-text-tertiary">°C</span>
      </span>

      {day.tempMin !== null && (
        <span className="flex items-baseline gap-0.5">
          <span className="text-[12px] sm:text-[15px] font-medium font-mono text-text-secondary tabular-nums leading-none">
            {Math.round(day.tempMin)}
          </span>
          <span className="text-[10px] sm:text-[11px] text-text-tertiary">°C</span>
        </span>
      )}

      {day.windGusts !== null && (
        <span className="flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[12px] text-text-secondary font-mono tabular-nums">
          <Wind size={11} strokeWidth={1.5} className="text-text-tertiary shrink-0 sm:hidden" />
          <Wind
            size={13}
            strokeWidth={1.5}
            className="text-text-tertiary shrink-0 hidden sm:block"
          />
          {Math.round(day.windGusts)}
          <span className="hidden sm:inline"> km/h</span>
        </span>
      )}

      {/* The same vocabulary as the tile's dot: colour here, colour and word
          where there is room for one. A day the plugin cannot qualify keeps
          the neutral rule and gets no word, so an absent verdict never reads
          as a good one. `mt-auto` keeps the rules on one line across the five
          columns whatever else each day published. */}
      <span
        className="mt-auto pt-2 w-full block"
        title={
          day.tempMaxSpread !== null && day.tempMaxSpread > 0
            ? t("equipments.forecast.confidenceHint", { spread: day.tempMaxSpread.toFixed(1) })
            : undefined
        }
      >
        <span
          className={`block w-full h-[3px] rounded-full ${
            day.confidence ? CONFIDENCE_BAR[day.confidence] : CONFIDENCE_BAR_UNKNOWN
          }`}
          aria-label={confidenceLabel}
        />
      </span>

      {confidenceLabel && (
        <span
          className={`hidden sm:block text-[10px] font-semibold ${
            day.confidence === "high"
              ? "text-success"
              : day.confidence === "medium"
                ? "text-warning"
                : "text-error"
          }`}
        >
          {confidenceLabel}
        </span>
      )}
    </div>
  );
}

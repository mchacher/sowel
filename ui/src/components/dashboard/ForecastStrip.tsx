import { useTranslation } from "react-i18next";
import { dateLocale } from "../../lib/locale";
import {
  CONFIDENCE_BAR,
  CONFIDENCE_BAR_UNKNOWN,
  type ForecastDay,
} from "../equipments/weatherForecastUtils";

/**
 * How many days the strip shows (spec 168).
 *
 * Five columns is what fits the tile at its narrowest without the day names
 * colliding. The plugin publishes five today; capping here rather than
 * assuming it means a plugin that starts publishing seven does not silently
 * break the layout.
 */
export const STRIP_DAYS = 5;

/**
 * The days behind the tile, on both the desktop card and the phone card.
 *
 * Two jobs: it carries each day's confidence as a colour where there is no
 * room for a word, and it is the only thing on the tile that says there is
 * more than tomorrow under the tap.
 *
 * Rendered only from the second day on. With a single day it would repeat the
 * headline the tile already shows in full size, one column wide.
 */
export function ForecastStrip({ days }: { days: ForecastDay[] }) {
  const { i18n } = useTranslation();
  const strip = days.slice(0, STRIP_DAYS);
  if (strip.length < 2) return null;

  const locale = dateLocale(i18n.language);
  return (
    <div className="flex gap-1 border-t border-border-light pt-1.5 mt-1.5 w-full">
      {strip.map((day) => (
        <StripColumn key={day.dayIndex} day={day} locale={locale} />
      ))}
    </div>
  );
}

/** One day of the strip: name, maximum, and the confidence as a bar. */
function StripColumn({ day, locale }: { day: ForecastDay; locale: string }) {
  const { t } = useTranslation();
  const date = new Date();
  date.setDate(date.getDate() + day.dayIndex);
  // Not `narrow`: it collapses to a single letter, and both languages then
  // print the same letter for two different days (L M M J V in French, M T W
  // T F in English), which is unreadable next to five different colours.
  const name = date.toLocaleDateString(locale, { weekday: "short" }).replace(/\.$/, "");
  const confidenceLabel = day.confidence
    ? t(`equipments.forecast.confidence.${day.confidence}`)
    : undefined;

  return (
    <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0" title={confidenceLabel}>
      <span className="text-[8px] sm:text-[9px] leading-none text-text-tertiary truncate max-w-full">
        {name}
      </span>
      <span className="text-[10px] sm:text-[11px] leading-none font-mono font-semibold text-text tabular-nums">
        {day.tempMax !== null ? Math.round(day.tempMax) : "—"}
      </span>
      {/* A day the plugin cannot qualify gets the neutral border colour, never
          a confidence colour: an absent verdict must not read as a good one. */}
      <span
        className={`w-full h-[2px] sm:h-[3px] rounded-full ${
          day.confidence ? CONFIDENCE_BAR[day.confidence] : CONFIDENCE_BAR_UNKNOWN
        }`}
        aria-label={confidenceLabel}
      />
    </div>
  );
}

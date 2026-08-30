import { useTranslation } from "react-i18next";
import { CONFIDENCE_STYLES, type ForecastConfidence } from "../equipments/weatherForecastUtils";

/**
 * Tomorrow's confidence on the tile (spec 168, option A2).
 *
 * The same pill as the equipment page and the detail panel, centred at the
 * foot of the card. A dot alone would encode the one thing the tile is meant
 * to qualify in colour only, and a different shape on each surface would make
 * the reader learn the same fact twice.
 *
 * Nothing at all when the plugin cannot qualify the day: a grey badge reading
 * "not qualified" spends the foot of a 212px card saying nothing, and is one
 * more thing to mistake for a verdict.
 */
export function ForecastConfidenceMark({
  confidence,
  className = "",
}: {
  confidence: ForecastConfidence | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!confidence) return null;

  return (
    <span
      className={`self-center shrink-0 rounded-full border px-2 sm:px-3 py-0.5 sm:py-1 text-[10px] sm:text-[13px] font-semibold leading-tight ${
        CONFIDENCE_STYLES[confidence]
      } ${className}`}
    >
      {t(`equipments.forecast.confidence.${confidence}`)}
    </span>
  );
}

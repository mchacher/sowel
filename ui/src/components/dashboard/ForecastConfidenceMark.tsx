import { useTranslation } from "react-i18next";
import { CONFIDENCE_BAR, type ForecastConfidence } from "../equipments/weatherForecastUtils";

/**
 * Tomorrow's confidence on the tile (spec 168, option A2).
 *
 * A coloured dot and the word, on the condition line. The dot alone would be
 * colour-only encoding of the one thing the tile is meant to qualify, and the
 * word alone would read as another weather term next to "Nuageux".
 *
 * Nothing at all when the plugin cannot qualify the day: a grey dot with
 * "non qualifié" beside it spends a line of a 212px card saying nothing.
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
  const label = t(`equipments.forecast.confidence.${confidence}`);

  return (
    <span className={`flex items-center gap-1 leading-tight ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONFIDENCE_BAR[confidence]}`} />
      <span className="text-text-secondary truncate">{label}</span>
    </span>
  );
}

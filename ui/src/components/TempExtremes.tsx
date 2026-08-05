import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Compact "today's min/max" line for a temperature reading (spec 134).
 * Rendered small, under the main temperature value — ocean-blue arrow for
 * the minimum, amber arrow for the maximum (Sowel palette), values in
 * tabular mono to align with the other weather figures.
 */
export function TempExtremes({
  min,
  max,
  large = false,
}: {
  min: number;
  max: number;
  /** 2x sizing for the mobile widget icon slot (rendered at 50% scale). */
  large?: boolean;
}) {
  const { t } = useTranslation();
  // The large (mobile 2x) variant must fit "↓17.4° ↑32.6°" inside a narrow
  // scaled icon slot: smaller arrows/text and minimal gaps, decimals kept.
  const arrow = large ? 14 : 11;
  const text = large ? "text-[18px]" : "text-[12px]";
  return (
    <div className={`flex items-center justify-center leading-none ${large ? "gap-1.5" : "gap-2"}`}>
      <span
        className={`flex items-center ${large ? "" : "gap-0.5"}`}
        aria-label={t("weather.minToday")}
      >
        <ArrowDown size={arrow} strokeWidth={2} className="text-primary/70 shrink-0" />
        <span className={`font-mono ${text} font-medium tabular-nums text-text-tertiary`}>
          {min.toFixed(1)}°
        </span>
      </span>
      <span
        className={`flex items-center ${large ? "" : "gap-0.5"}`}
        aria-label={t("weather.maxToday")}
      >
        <ArrowUp size={arrow} strokeWidth={2} className="text-accent shrink-0" />
        <span className={`font-mono ${text} font-medium tabular-nums text-text-tertiary`}>
          {max.toFixed(1)}°
        </span>
      </span>
    </div>
  );
}

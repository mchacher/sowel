import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";
import type { ZoneAggregatedData } from "../../types";
import { formatRange } from "../../lib/format";

/**
 * Sunrise and sunset of the home, as plain text in the desktop top bar
 * (spec 196, decision pr6-soleil): a sun by day, a moon by night, and
 * « 07:22 – 17:17 ». Phones show it in the root-zone strip instead.
 */
export function SunTimes({ data }: { data: ZoneAggregatedData | undefined }) {
  const { t } = useTranslation();

  if (!data || data.sunrise === null || data.sunset === null) return null;

  const isDay = data.isDaylight === true;
  const range = formatRange(data.sunrise, data.sunset);

  return (
    <div
      className="flex items-center gap-1 text-caption text-text-secondary tabular-nums whitespace-nowrap"
      title={`${t("header.sun")} ${range}`}
    >
      {isDay ? (
        // The sun glyph is the one tolerated amber outside "on" (spec 196).
        <Sun size={14} strokeWidth={1.5} className="text-active" aria-hidden="true" />
      ) : (
        <Moon size={14} strokeWidth={1.5} aria-hidden="true" />
      )}
      <span className="sr-only">{t("header.sun")}</span>
      <span>{range}</span>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";
import type { ZoneAggregatedData } from "../../types";
import { formatRange } from "../../lib/format";

/**
 * Sunrise and sunset of the home, as plain text in the top bar on every page
 * (spec 196, decision pr6-soleil, amended by #1133 for phones and tablets): a sun
 * by day, a moon by night, and « 07:22 – 17:17 ».
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

/**
 * The sun in the top bar below lg, beside what else shares it (alarms, updates,
 * restart pills, the home time, the link indicator). At 360 px the bar holds the
 * title, the sun and one of them; with two or more the sun waits for sm, so the
 * title does not shrink to a few letters and the bar never wraps (#1133).
 */
export function MobileSunTimes({
  data,
  headerPills,
}: {
  data: ZoneAggregatedData | undefined;
  headerPills: number;
}) {
  return (
    <div className={headerPills <= 1 ? "flex" : "hidden sm:flex"}>
      <SunTimes data={data} />
    </div>
  );
}

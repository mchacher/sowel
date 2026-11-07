import { useTranslation } from "react-i18next";
import { Sunrise, Moon } from "lucide-react";
import type { ZoneAggregatedData } from "../../types";
import { formatRange } from "../../lib/format";

interface SunlightBannerProps {
  data: ZoneAggregatedData | undefined;
  compact?: boolean;
}

export function SunlightBanner({ data, compact }: SunlightBannerProps) {
  const { t } = useTranslation();

  if (!data || data.sunrise === null || data.sunset === null) return null;

  const isDay = data.isDaylight === true;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1 text-micro font-medium tabular-nums ${
          isDay ? "text-text-secondary" : "text-primary"
        }`}
      >
        {isDay
          ? <Sunrise size={12} strokeWidth={1.5} className="text-active" />
          : <Moon size={12} strokeWidth={1.5} />
        }
        <span>{formatRange(data.sunrise, data.sunset)}</span>
      </div>
    );
  }

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-full border
        text-caption font-medium tabular-nums
        ${isDay
          ? "bg-border-light text-text-secondary border-border"
          : "bg-primary/10 text-primary border-primary/20"
        }
      `}
    >
      {isDay
        // The sun glyph is the one tolerated amber outside "on" (spec 196).
        ? <Sunrise size={13} strokeWidth={1.5} className="text-active" />
        : <Moon size={13} strokeWidth={1.5} />
      }
      <span>{formatRange(data.sunrise, data.sunset)}</span>
      <span className="text-micro opacity-70 lowercase">{isDay ? t("aggregation.daylight") : t("aggregation.night")}</span>
    </div>
  );
}

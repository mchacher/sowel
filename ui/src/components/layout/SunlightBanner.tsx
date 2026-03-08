import { useTranslation } from "react-i18next";
import { Sunrise, Moon } from "lucide-react";
import type { ZoneAggregatedData } from "../../types";

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
        className={`flex items-center gap-1 text-[11px] font-medium tabular-nums ${
          isDay ? "text-accent" : "text-primary"
        }`}
      >
        {isDay
          ? <Sunrise size={12} strokeWidth={1.5} />
          : <Moon size={12} strokeWidth={1.5} />
        }
        <span>{data.sunrise} — {data.sunset}</span>
      </div>
    );
  }

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-[8px]
        text-[13px] font-medium tabular-nums
        ${isDay
          ? "bg-accent/10 text-accent"
          : "bg-primary/10 text-primary"
        }
      `}
    >
      {isDay
        ? <Sunrise size={15} strokeWidth={1.5} />
        : <Moon size={15} strokeWidth={1.5} />
      }
      <span>{data.sunrise} — {data.sunset}</span>
      <span className="text-[11px] opacity-70">{isDay ? t("aggregation.daylight") : t("aggregation.night")}</span>
    </div>
  );
}

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
        <span>{data.sunrise} - {data.sunset}</span>
      </div>
    );
  }

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded-full border
        text-[12px] font-medium tabular-nums
        ${isDay
          ? "bg-accent/10 text-accent border-accent/20"
          : "bg-primary/10 text-primary border-primary/20"
        }
      `}
    >
      {isDay
        ? <Sunrise size={13} strokeWidth={1.5} />
        : <Moon size={13} strokeWidth={1.5} />
      }
      <span>{data.sunrise} - {data.sunset}</span>
      <span className="text-[11px] opacity-70 lowercase">{isDay ? t("aggregation.daylight") : t("aggregation.night")}</span>
    </div>
  );
}

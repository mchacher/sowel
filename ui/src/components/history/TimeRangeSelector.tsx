import { useTranslation } from "react-i18next";
import type { TimeRange } from "./history-utils";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

const RANGES: TimeRange[] = ["6h", "24h", "7d", "30d"];
const RANGE_I18N: Record<TimeRange, string> = {
  "6h": "history.range6h",
  "24h": "history.range24h",
  "7d": "history.range7d",
  "30d": "history.range30d",
};

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
            value === range
              ? "bg-primary text-white"
              : "bg-border-light text-text-secondary hover:bg-border"
          }`}
        >
          {t(RANGE_I18N[range])}
        </button>
      ))}
    </div>
  );
}

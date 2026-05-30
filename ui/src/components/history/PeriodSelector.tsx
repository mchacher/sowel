import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  canGoForwardPeriod,
  periodTodayStr,
  shiftPeriod,
  type Period,
} from "./history-utils";

interface PeriodSelectorProps {
  period: Period;
  date: string;
  onPeriodChange: (period: Period) => void;
  onDateChange: (date: string) => void;
}

const PERIODS: readonly { key: Period; labelKey: string }[] = [
  { key: "day", labelKey: "analyse.periodDay" },
  { key: "week", labelKey: "analyse.periodWeek" },
  { key: "month", labelKey: "analyse.periodMonth" },
  { key: "year", labelKey: "analyse.periodYear" },
];

function formatDateLabel(dateStr: string, period: Period, locale: string): string {
  const d = new Date(dateStr + "T12:00:00");
  switch (period) {
    case "day":
      return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
    case "week": {
      const start = new Date(d);
      const dayOfWeek = start.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(start.getDate() + mondayOffset);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startLabel = start.toLocaleDateString(locale, { day: "numeric", month: "short" });
      const endLabel = end.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
      return `${startLabel} – ${endLabel}`;
    }
    case "month":
      return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    case "year":
      return d.getFullYear().toString();
  }
}

/**
 * Day/Week/Month/Year tab selector with prev/next date navigation and a
 * "Today" reset button. Mirrors the navigator used on the Energy page; this
 * copy lives under `history/` so the Analyse page owns its own UX without
 * leaking the energy-specific Zustand store.
 */
export function PeriodSelector({ period, date, onPeriodChange, onDateChange }: PeriodSelectorProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "fr-FR";
  const today = periodTodayStr();
  const canNext = canGoForwardPeriod(date, period);
  const isToday = date === today;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      <div className="flex rounded-[6px] border border-border overflow-hidden">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPeriodChange(p.key)}
            className={`min-w-[60px] px-3 py-1.5 text-[12px] font-medium text-center transition-colors cursor-pointer ${
              period === p.key
                ? "bg-primary text-white"
                : "bg-surface text-text-secondary hover:bg-border-light hover:text-text"
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDateChange(shiftPeriod(date, period, -1))}
          className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors cursor-pointer"
          aria-label="previous"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <span className="text-[13px] font-medium text-text min-w-[160px] text-center">
          {formatDateLabel(date, period, locale)}
        </span>
        <button
          type="button"
          onClick={() => onDateChange(shiftPeriod(date, period, 1))}
          disabled={!canNext}
          className={`p-1.5 rounded-[6px] transition-colors ${
            canNext
              ? "text-text-tertiary hover:text-text-secondary hover:bg-border-light cursor-pointer"
              : "text-border cursor-not-allowed"
          }`}
          aria-label="next"
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => onDateChange(today)}
          disabled={isToday}
          className={`ml-1 px-2 py-1 rounded-[6px] text-[11px] font-medium transition-colors ${
            isToday
              ? "text-text-tertiary bg-border-light cursor-default"
              : "text-primary bg-primary-light hover:bg-primary hover:text-white cursor-pointer"
          }`}
        >
          {t("analyse.today")}
        </button>
      </div>
    </div>
  );
}

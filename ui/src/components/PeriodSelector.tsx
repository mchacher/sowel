import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../lib/locale";
import { formatDateLabel, type SelectorPeriod } from "../lib/period-label";

/**
 * Day / Week / Month / Year tabs with prev / next date navigation and a Today
 * reset (issue #730).
 *
 * The Energy and Analyse pages each had their own copy of this. The Analyse one
 * was translated, the Energy one was not, and the Energy one also pinned every
 * `toLocaleDateString` to `"fr-FR"`, so an English user got French period tabs
 * and a French date. One copy now, so the two cannot diverge again.
 *
 * It owns no date arithmetic: the two pages compute dates from different
 * sources (a Zustand store, `history-utils`), so they pass in the state and the
 * callbacks and this only renders.
 */

const PERIODS: readonly { key: SelectorPeriod; labelKey: string }[] = [
  { key: "day", labelKey: "period.day" },
  { key: "week", labelKey: "period.week" },
  { key: "month", labelKey: "period.month" },
  { key: "year", labelKey: "period.year" },
];

export interface PeriodSelectorProps {
  period: SelectorPeriod;
  date: string;
  /** False disables the next arrow, so the user cannot navigate into the future. */
  canGoForward: boolean;
  isToday: boolean;
  onPeriodChange: (period: SelectorPeriod) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function PeriodSelector({
  period,
  date,
  canGoForward,
  isToday,
  onPeriodChange,
  onPrevious,
  onNext,
  onToday,
}: PeriodSelectorProps) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      {/* Period tabs */}
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

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          aria-label={t("period.previous")}
          className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <span className="text-[13px] font-medium text-text min-w-[160px] text-center">
          {formatDateLabel(date, period, locale)}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={!canGoForward}
          aria-label={t("period.next")}
          className={`p-1.5 rounded-[6px] transition-colors ${
            canGoForward
              ? "text-text-tertiary hover:text-text-secondary hover:bg-border-light cursor-pointer"
              : "text-border cursor-not-allowed"
          }`}
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onToday}
          disabled={isToday}
          className={`ml-1 px-2 py-1 rounded-[6px] text-[11px] font-medium transition-colors ${
            isToday
              ? "text-text-tertiary bg-border-light cursor-default"
              : "text-primary bg-primary-light hover:bg-primary hover:text-white cursor-pointer"
          }`}
        >
          {t("period.today")}
        </button>
      </div>
    </div>
  );
}

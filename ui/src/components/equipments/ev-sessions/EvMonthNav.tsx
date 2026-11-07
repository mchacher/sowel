import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../../../lib/locale";
import { monthLabel, monthOf, shiftMonth } from "./evSessionsDisplay";

/** Spec 191 — previous / next month; the current month is the last one. */
export function EvMonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { t, i18n } = useTranslation();
  const isCurrent = month >= monthOf(new Date());
  const btn =
    "w-9 h-11 flex items-center justify-center rounded-sm text-text-secondary hover:bg-border-light disabled:text-text-tertiary disabled:hover:bg-transparent disabled:cursor-default cursor-pointer";
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={btn}
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label={t("equipments.evSessions.prevMonth")}
      >
        <ChevronLeft size={16} strokeWidth={1.5} />
      </button>
      <span className="text-small text-text-secondary min-w-[110px] text-center">
        {monthLabel(month, dateLocale(i18n.language))}
      </span>
      <button
        type="button"
        className={btn}
        disabled={isCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label={t("equipments.evSessions.nextMonth")}
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

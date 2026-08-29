import {
  canGoForwardPeriod,
  periodTodayStr,
  shiftPeriod,
  type Period,
} from "./history-utils";
import { PeriodSelector as SharedPeriodSelector } from "../PeriodSelector";

interface PeriodSelectorProps {
  period: Period;
  date: string;
  onPeriodChange: (period: Period) => void;
  onDateChange: (date: string) => void;
}

/**
 * The Analyse page's period navigator: binds `history-utils` to the shared
 * selector (issue #730). The markup and the date formatting used to live here,
 * duplicated in an untranslated form under `energy/`.
 */
export function PeriodSelector({ period, date, onPeriodChange, onDateChange }: PeriodSelectorProps) {
  const today = periodTodayStr();

  return (
    <SharedPeriodSelector
      period={period}
      date={date}
      canGoForward={canGoForwardPeriod(date, period)}
      isToday={date === today}
      onPeriodChange={onPeriodChange}
      onPrevious={() => onDateChange(shiftPeriod(date, period, -1))}
      onNext={() => onDateChange(shiftPeriod(date, period, 1))}
      onToday={() => onDateChange(today)}
    />
  );
}

import { useEnergy, canGoForward } from "../../store/useEnergy";
import { localDateStr } from "../../lib/local-date";
import { PeriodSelector as SharedPeriodSelector } from "../PeriodSelector";

/**
 * The Energy pages' period navigator: binds the energy store to the shared
 * selector (issue #730). It used to be a second, untranslated copy of the
 * Analyse one.
 */
export function PeriodSelector() {
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const setPeriod = useEnergy((s) => s.setPeriod);
  const setDate = useEnergy((s) => s.setDate);
  const navigateDate = useEnergy((s) => s.navigateDate);
  const today = localDateStr();

  return (
    <SharedPeriodSelector
      period={period}
      date={date}
      canGoForward={canGoForward(date, period)}
      isToday={date === today}
      onPeriodChange={setPeriod}
      onPrevious={() => navigateDate(-1)}
      onNext={() => navigateDate(1)}
      onToday={() => setDate(today)}
    />
  );
}

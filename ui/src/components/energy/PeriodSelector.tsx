import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEnergy, canGoForward } from "../../store/useEnergy";

const PERIODS = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Sem" },
  { key: "month", label: "Mois" },
  { key: "year", label: "Année" },
] as const;

function formatDateLabel(dateStr: string, period: string): string {
  const d = new Date(dateStr + "T12:00:00");
  switch (period) {
    case "day":
      return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    case "week": {
      const weekStart = new Date(d);
      const dayOfWeek = weekStart.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      weekStart.setDate(weekStart.getDate() + mondayOffset);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return `${weekStart.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    case "month":
      return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    case "year":
      return d.getFullYear().toString();
    default:
      return dateStr;
  }
}

export function PeriodSelector() {
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const setPeriod = useEnergy((s) => s.setPeriod);
  const setDate = useEnergy((s) => s.setDate);
  const navigateDate = useEnergy((s) => s.navigateDate);
  const canNext = canGoForward(date, period);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      {/* Period tabs */}
      <div className="flex rounded-[6px] border border-border overflow-hidden">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
              period === p.key
                ? "bg-primary text-white"
                : "bg-surface text-text-secondary hover:bg-border-light hover:text-text"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigateDate(-1)}
          className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-secondary hover:bg-border-light transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <span className="text-[13px] font-medium text-text min-w-[160px] text-center">
          {formatDateLabel(date, period)}
        </span>
        <button
          onClick={() => navigateDate(1)}
          disabled={!canNext}
          className={`p-1.5 rounded-[6px] transition-colors ${
            canNext
              ? "text-text-tertiary hover:text-text-secondary hover:bg-border-light cursor-pointer"
              : "text-border cursor-not-allowed"
          }`}
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setDate(today)}
          disabled={isToday}
          className={`ml-1 px-2 py-1 rounded-[6px] text-[11px] font-medium transition-colors ${
            isToday
              ? "text-text-tertiary bg-border-light cursor-default"
              : "text-primary bg-primary-light hover:bg-primary hover:text-white cursor-pointer"
          }`}
        >
          Aujourd'hui
        </button>
      </div>
    </div>
  );
}

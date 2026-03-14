import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEnergy } from "../../store/useEnergy";
import { PeriodSelector } from "./PeriodSelector";
import { EnergyBarChart } from "./EnergyBarChart";

function formatKWh(wh: number, period: string): string {
  const kwh = wh / 1000;
  if (period === "day") return kwh.toFixed(2);
  return Math.round(kwh).toString();
}

export function EnergyPage() {
  const { t } = useTranslation();
  const history = useEnergy((s) => s.history);
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const loading = useEnergy((s) => s.loading);
  const fetchHistory = useEnergy((s) => s.fetchHistory);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="text-[18px] font-semibold text-text">{t("energy.consumption")}</h1>
        <PeriodSelector />
      </div>

      {/* Content */}
      {loading && !history ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-[13px]">
          {t("common.loading")}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
          {/* Total */}
          <div className="flex items-center justify-end mb-4">
            {history && (
              <span className="text-[18px] font-bold text-text tabular-nums">
                {formatKWh(history.totals.total_consumption, period)}
                <span className="text-[13px] font-medium text-text-secondary ml-1">kWh</span>
              </span>
            )}
          </div>

          {/* Chart */}
          <EnergyBarChart
            points={history?.points ?? []}
            period={period}
            date={date}
            height={350}
          />
        </div>
      )}
    </div>
  );
}

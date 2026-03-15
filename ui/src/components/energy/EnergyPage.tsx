import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEnergy } from "../../store/useEnergy";
import { PeriodSelector } from "./PeriodSelector";
import { EnergyBarChart } from "./EnergyBarChart";
import { EnergyMobileNav } from "./EnergyMobileNav";

function formatKWh(wh: number, period: string): string {
  const kwh = wh / 1000;
  if (period === "day") return kwh.toFixed(2);
  return Math.round(kwh).toString();
}

const AUTOCONSO_COLOR = "#6BCB77";
export function EnergyPage() {
  const { t } = useTranslation();
  const history = useEnergy((s) => s.history);
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const loading = useEnergy((s) => s.loading);
  const hasProduction = useEnergy((s) => s.hasProduction);
  const fetchHistory = useEnergy((s) => s.fetchHistory);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const hasHpHc = history ? history.totals.total_hc > 0 : false;

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <div className="flex items-center gap-1.5">
          <EnergyMobileNav />
          <h1 className="text-[18px] font-semibold text-text">{t("energy.consumption")}</h1>
        </div>
        <PeriodSelector />
      </div>

      {/* Content */}
      {loading && !history ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-[13px]">
          {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Consumption chart */}
          <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
            <EnergyBarChart
              points={history?.points ?? []}
              period={period}
              date={date}
              height={350}
            />

            {/* Legend below chart */}
            {history && (
              <div className="flex flex-col items-center mt-3 gap-1">
                <div className="flex items-center gap-4 text-[13px] text-text-secondary flex-wrap justify-center">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#4F7BE8" }} />
                    {t("energy.gridConsumption")} : {formatKWh((history.totals.total_consumption ?? 0) - (history.totals.total_autoconso ?? 0), period)} kWh
                  </span>
                  {hasHpHc && (
                    <span className="text-text-tertiary">
                      ({t("energy.peakHours")} : {formatKWh(history.totals.total_hp, period)} kWh — {t("energy.offPeakHours")} : {formatKWh(history.totals.total_hc, period)} kWh)
                    </span>
                  )}
                  {hasProduction && history.totals.total_autoconso > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: AUTOCONSO_COLOR }} />
                      {t("energy.autoconsumption")} : {formatKWh(history.totals.total_autoconso, period)} kWh
                    </span>
                  )}
                </div>
                <div className="text-[15px] font-semibold text-text tabular-nums mt-1">
                  Total : {formatKWh(history.totals.total_consumption, period)} kWh
                  {hasProduction && history.totals.total_consumption > 0 && history.totals.total_autoconso > 0 && (
                    <span className="ml-2 font-normal text-text-secondary">
                      ({Math.round(history.totals.total_autoconso / history.totals.total_consumption * 100)}% {t("energy.autoconsumption").toLowerCase()})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

        </>
      )}
    </div>
  );
}

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEnergy } from "../../store/useEnergy";
import { PeriodSelector } from "./PeriodSelector";
import { ProductionBarChart } from "./ProductionBarChart";
import { EnergyMobileNav } from "./EnergyMobileNav";

function formatKWh(wh: number, period: string): string {
  const kwh = wh / 1000;
  if (period === "day") return kwh.toFixed(2);
  return Math.round(kwh).toString();
}

const AUTOCONSO_COLOR = "#6BCB77";
const INJECTION_COLOR = "#2D8F3E";

export function ProductionPage() {
  const { t } = useTranslation();
  const history = useEnergy((s) => s.history);
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const loading = useEnergy((s) => s.loading);
  const fetchHistory = useEnergy((s) => s.fetchHistory);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const hasProdData = history ? history.totals.total_production > 0 : false;

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <div className="flex items-center gap-1.5">
          <EnergyMobileNav />
          <h1 className="text-[18px] font-semibold text-text">{t("energy.production")}</h1>
        </div>
        <PeriodSelector />
      </div>

      {/* Content */}
      {loading && !history ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-[13px]">
          {t("common.loading")}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-[10px] p-4 sm:p-6">
          <ProductionBarChart
            points={history?.points ?? []}
            period={period}
            date={date}
            height={350}
          />

          {/* Production legend */}
          {history && hasProdData && (
            <div className="flex flex-col items-center mt-3 gap-1">
              <div className="flex items-center gap-4 text-[13px] text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: AUTOCONSO_COLOR }} />
                  {t("energy.autoconsumption")} : {formatKWh(history.totals.total_autoconso, period)} kWh
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INJECTION_COLOR }} />
                  {t("energy.gridInjection")} : {formatKWh(history.totals.total_injection, period)} kWh
                </span>
              </div>
              <div className="text-[15px] font-semibold text-text tabular-nums mt-1">
                Total : {formatKWh(history.totals.total_production, period)} kWh
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEnergy } from "../../store/useEnergy";
import { useEquipments } from "../../store/useEquipments";
import { useAuth } from "../../store/useAuth";
import { PeriodSelector } from "./PeriodSelector";
import { ProductionBarChart } from "./ProductionBarChart";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { displayedProductionTotalWh, hasProductionSplit } from "./productionTotal";
import { PvForecastPanel } from "../equipments/PvForecastPanel";
import { PvHealthPanel } from "../equipments/PvHealthPanel";
import { isActiveSolarProfile } from "../equipments/solarProfileValidation";

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
  const equipments = useEquipments((s) => s.equipments);
  const fetchEquipments = useEquipments((s) => s.fetchEquipments);
  const isAdmin = useAuth((s) => s.user?.role === "admin");

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    void fetchEquipments();
  }, [fetchEquipments]);

  // Spec 163 — the PV monitoring home. One block per declared production
  // meter; "declared" is the same rule the backend applies, mirrored in
  // solarProfileValidation since spec 160.
  const meters = useMemo(
    () => equipments.filter((e) => e.type === "energy_production_meter"),
    [equipments],
  );
  const declaredMeters = useMemo(
    () => meters.filter((m) => isActiveSolarProfile(m.solarProfile)),
    [meters],
  );

  const hasProdData = history ? displayedProductionTotalWh(history.totals) > 0 : false;
  const showSplit = history ? hasProductionSplit(history.totals) : false;

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="hidden sm:block">{t("energy.production")}</h1>
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
              {showSplit && (
                <div className="flex items-center gap-4 text-[13px] text-text-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: AUTOCONSO_COLOR }} />
                    {t("energy.autoconsumption")}{t("common.colon")}{formatKWh(history.totals.total_autoconso, period)} kWh
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INJECTION_COLOR }} />
                    {t("energy.gridInjection")}{t("common.colon")}{formatKWh(history.totals.total_injection, period)} kWh
                  </span>
                </div>
              )}
              <div className="text-[15px] font-semibold text-text tabular-nums mt-1">
                {t("energy.total")}{t("common.colon")}{formatKWh(displayedProductionTotalWh(history.totals), period)} kWh
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spec 163 — forecast and panel health, read-only. Titled per meter as
          soon as several meters exist (FR1) — even with one declared, the
          name says which meter is being monitored; with a single meter the
          panels' own headers say what they are. */}
      {declaredMeters.map((meter) => (
        <div key={meter.id} className="mt-6">
          {meters.length > 1 && (
            <h2 className="text-[15px] font-semibold text-text mb-3">{meter.name}</h2>
          )}
          <PvForecastPanel equipmentId={meter.id} />
          <PvHealthPanel equipmentId={meter.id} />
        </div>
      ))}

      {/* A meter exists but nothing is declared: only an admin can fix that,
          so only an admin sees the pointer. No meter at all stays silent —
          this page cannot create equipment. */}
      {meters.length > 0 && declaredMeters.length === 0 && isAdmin && (
        <p className="mt-6 text-[13px] text-text-secondary">
          <Link to="/settings?tab=energy" className="text-primary hover:underline">
            {t("energy.pv.setupHint")}
          </Link>
        </p>
      )}
    </div>
  );
}

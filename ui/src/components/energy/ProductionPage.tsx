import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatWh } from "./format";
import { canGoForward } from "../../store/useEnergy";
import { dateLocale } from "../../lib/locale";
import { formatEnergy } from "../../lib/format";
import type { PvForecastResponse } from "../../types";
import { PeriodHeadline } from "./PeriodHeadline";
import { periodContextLabel, todayForecast } from "./period-headline";

// Spec 196 (FR-E) — the bars' own tokens, so the legend follows the theme.
const AUTOCONSO_COLOR = "var(--color-solar-auto)";
const INJECTION_COLOR = "var(--color-solar-injection)";

export function ProductionPage() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
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

  // Spec 197 (FR-E6.2) — the forecast panels already fetch each array's
  // curve; they hand it up instead of the page asking a second time.
  const [forecasts, setForecasts] = useState<Record<string, PvForecastResponse>>({});
  const onForecastLoaded = useCallback((id: string, data: PvForecastResponse) => {
    setForecasts((prev) => ({ ...prev, [id]: data }));
  }, []);
  const isToday = period === "day" && !canGoForward(date, period);
  // Only when every production meter is declared (the history total covers
  // them all, the forecast only the declared ones) and every declared array
  // has reported, so the figure does not grow one panel at a time.
  const forecast = useMemo(() => {
    if (!isToday || declaredMeters.length === 0 || declaredMeters.length !== meters.length) {
      return null;
    }
    if (!declaredMeters.every((m) => forecasts[m.id])) return null;
    return todayForecast(declaredMeters.map((m) => forecasts[m.id]));
  }, [isToday, meters, declaredMeters, forecasts]);

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      {/* Spec 196, slice 1c — the row wraps instead of running off the edge:
          on a tablet (and at 1 024 px beside the sidebar) the title and the
          period controls do not fit side by side, so the controls go below. */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="hidden lg:block">{t("energy.production")}</h1>
        <PeriodSelector />
      </div>

      {/* Content */}
      {loading && !history ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-small">
          {t("common.loading")}
        </div>
      ) : (
        <div className="card p-4 sm:p-6">
          {/* Spec 197 (FR-E6.2) — the card opens on what was produced, read
              against what was expected today when a forecast exists. */}
          {history && (hasProdData || forecast) && (
            <PeriodHeadline
              value={formatWh(displayedProductionTotalWh(history.totals), locale)}
              context={
                forecast
                  ? t("energy.headline.ofExpectedToday", {
                      forecast: formatEnergy(forecast.totalKwh, { locale }),
                    })
                  : periodContextLabel(period, date, locale, t)
              }
              sentence={
                showSplit
                  ? [
                      t("energy.headline.selfConsumedWh", {
                        value: formatWh(history.totals.total_autoconso, locale),
                      }),
                      t("energy.headline.injected", {
                        value: formatWh(history.totals.total_injection, locale),
                      }),
                    ].join("\u00a0· ")
                  : undefined
              }
              stale={loading}
            />
          )}

          <ProductionBarChart
            points={history?.points ?? []}
            period={period}
            date={date}
            height={350}
            floorKwh={forecast?.peakHourKwh}
          />

          {/* Legend — swatches and names only since spec 197: the figures
              are in the headline. */}
          {history && hasProdData && showSplit && (
            <div className="flex items-center justify-center gap-4 mt-3 text-small text-text-secondary flex-wrap">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: AUTOCONSO_COLOR }}
                />
                {t("energy.autoconsumption")}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: INJECTION_COLOR }}
                />
                {t("energy.gridInjection")}
              </span>
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
            <h2 className="text-lead font-semibold text-text mb-3">{meter.name}</h2>
          )}
          <PvForecastPanel equipmentId={meter.id} onLoaded={onForecastLoaded} />
          <PvHealthPanel equipmentId={meter.id} />
        </div>
      ))}

      {/* A meter exists but nothing is declared: only an admin can fix that,
          so only an admin sees the pointer. No meter at all stays silent —
          this page cannot create equipment. */}
      {meters.length > 0 && declaredMeters.length === 0 && isAdmin && (
        <p className="mt-6 text-small text-text-secondary">
          <Link to="/settings?tab=energy" className="text-primary hover:underline">
            {t("energy.pv.setupHint")}
          </Link>
        </p>
      )}
    </div>
  );
}

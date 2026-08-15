import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEnergy } from "../../store/useEnergy";
import { useUiState } from "../../store/useUiState";
import { useZones } from "../../store/useZones";
import { PeriodSelector } from "./PeriodSelector";
import { EnergyBarChart } from "./EnergyBarChart";
import { EnergyByUsageChart } from "./EnergyByUsageChart";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { UnitToggle } from "./UnitToggle";
import { formatEnergyOrCost, formatKWh } from "./format";
import { getEnergyByUsage, getEquipments } from "../../api";
import type { EnergyByUsageResponse } from "../../types";
import {
  equipmentLabelMap,
  flattenZonesWithPath,
  zoneChainMap,
} from "../../lib/zone-path";
import { isSubmeterEquipment } from "../../lib/metering";

const AUTOCONSO_COLOR = "#6BCB77";

type ViewMode = "total" | "by-usage";

export function EnergyPage() {
  const { t } = useTranslation();
  const history = useEnergy((s) => s.history);
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const loading = useEnergy((s) => s.loading);
  const hasProduction = useEnergy((s) => s.hasProduction);
  const tariffConfigured = useEnergy((s) => s.tariffConfigured);
  const fetchHistory = useEnergy((s) => s.fetchHistory);
  const checkAvailability = useEnergy((s) => s.checkAvailability);
  const unit = useUiState((s) => s.energyUnit);
  const effectiveUnit = tariffConfigured ? unit : "wh";

  const [viewMode, setViewMode] = useState<ViewMode>("total");
  const [hasSubmeters, setHasSubmeters] = useState(false);
  const [byUsage, setByUsage] = useState<EnergyByUsageResponse | null>(null);
  const [byUsageLoading, setByUsageLoading] = useState(false);
  const [submeterLookup, setSubmeterLookup] = useState<
    { id: string; name: string; zoneId: string }[]
  >([]);
  const zoneTree = useZones((s) => s.tree);

  useEffect(() => {
    fetchHistory();
    checkAvailability();
  }, [fetchHistory, checkAvailability]);

  // Detect whether at least one submeter is configured, and keep the
  // id → zone lookup used to disambiguate homonym submeters (spec 139).
  useEffect(() => {
    let cancelled = false;
    getEquipments()
      .then((list) => {
        if (cancelled) return;
        // Submeters = energy_meter + metering relays (switch/water_heater, #521).
        setHasSubmeters(list.some((e) => isSubmeterEquipment(e) && e.enabled));
        setSubmeterLookup(list.map((e) => ({ id: e.id, name: e.name, zoneId: e.zoneId })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch by-usage data only when in by-usage mode.
  useEffect(() => {
    if (viewMode !== "by-usage") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setByUsageLoading(true);
    getEnergyByUsage(period, date)
      .then((res) => {
        if (cancelled) return;
        setByUsage(res);
      })
      .catch(() => {
        if (!cancelled) setByUsage(null);
      })
      .finally(() => {
        if (!cancelled) setByUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, period, date]);

  // Homonym submeters get a `name — zone` series label (spec 139). The series
  // names come from the backend, so the override is keyed by equipment id and
  // falls back to the backend name for deleted equipments.
  const labelledByUsage = useMemo(() => {
    if (!byUsage) return null;
    const ids = new Set(byUsage.submeters.map((s) => s.id));
    const labels = equipmentLabelMap(
      submeterLookup.filter((e) => ids.has(e.id)),
      zoneChainMap(flattenZonesWithPath(zoneTree)),
    );
    return {
      ...byUsage,
      submeters: byUsage.submeters.map((s) => ({
        ...s,
        name: labels.get(s.id) ?? s.name,
      })),
    };
  }, [byUsage, submeterLookup, zoneTree]);

  const hasHpHc = history ? history.totals.total_hc > 0 : false;

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      {/* Header — h1 hidden on mobile (title in topbar). PeriodSelector visible on both. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="hidden sm:block">{t("energy.consumption")}</h1>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
          <UnitToggle enabled={tariffConfigured} />
          <PeriodSelector />
        </div>
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
            {hasSubmeters && (
              <div className="flex justify-end mb-3">
                <div className="inline-flex border border-border rounded-[6px] overflow-hidden text-[12px]">
                  <button
                    type="button"
                    onClick={() => setViewMode("total")}
                    className={
                      viewMode === "total"
                        ? "px-3 py-1 bg-primary text-white"
                        : "px-3 py-1 text-text-secondary hover:bg-bg"
                    }
                  >
                    {t("energy.viewMode.total")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("by-usage")}
                    className={
                      viewMode === "by-usage"
                        ? "px-3 py-1 bg-primary text-white"
                        : "px-3 py-1 text-text-secondary hover:bg-bg"
                    }
                  >
                    {t("energy.viewMode.byUsage")}
                  </button>
                </div>
              </div>
            )}

            {viewMode === "by-usage" ? (
              byUsageLoading && !byUsage ? (
                <div className="flex items-center justify-center h-[350px] text-text-tertiary text-[13px]">
                  {t("common.loading")}
                </div>
              ) : labelledByUsage ? (
                <EnergyByUsageChart
                  data={labelledByUsage}
                  period={period}
                  date={date}
                  height={350}
                  unit={effectiveUnit}
                />
              ) : (
                <div className="flex items-center justify-center h-[350px] text-text-tertiary text-[13px]">
                  —
                </div>
              )
            ) : (
              <EnergyBarChart
                points={history?.points ?? []}
                period={period}
                date={date}
                height={350}
                unit={effectiveUnit}
              />
            )}

            {/* Legend below chart — Wh / € via formatEnergyOrCost (spec 123).
                Autoconso has no € counterpart (it's avoided cost, not billed) so
                it always renders in kWh, even when the toggle is on €. */}
            {history && viewMode === "total" && (
              <div className="flex flex-col items-center mt-3 gap-1">
                <div className="flex items-center gap-4 text-[13px] text-text-secondary flex-wrap justify-center">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#4F7BE8" }} />
                    {t("energy.gridConsumption")} :{" "}
                    {formatEnergyOrCost(
                      history.totals.total_consumption,
                      history.totals.cost_total,
                      effectiveUnit,
                      period,
                    )}
                  </span>
                  {hasHpHc && (
                    <span className="text-text-tertiary">
                      ({t("energy.peakHours")} :{" "}
                      {formatEnergyOrCost(
                        history.totals.total_hp,
                        history.totals.cost_hp,
                        effectiveUnit,
                        period,
                      )}{" "}
                      / {t("energy.offPeakHours")} :{" "}
                      {formatEnergyOrCost(
                        history.totals.total_hc,
                        history.totals.cost_hc,
                        effectiveUnit,
                        period,
                      )})
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
                  Total :{" "}
                  {formatEnergyOrCost(
                    history.totals.total_consumption + (history.totals.total_autoconso ?? 0),
                    history.totals.cost_total,
                    effectiveUnit,
                    period,
                  )}
                  {hasProduction && history.totals.total_consumption > 0 && history.totals.total_autoconso > 0 && (
                    <span className="ml-2 font-normal text-text-secondary">
                      ({Math.round(history.totals.total_autoconso / (history.totals.total_consumption + history.totals.total_autoconso) * 100)}% {t("energy.autoconsumption").toLowerCase()})
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

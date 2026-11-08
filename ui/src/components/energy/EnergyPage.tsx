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
import { formatEur, formatWh } from "./format";
import { formatPercent } from "../../lib/format";
import { SegmentedControl } from "../ui/SegmentedControl";
import { PeriodHeadline } from "./PeriodHeadline";
import { consumptionHeadline, periodContextLabel } from "./period-headline";
import { dateLocale } from "../../lib/locale";
import { getEnergyByUsage, getEquipments } from "../../api";
import type { EnergyByUsageResponse, SubmeterSeries } from "../../types";
import { equipmentLabelMap, flattenZonesWithPath, zoneChainMap } from "../../lib/zone-path";
import { isSubmeterEquipment } from "../../lib/metering";
import { byUsageSeriesColor } from "./submeterPalette";

// Spec 196 (FR-E) — the legend takes the bars' own tokens, so it follows the
// theme like the chart does.
const HP_COLOR = "var(--color-energy-hp)";
const HC_COLOR = "var(--color-energy-hc)";
const AUTOCONSO_COLOR = "var(--color-solar-auto)";

type ViewMode = "total" | "by-usage";

export function EnergyPage() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
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
    const separate = byUsage.separateSupply ?? [];
    const ids = new Set([...byUsage.submeters, ...separate].map((s) => s.id));
    const labels = equipmentLabelMap(
      submeterLookup.filter((e) => ids.has(e.id)),
      zoneChainMap(flattenZonesWithPath(zoneTree)),
    );
    const relabel = (s: SubmeterSeries) => ({ ...s, name: labels.get(s.id) ?? s.name });
    return {
      ...byUsage,
      submeters: byUsage.submeters.map(relabel),
      separateSupply: separate.map(relabel),
    };
  }, [byUsage, submeterLookup, zoneTree]);

  const hasHpHc = history ? history.totals.total_hc > 0 : false;

  const headline = history
    ? consumptionHeadline(history.totals, effectiveUnit, hasProduction)
    : null;
  const fmt = (v: number) => (effectiveUnit === "eur" ? formatEur(v, locale) : formatWh(v, locale));
  const headlineSentence = headline
    ? [
        headline.peak !== null && t("energy.headline.peak", { value: fmt(headline.peak) }),
        headline.offPeak !== null && t("energy.headline.offPeak", { value: fmt(headline.offPeak) }),
        headline.selfPct !== null &&
          t("energy.headline.selfConsumed", {
            pct: formatPercent(headline.selfPct, { locale }),
          }),
      ]
        .filter(Boolean)
        .join("\u00a0· ")
    : "";

  // Spec 197 (FR-E6.4) — the shared segmented control, beside the headline.
  const viewModeControl = hasSubmeters ? (
    <SegmentedControl<ViewMode>
      options={[
        { value: "total", label: t("energy.viewMode.total") },
        { value: "by-usage", label: t("energy.viewMode.byUsage") },
      ]}
      value={viewMode}
      onChange={setViewMode}
      label={t("energy.viewMode.label")}
    />
  ) : null;

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      {/* Header — h1 hidden below lg (title in the compact top bar). PeriodSelector always.
          Spec 196, slice 1c: the row wraps instead of running off the edge on a
          tablet, where the title and the period controls do not fit side by side. */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="hidden lg:block">{t("energy.consumption")}</h1>
        {/* Spec 197 (FR-E6.5) — one left-aligned column on a phone, the period
            control at full width. */}
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <UnitToggle enabled={tariffConfigured} className="self-start sm:self-auto" />
          <PeriodSelector />
        </div>
      </div>

      {/* Content */}
      {loading && !history ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-small">
          {t("common.loading")}
        </div>
      ) : (
        <>
          {/* Consumption chart */}
          <div className="card p-4 sm:p-6">
            {/* Spec 197 (FR-E6.1) — the card opens on the period total; the
                chart below keeps its axes and ticks. */}
            {headline ? (
              <PeriodHeadline
                value={fmt(headline.total)}
                context={periodContextLabel(period, date, locale, t)}
                sentence={headlineSentence}
                aside={viewModeControl}
              />
            ) : (
              viewModeControl && <div className="flex justify-end mb-4">{viewModeControl}</div>
            )}

            {viewMode === "by-usage" ? (
              byUsageLoading && !byUsage ? (
                <div className="flex items-center justify-center h-[350px] text-text-tertiary text-small">
                  {t("common.loading")}
                </div>
              ) : labelledByUsage ? (
                <>
                  <EnergyByUsageChart
                    data={labelledByUsage}
                    period={period}
                    date={date}
                    height={350}
                    unit={effectiveUnit}
                  />
                  {/* Spec 179 — meters on their own supply: kWh beside the
                      partition, never inside it, and never in € (their tariff
                      is not the main meter's). */}
                  {labelledByUsage.separateSupply.length > 0 && (
                    <div className="flex flex-col items-center mt-3 gap-1">
                      <div className="text-caption font-medium text-text-tertiary">
                        {t("energy.byUsage.separateSupply")}
                      </div>
                      <div className="flex items-center gap-4 text-small text-text-secondary flex-wrap justify-center">
                        {labelledByUsage.separateSupply.map((s) => (
                          <span key={s.id} className="flex items-center gap-1.5">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm"
                              style={{ backgroundColor: byUsageSeriesColor(s) }}
                            />
                            {s.name}
                            {t("common.colon")}
                            {formatWh(
                              s.points.reduce((acc, p) => acc + p.wh, 0),
                              locale,
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-[350px] text-text-tertiary text-small">
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

            {/* Legend below chart — swatches and names only since spec 197:
                the figures moved to the headline above. */}
            {history && viewMode === "total" && (
              <div className="flex items-center justify-center gap-4 mt-3 text-small text-text-secondary flex-wrap">
                {hasHpHc ? (
                  <>
                    <LegendKey color={HP_COLOR} label={t("energy.peakHours")} />
                    <LegendKey color={HC_COLOR} label={t("energy.offPeakHours")} />
                  </>
                ) : (
                  <LegendKey color={HP_COLOR} label={t("energy.gridConsumption")} />
                )}
                {hasProduction && history.totals.total_autoconso > 0 && (
                  <LegendKey color={AUTOCONSO_COLOR} label={t("energy.autoconsumption")} />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One legend entry: the bar's colour and its name, no figure (spec 197). */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

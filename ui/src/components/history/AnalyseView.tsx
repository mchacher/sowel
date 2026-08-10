import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  BarChart3,
  Plus,
  X,
  ChevronDown,
  Save,
  Copy,
  Trash2,
  Eraser,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { getEquipments, getZones, getHistoryBindings, getHistoryData, getChart } from "../../api";
import { useCharts } from "../../store/useCharts";
import { useAuth } from "../../store/useAuth";
import { flattenZonesWithPath } from "../../lib/zone-path";
import type {
  EquipmentWithDetails,
  ZoneWithChildren,
  HistoryBindingState,
  HistoryPoint,
  SavedChart,
} from "../../types";
import { PeriodSelector } from "./PeriodSelector";
import {
  booleanTickLabels,
  familyOf,
  hasEnvelope,
  periodTodayStr,
  periodToWindow,
  type ChartFamily,
  type Period,
} from "./history-utils";
import { humanBindingLabel, humanBindingLabelFromList } from "./binding-label";

// ============================================================
// Types
// ============================================================

interface SeriesConfig {
  id: string;
  equipmentId: string;
  equipmentName: string;
  zoneName: string;
  alias: string;
  category: string;
  /** Backing physical device name. Empty for saved charts loaded from
   * `chart.config.series` (which only carries equipmentId + alias) until
   * the bindings have been refetched. */
  deviceName: string;
  /** Number of bindings sharing this category on the source equipment.
   * Used by humanBindingLabel to decide whether device-name disambiguation
   * is needed. */
  sameCategoryCount: number;
  color: string;
}

interface SeriesData {
  points: HistoryPoint[];
  resolution: "raw" | "1h" | "1d";
  loading: boolean;
  error: string | null;
}

// ============================================================
// Constants
// ============================================================

const SERIES_COLORS = [
  "#1A4F6E", // primary (ocean blue)
  "#D4963F", // accent (amber)
  "#2D8B59", // green
  "#9B59B6", // purple
  "#E74C3C", // red
  "#17A2B8", // teal
  "#F39C12", // orange
  "#8E44AD", // deep purple
];

const CATEGORY_UNITS: Record<string, string> = {
  temperature: "\u00b0C",
  humidity: "%",
  pressure: "hPa",
  luminosity: "lx",
  power: "W",
  energy: "kWh",
  voltage: "V",
  current: "A",
  battery: "%",
  noise: "dB",
  co2: "ppm",
  rain: "mm",
  wind: "km/h",
  shutter_position: "%",
};

// ============================================================
// Helpers
// ============================================================

function formatTime(iso: string, period: Period): string {
  const d = new Date(iso);
  switch (period) {
    case "day":
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    case "week":
      return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    case "month":
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    case "year":
      return d.toLocaleDateString(undefined, { month: "short" });
  }
}

function formatTooltipTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================
// Component
// ============================================================

export function AnalyseView() {
  const { t } = useTranslation();
  const { chartId } = useParams();
  const navigate = useNavigate();
  const createChart = useCharts((s) => s.createChart);
  const updateChartStore = useCharts((s) => s.updateChart);
  const deleteChartStore = useCharts((s) => s.deleteChart);
  const fetchCharts = useCharts((s) => s.fetchCharts);
  // Saving/deleting charts is a config mutation (rejected server-side for
  // standard users); hide those controls. Building and viewing a chart stays
  // available to everyone (series add/remove are local until saved).
  const canManageCharts = useAuth((s) => s.user?.role === "admin");

  // --- Data sources ---
  const [zones, setZones] = useState<ZoneWithChildren[]>([]);
  const [equipments, setEquipments] = useState<EquipmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Selection state ---
  // Period + date drives the chart window (absolute, Energy-style navigator).
  // Default: today as a day.
  const [period, setPeriod] = useState<Period>("day");
  const [date, setDate] = useState<string>(() => periodTodayStr());
  const [series, setSeries] = useState<SeriesConfig[]>([]);
  const [seriesData, setSeriesData] = useState<Record<string, SeriesData>>({});
  // F1 — global envelope toggle. Default on; persisted in memory only.
  const [envelopeOn, setEnvelopeOn] = useState(true);

  // --- Saved chart state ---
  const [currentChart, setCurrentChart] = useState<SavedChart | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);

  // --- Save modal ---
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<"save" | "saveAs">("save");
  const saveInputRef = useRef<HTMLInputElement>(null);

  // --- Delete confirm ---
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // --- Add series form ---
  // Open by default on the empty workspace (`/analyse` with no chartId) so
  // the user immediately sees the zone / equipment / metric pickers instead
  // of an inscrutable empty chart placeholder.
  const [showAddForm, setShowAddForm] = useState(() => !chartId);
  const [selectedZoneId, setSelectedZoneId] = useState<string>("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string>("");
  const [availableBindings, setAvailableBindings] = useState<HistoryBindingState[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(false);

  // Track loaded chart id to avoid re-loading
  const loadedChartIdRef = useRef<string | undefined>(undefined);

  // Load zones + equipments on mount
  useEffect(() => {
    Promise.all([getZones(), getEquipments()])
      .then(([z, e]) => {
        setZones(z);
        setEquipments(e);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const flatZones = useMemo(() => flattenZonesWithPath(zones), [zones]);

  // Zone id → name lookup (leaf name, not breadcrumb)
  const zoneNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const z of flatZones) map.set(z.id, z.name);
    return map;
  }, [flatZones]);

  // Load saved chart when chartId changes
  useEffect(() => {
    if (!chartId) {
      if (loadedChartIdRef.current !== undefined) {
        setCurrentChart(null);
        setSeries([]);
        setSeriesData({});
        setPeriod("day");
        setDate(periodTodayStr());
        loadedChartIdRef.current = undefined;
      }
      return;
    }

    if (chartId === loadedChartIdRef.current) return;
    if (equipments.length === 0) return; // wait for equipments to resolve names

    setLoadingChart(true);
    (async () => {
      try {
        const chart = await getChart(chartId);
        setCurrentChart(chart);
        loadedChartIdRef.current = chartId;
        // New format (period + date) takes precedence. Legacy charts saved
        // with `timeRange` are mapped to the closest period on today, so the
        // user can pick the date back to whatever they had in mind.
        if (chart.config.period && chart.config.date) {
          setPeriod(chart.config.period);
          setDate(chart.config.date);
        } else {
          const legacy = chart.config.timeRange;
          const mapped: Period =
            legacy === "30d" ? "month" : legacy === "7d" ? "week" : "day";
          setPeriod(mapped);
          setDate(periodTodayStr());
        }

        // Enrich saved series with category + deviceName + sameCategoryCount
        // so humanBindingLabel can render friendly labels in pills, tooltip
        // and legend. Without this, freshly-loaded charts fall back to raw
        // aliases ("Bureau / THR / humidity") instead of the equipment-level
        // label ("Humidité intérieure").
        const uniqueEqIds = [...new Set(chart.config.series.map((s) => s.equipmentId))];
        const bindingsPerEq = new Map<string, HistoryBindingState[]>();
        await Promise.all(
          uniqueEqIds.map(async (eqId) => {
            try {
              bindingsPerEq.set(eqId, await getHistoryBindings(eqId));
            } catch {
              // Best-effort: an equipment may have been deleted since save.
            }
          }),
        );

        const newSeries: SeriesConfig[] = [];
        for (const sc of chart.config.series) {
          const eq = equipments.find((e) => e.id === sc.equipmentId);
          const eqBindings = bindingsPerEq.get(sc.equipmentId) ?? [];
          const binding = eqBindings.find((b) => b.alias === sc.alias);
          const sameCategoryCount = binding
            ? eqBindings.filter((b) => b.category === binding.category).length
            : 1;
          const id = `${sc.equipmentId}:${sc.alias}`;
          newSeries.push({
            id,
            equipmentId: sc.equipmentId,
            equipmentName: eq?.name ?? sc.equipmentId,
            zoneName: eq?.zoneId ? (zoneNameById.get(eq.zoneId) ?? "") : "",
            alias: sc.alias,
            category: binding?.category ?? "",
            deviceName: binding?.deviceName ?? "",
            sameCategoryCount,
            color: SERIES_COLORS[newSeries.length % SERIES_COLORS.length],
          });
        }
        setSeries(newSeries);
        setSeriesData({});
      } catch {
        setCurrentChart(null);
        loadedChartIdRef.current = chartId;
      } finally {
        setLoadingChart(false);
      }
    })();
  }, [chartId, equipments, zoneNameById]);

  const filteredEquipments = useMemo(() => {
    return equipments.filter((e) => e.zoneId === selectedZoneId);
  }, [equipments, selectedZoneId]);

  useEffect(() => {
    if (!selectedEquipmentId) {
      setAvailableBindings([]);
      return;
    }
    setLoadingBindings(true);
    getHistoryBindings(selectedEquipmentId)
      .then((bindings) => setAvailableBindings(bindings.filter((b) => b.effectiveOn)))
      .catch(() => setAvailableBindings([]))
      .finally(() => setLoadingBindings(false));
  }, [selectedEquipmentId]);

  const fetchSeriesData = useCallback(
    async (seriesList: SeriesConfig[], window: { from: Date; to: Date }) => {
      const fromIso = window.from.toISOString();
      const toIso = window.to.toISOString();
      for (const s of seriesList) {
        setSeriesData((prev) => ({
          ...prev,
          [s.id]: { points: [], resolution: "raw", loading: true, error: null },
        }));
        try {
          const result = await getHistoryData(s.equipmentId, s.alias, {
            from: fromIso,
            to: toIso,
            aggregation: "auto",
          });
          setSeriesData((prev) => ({
            ...prev,
            [s.id]: { points: result.points, resolution: result.resolution, loading: false, error: null },
          }));
        } catch (err) {
          setSeriesData((prev) => ({
            ...prev,
            [s.id]: { points: [], resolution: "raw", loading: false, error: err instanceof Error ? err.message : "Failed" },
          }));
        }
      }
    },
    [],
  );

  const chartWindow = useMemo(() => periodToWindow(date, period), [date, period]);

  useEffect(() => {
    if (series.length > 0) {
      fetchSeriesData(series, chartWindow);
    }
  }, [series, chartWindow, fetchSeriesData]);

  // --- Actions ---
  const addSeries = (binding: HistoryBindingState) => {
    const equipment = equipments.find((e) => e.id === selectedEquipmentId);
    if (!equipment) return;

    const id = `${selectedEquipmentId}:${binding.alias}`;
    if (series.some((s) => s.id === id)) return;

    const sameCategoryCount = availableBindings.filter(
      (b) => b.category === binding.category,
    ).length;

    const newSeries: SeriesConfig = {
      id,
      equipmentId: selectedEquipmentId,
      equipmentName: equipment.name,
      zoneName: zoneNameById.get(equipment.zoneId ?? "") ?? "",
      alias: binding.alias,
      category: binding.category,
      deviceName: binding.deviceName,
      sameCategoryCount,
      color: SERIES_COLORS[series.length % SERIES_COLORS.length],
    };

    setSeries((prev) => [...prev, newSeries]);
  };

  const removeSeries = (id: string) => {
    setSeries((prev) => prev.filter((s) => s.id !== id));
    setSeriesData((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // --- Save handlers ---
  const buildConfig = () => ({
    series: series.map((s) => ({ equipmentId: s.equipmentId, alias: s.alias })),
    period,
    date,
  });

  const handleSave = async () => {
    if (currentChart) {
      setSaving(true);
      try {
        const updated = await updateChartStore(currentChart.id, { config: buildConfig() });
        setCurrentChart(updated);
      } catch { /* ignore */ }
      setSaving(false);
    } else {
      setSaveMode("save");
      setSaveName("");
      setShowSaveModal(true);
    }
  };

  const handleSaveAs = () => {
    setSaveMode("saveAs");
    setSaveName(currentChart?.name ? `${currentChart.name} (2)` : "");
    setShowSaveModal(true);
  };

  const handleSaveConfirm = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const chart = await createChart(saveName.trim(), buildConfig());
      setCurrentChart(chart);
      loadedChartIdRef.current = chart.id;
      setShowSaveModal(false);
      navigate(`/analyse/${chart.id}`, { replace: true });
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!currentChart) return;
    try {
      await deleteChartStore(currentChart.id);
      setCurrentChart(null);
      loadedChartIdRef.current = undefined;
      setShowDeleteConfirm(false);
      navigate("/analyse", { replace: true });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (showSaveModal) {
      setTimeout(() => saveInputRef.current?.focus(), 50);
    }
  }, [showSaveModal]);

  useEffect(() => {
    fetchCharts();
  }, [fetchCharts]);

  // --- Merge all series into a unified chart dataset ---
  // The X axis is a continuous time-scale (epoch milliseconds), not a
  // categorical string. Otherwise Recharts treats each point as its own
  // category and a month label like "mars" appears multiple times on the
  // X axis (once per data point in that month). With a time scale,
  // tickFormatter renders "mars" / "avr." / ... only where Recharts
  // places a tick, and minTickGap controls the spacing.
  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    const timeMap = new Map<string, Record<string, number>>();

    for (const s of series) {
      const data = seriesData[s.id];
      if (!data?.points) continue;
      for (const p of data.points) {
        const existing = timeMap.get(p.time) ?? {};
        existing[s.id] = p.value;
        // F1 — carry the envelope band keys when the API returned them
        // (downsampled buckets at 1h / 1d resolution).
        if (typeof p.min === "number") existing[`${s.id}:min`] = p.min;
        if (typeof p.max === "number") existing[`${s.id}:max`] = p.max;
        timeMap.set(p.time, existing);
      }
    }

    const sorted = Array.from(timeMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([time, values]) => ({
      time: new Date(time).getTime(),
      ...values,
    }));
  }, [series, seriesData]);

  // F7 — family of the first series determines the chart family. The picker
  // forbids cross-family mixing, so all series share this family at render time.
  const lockedFamily: ChartFamily | null = useMemo(() => {
    if (series.length === 0) return null;
    return familyOf(series[0].category);
  }, [series]);

  // Active aggregation resolution across all series. Envelope only renders at
  // 1h or 1d (raw points have min = max = mean by definition).
  const activeResolution = useMemo(() => {
    for (const s of series) {
      const r = seriesData[s.id]?.resolution;
      if (r === "1h" || r === "1d") return r;
    }
    return "raw" as const;
  }, [series, seriesData]);

  const showEnvelopeToggle =
    lockedFamily === "measurements" &&
    activeResolution !== "raw" &&
    series.some((s) => hasEnvelope(s.category));

  const familyLabel = useMemo(() => {
    if (!lockedFamily) return "";
    return t(`analyse.family.${lockedFamily}`);
  }, [lockedFamily, t]);

  const clearChart = useCallback(() => {
    setSeries([]);
    setSeriesData({});
    setShowAddForm(true);
    if (!selectedZoneId && flatZones.length > 0) {
      setSelectedZoneId(flatZones[0].id);
    }
  }, [flatZones, selectedZoneId]);

  // Auto-preselect the first zone when the workspace loads empty so the
  // equipment dropdown is immediately populated. Without this, the user has
  // to pick a zone manually before any equipment shows up.
  useEffect(() => {
    if (showAddForm && !selectedZoneId && flatZones.length > 0) {
      setSelectedZoneId(flatZones[0].id);
    }
  }, [showAddForm, selectedZoneId, flatZones]);

  /** Minimum pixel gap between X ticks per period. Tighter for shorter
   * windows (day shows hours), looser for longer windows (year shows
   * months — we want roughly one tick per month). */
  const xMinTickGap = useMemo(() => {
    switch (period) {
      case "day":
        return 60;
      case "week":
        return 70;
      case "month":
        return 80;
      case "year":
        return 90;
    }
  }, [period]);

  const anyLoading = series.some((s) => seriesData[s.id]?.loading);

  const textTertiary = "var(--color-text-tertiary)";
  const borderColor = "var(--color-border-light)";

  if (loading || loadingChart) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const title = currentChart?.name ?? t("analyse.title");

  return (
    <div className="space-y-4">
      {/* Header — copies Energy's two-child flex layout (title left,
          PeriodSelector right, justify-between). Save actions move to the
          end of the series-pills row so the header stays clean. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="hidden sm:flex items-center gap-3">
          <BarChart3 size={20} strokeWidth={1.5} className="text-primary" />
          <h1>{title}</h1>
        </div>
        <PeriodSelector
          period={period}
          date={date}
          onPeriodChange={setPeriod}
          onDateChange={setDate}
        />
      </div>

      {/* Series pills + add button (left) — save / save-as / delete (right) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {series.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-surface border border-border"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color }}
              />
              {s.zoneName && <span className="text-text-tertiary">{s.zoneName} /</span>}
              <span className="text-text">{s.equipmentName}</span>
              <span className="text-text-tertiary">
                /{" "}
                {s.category
                  ? humanBindingLabel(
                      { alias: s.alias, category: s.category, deviceName: s.deviceName, sameCategoryCount: s.sameCategoryCount },
                      t,
                    )
                  : s.alias}
              </span>
              {CATEGORY_UNITS[s.category] && (
                <span className="text-text-tertiary">({CATEGORY_UNITS[s.category]})</span>
              )}
              <button
                type="button"
                onClick={() => removeSeries(s.id)}
                className="ml-0.5 text-text-tertiary hover:text-error transition-colors cursor-pointer"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              const next = !showAddForm;
              setShowAddForm(next);
              if (next && !selectedZoneId && flatZones.length > 0) {
                setSelectedZoneId(flatZones[0].id);
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium
              bg-primary-light text-primary hover:bg-primary hover:text-white
              transition-colors cursor-pointer"
          >
            <Plus size={12} strokeWidth={2} />
            {t("analyse.addSeries")}
          </button>

          {/* F7 — family-lock indicator */}
          {lockedFamily && (
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-border-light text-text-secondary"
              title={t("analyse.familyLocked", { family: familyLabel })}
            >
              {familyLabel}
            </span>
          )}
        </div>

        {series.length > 0 && (
          <div className="flex items-center gap-1">
            {/* F1 — global envelope toggle. Only meaningful for the
                measurements family at aggregated resolutions. */}
            {showEnvelopeToggle && (
              <button
                type="button"
                onClick={() => setEnvelopeOn((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium
                  transition-colors cursor-pointer ${
                    envelopeOn
                      ? "bg-primary-light text-primary hover:bg-primary hover:text-white"
                      : "text-text-secondary hover:bg-border-light hover:text-text"
                  }`}
                title={t("analyse.envelopeToggle")}
              >
                <Layers size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">{t("analyse.envelopeToggle")}</span>
              </button>
            )}
            {/* F7 — clear chart (resets the family lock) */}
            <button
              type="button"
              onClick={clearChart}
              className="flex items-center justify-center p-1.5 rounded-[6px] text-text-secondary
                hover:bg-border-light hover:text-text transition-colors cursor-pointer"
              title={t("analyse.clearChart")}
            >
              <Eraser size={14} strokeWidth={1.5} />
            </button>
            {canManageCharts && (
            <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium
                bg-primary-light text-primary hover:bg-primary hover:text-white
                transition-colors cursor-pointer disabled:opacity-50"
              title={t("analyse.save")}
            >
              <Save size={14} strokeWidth={1.5} />
              <span className="hidden sm:inline">{t("analyse.save")}</span>
            </button>
            <button
              type="button"
              onClick={handleSaveAs}
              disabled={saving}
              className="flex items-center justify-center p-1.5 rounded-[6px] text-text-secondary
                hover:bg-border-light hover:text-text transition-colors cursor-pointer disabled:opacity-50"
              title={t("analyse.saveAs")}
            >
              <Copy size={14} strokeWidth={1.5} />
            </button>
            {currentChart && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center justify-center p-1.5 rounded-[6px] text-text-secondary
                  hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                title={t("analyse.deleteChart")}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            )}
            </>
            )}
          </div>
        )}
      </div>

      {/* Add series form */}
      {showAddForm && (
        <div className="bg-surface rounded-[10px] border border-border p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Zone selector */}
            <div>
              <label className="block text-[11px] font-medium text-text-tertiary mb-1">
                {t("analyse.zone")}
              </label>
              <div className="relative">
                <select
                  value={selectedZoneId}
                  onChange={(e) => {
                    setSelectedZoneId(e.target.value);
                    setSelectedEquipmentId("");
                  }}
                  className="w-full px-3 py-1.5 pr-8 rounded-[6px] border border-border bg-surface text-[12px] text-text appearance-none cursor-pointer"
                >
                  {flatZones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.path}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              </div>
            </div>

            {/* Equipment selector */}
            <div>
              <label className="block text-[11px] font-medium text-text-tertiary mb-1">
                {t("analyse.equipment")}
              </label>
              <div className="relative">
                <select
                  value={selectedEquipmentId}
                  onChange={(e) => setSelectedEquipmentId(e.target.value)}
                  className="w-full px-3 py-1.5 pr-8 rounded-[6px] border border-border bg-surface text-[12px] text-text appearance-none cursor-pointer"
                >
                  <option value="">{t("analyse.selectEquipment")}</option>
                  {filteredEquipments.map((eq) => (
                    <option key={eq.id} value={eq.id}>{eq.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Metric selector */}
          {selectedEquipmentId && (
            <div>
              <label className="block text-[11px] font-medium text-text-tertiary mb-1">
                {t("analyse.metric")}
              </label>
              {loadingBindings ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 size={12} className="animate-spin text-text-tertiary" />
                  <span className="text-[12px] text-text-tertiary">{t("common.loading")}</span>
                </div>
              ) : availableBindings.length === 0 ? (
                <p className="text-[12px] text-text-tertiary py-2">{t("analyse.noHistorizedData")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableBindings.map((b) => {
                    const alreadyAdded = series.some(
                      (s) => s.equipmentId === selectedEquipmentId && s.alias === b.alias,
                    );
                    // F7 — family lock: once a series is added, only bindings
                    // of the same family can be added.
                    const bindingFamily = familyOf(b.category);
                    const familyMismatch =
                      lockedFamily !== null &&
                      bindingFamily !== null &&
                      bindingFamily !== lockedFamily;
                    const disabled = alreadyAdded || familyMismatch;
                    const title = familyMismatch
                      ? t("analyse.familyIncompatible")
                      : b.alias;
                    return (
                      <button
                        key={b.bindingId}
                        type="button"
                        disabled={disabled}
                        onClick={() => addSeries(b)}
                        title={title}
                        className={`px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                          disabled
                            ? "bg-border-light text-text-tertiary cursor-not-allowed opacity-60"
                            : "bg-border-light/50 text-text hover:bg-primary-light hover:text-primary"
                        }`}
                      >
                        {humanBindingLabelFromList(b, availableBindings, t)}
                        {CATEGORY_UNITS[b.category] && (
                          <span className="text-text-tertiary ml-1">({CATEGORY_UNITS[b.category]})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {series.length === 0 ? (
        // Quiet placeholder when the workspace is empty. The add-series form
        // above is the call to action; the placeholder just signals the chart
        // area without competing for attention.
        <div className="bg-surface/50 rounded-[10px] border border-dashed border-border flex flex-col items-center justify-center py-12 text-center">
          <BarChart3 size={28} strokeWidth={1} className="text-border mb-2" />
          <p className="text-[12px] text-text-tertiary">{t("analyse.emptyHint")}</p>
        </div>
      ) : (
        <div className="bg-surface rounded-[10px] border border-border p-4">
          {anyLoading && (
            <div className="flex items-center gap-2 mb-3">
              <Loader2 size={14} className="animate-spin text-text-tertiary" />
              <span className="text-[12px] text-text-tertiary">{t("history.loading")}</span>
            </div>
          )}

          {chartData.length === 0 && !anyLoading ? (
            <div className="flex items-center justify-center py-16 text-[12px] text-text-tertiary">
              {t("history.noData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              {(() => {
                // Common X axis, Y axis, Tooltip, Legend props shared by every
                // family. Built inline (not extracted as constants) because
                // each family renders a different chart container (BarChart /
                // LineChart / ComposedChart) and Recharts requires the axes
                // to be direct children of the container.
                const commonGrid = <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />;
                const commonXAxis = (
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    scale="time"
                    tick={{ fontSize: 10, fill: textTertiary }}
                    tickLine={false}
                    axisLine={{ stroke: borderColor }}
                    minTickGap={xMinTickGap}
                    tickFormatter={(ts: number) => formatTime(new Date(ts).toISOString(), period)}
                  />
                );
                const commonLegend = (
                  <Legend
                    formatter={(value: string) => {
                      const s = series.find((ser) => ser.id === value);
                      if (!s) return value;
                      const metricLabel = s.category
                        ? humanBindingLabel(
                            { alias: s.alias, category: s.category, deviceName: s.deviceName, sameCategoryCount: s.sameCategoryCount },
                            t,
                          )
                        : s.alias;
                      return s.zoneName
                        ? `${s.zoneName} / ${s.equipmentName} / ${metricLabel}`
                        : `${s.equipmentName} / ${metricLabel}`;
                    }}
                    wrapperStyle={{ fontSize: "11px" }}
                  />
                );
                const labelFormatter = (_: unknown, payload?: readonly { payload?: Record<string, unknown> }[]) => {
                  const ts = payload?.[0]?.payload?.time;
                  if (typeof ts === "number") {
                    return formatTooltipTime(new Date(ts).toISOString());
                  }
                  return "";
                };
                const measurementFormatter = (
                  value?: number | string,
                  name?: string,
                  item?: { payload?: Record<string, number> },
                ) => {
                  const num = typeof value === "number" ? value : Number(value);
                  if (!Number.isFinite(num)) return ["", ""];
                  // Skip min/max keys — only the mean shows in the tooltip row;
                  // the band values are appended next to it.
                  if (name?.endsWith(":min") || name?.endsWith(":max")) return [null, null] as unknown as [string, string];
                  const s = series.find((ser) => ser.id === name);
                  const unit = s ? CATEGORY_UNITS[s.category] : "";
                  const formatted = Number.isInteger(num) ? String(num) : num.toFixed(1);
                  let valueText = unit ? `${formatted} ${unit}` : formatted;
                  if (s && item?.payload) {
                    const min = item.payload[`${s.id}:min`];
                    const max = item.payload[`${s.id}:max`];
                    if (typeof min === "number" && typeof max === "number") {
                      const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
                      valueText += ` (${fmt(min)} / ${fmt(max)})`;
                    }
                  }
                  const metricLabel = s && s.category
                    ? humanBindingLabel(
                        { alias: s.alias, category: s.category, deviceName: s.deviceName, sameCategoryCount: s.sameCategoryCount },
                        t,
                      )
                    : (s?.alias ?? (name ?? ""));
                  const label = s
                    ? (s.zoneName ? `${s.zoneName} / ${s.equipmentName} / ${metricLabel}` : `${s.equipmentName} / ${metricLabel}`)
                    : (name ?? "");
                  return [valueText, label];
                };
                const booleanFormatter = (value?: number | string, name?: string) => {
                  const s = series.find((ser) => ser.id === name);
                  if (!s) return [String(value ?? ""), name ?? ""];
                  const num = typeof value === "number" ? value : Number(value);
                  const [offKey, onKey] = booleanTickLabels(s.category);
                  let stateText: string;
                  if (!Number.isFinite(num)) {
                    stateText = "";
                  } else if (num <= 0.05) {
                    stateText = t(offKey);
                  } else if (num >= 0.95) {
                    stateText = t(onKey);
                  } else {
                    // Aggregated bucket: mean ∈ (0, 1) → percent of active time.
                    stateText = `${Math.round(num * 100)}% ${t(onKey)}`;
                  }
                  const metricLabel = humanBindingLabel(
                    { alias: s.alias, category: s.category, deviceName: s.deviceName, sameCategoryCount: s.sameCategoryCount },
                    t,
                  );
                  const label = s.zoneName
                    ? `${s.zoneName} / ${s.equipmentName} / ${metricLabel}`
                    : `${s.equipmentName} / ${metricLabel}`;
                  return [stateText, label];
                };
                const tooltipStyle = {
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: "var(--color-text)",
                };

                if (lockedFamily === "cumulative") {
                  // F2 — bar chart for rain / energy.
                  return (
                    <BarChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                      {commonGrid}
                      {commonXAxis}
                      <YAxis
                        tick={{ fontSize: 10, fill: textTertiary }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={(v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={labelFormatter}
                        formatter={measurementFormatter}
                      />
                      {commonLegend}
                      {series.map((s) => (
                        <Bar
                          key={s.id}
                          dataKey={s.id}
                          name={s.id}
                          fill={s.color}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  );
                }

                if (lockedFamily === "states") {
                  // F5 — step chart on a [0, 1] axis with semantic tick labels.
                  // Tick labels come from the first series' category (every
                  // series in the chart shares the same axis).
                  const [offKey, onKey] = booleanTickLabels(series[0].category);
                  return (
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                      {commonGrid}
                      {commonXAxis}
                      <YAxis
                        domain={[0, 1]}
                        ticks={[0, 1]}
                        tick={{ fontSize: 10, fill: textTertiary }}
                        tickLine={false}
                        axisLine={false}
                        width={68}
                        tickFormatter={(v: number) => (v >= 0.5 ? t(onKey) : t(offKey))}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={labelFormatter}
                        formatter={booleanFormatter}
                      />
                      {commonLegend}
                      {series.map((s) => (
                        <Line
                          key={s.id}
                          type="stepAfter"
                          dataKey={s.id}
                          name={s.id}
                          stroke={s.color}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, fill: s.color }}
                          isAnimationActive={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  );
                }

                // measurements (default) — line chart, optionally with envelope band.
                const showBand = envelopeOn && activeResolution !== "raw";
                return (
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    {commonGrid}
                    {commonXAxis}
                    <YAxis
                      tick={{ fontSize: 10, fill: textTertiary }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={labelFormatter}
                      formatter={measurementFormatter}
                    />
                    {commonLegend}
                    {showBand &&
                      series
                        .filter((s) => hasEnvelope(s.category))
                        .map((s) => {
                          // Recharts Area renders a band when dataKey returns
                          // a [min, max] tuple. Function dataKey is evaluated
                          // per data point.
                          const minKey = `${s.id}:min`;
                          const maxKey = `${s.id}:max`;
                          return (
                            <Area
                              key={`${s.id}:band`}
                              type="monotone"
                              dataKey={(d: Record<string, number>) => {
                                const lo = d[minKey];
                                const hi = d[maxKey];
                                if (typeof lo === "number" && typeof hi === "number") {
                                  return [lo, hi];
                                }
                                return undefined as unknown as [number, number];
                              }}
                              stroke="none"
                              fill={s.color}
                              fillOpacity={0.15}
                              isAnimationActive={false}
                              legendType="none"
                              name={`${s.id}:band`}
                              connectNulls
                              activeDot={false}
                            />
                          );
                        })}
                    {series.map((s) => (
                      <Line
                        key={s.id}
                        type="monotone"
                        dataKey={s.id}
                        name={s.id}
                        stroke={s.color}
                        strokeWidth={1.5}
                        dot={false}
                        activeDot={{ r: 3, fill: s.color }}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </ComposedChart>
                );
              })()}
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Save name modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-surface rounded-[14px] border border-border shadow-xl w-[360px] p-5">
            <h2 className="text-[15px] font-semibold text-text mb-3">
              {saveMode === "saveAs" ? t("analyse.saveAs") : t("analyse.save")}
            </h2>
            <label className="block text-[11px] font-medium text-text-tertiary mb-1">
              {t("analyse.saveName")}
            </label>
            <input
              ref={saveInputRef}
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveConfirm(); }}
              placeholder={t("analyse.saveNamePlaceholder")}
              className="w-full px-3 py-2 rounded-[6px] border border-border bg-surface text-[13px] text-text
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-text-secondary
                  hover:bg-border-light transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSaveConfirm}
                disabled={!saveName.trim() || saving}
                className="px-3 py-1.5 rounded-[6px] text-[12px] font-medium bg-primary text-white
                  hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : t("analyse.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && currentChart && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-surface rounded-[14px] border border-border shadow-xl w-[360px] p-5">
            <h2 className="text-[15px] font-semibold text-text mb-3">
              {t("analyse.deleteChart")}
            </h2>
            <p className="text-[13px] text-text-secondary">
              {t("analyse.deleteConfirm", { name: currentChart.name })}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 rounded-[6px] text-[12px] font-medium text-text-secondary
                  hover:bg-border-light transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-3 py-1.5 rounded-[6px] text-[12px] font-medium bg-error text-white
                  hover:bg-error/80 transition-colors cursor-pointer"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

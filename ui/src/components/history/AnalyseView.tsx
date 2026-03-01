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
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { getEquipments, getZones, getHistoryBindings, getHistoryData, getChart } from "../../api";
import { useCharts } from "../../store/useCharts";
import type {
  EquipmentWithDetails,
  ZoneWithChildren,
  HistoryBindingState,
  HistoryPoint,
  SavedChart,
} from "../../types";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { rangeToFrom } from "./history-utils";
import type { TimeRange } from "./history-utils";

// ============================================================
// Types
// ============================================================

interface SeriesConfig {
  id: string;
  equipmentId: string;
  equipmentName: string;
  alias: string;
  category: string;
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

function flattenZones(zones: ZoneWithChildren[]): { id: string; name: string; depth: number; label: string }[] {
  const result: { id: string; name: string; depth: number; label: string }[] = [];
  function walk(list: ZoneWithChildren[], depth: number, parentName?: string) {
    for (const z of list) {
      const label = parentName ? `${parentName} › ${z.name}` : z.name;
      result.push({ id: z.id, name: z.name, depth, label });
      if (z.children.length > 0) walk(z.children, depth + 1, label);
    }
  }
  walk(zones, 0);
  return result;
}

function formatTime(iso: string, range: TimeRange): string {
  const d = new Date(iso);
  if (range === "6h" || range === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

  // --- Data sources ---
  const [zones, setZones] = useState<ZoneWithChildren[]>([]);
  const [equipments, setEquipments] = useState<EquipmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  // --- Selection state ---
  const [range, setRange] = useState<TimeRange>("24h");
  const [series, setSeries] = useState<SeriesConfig[]>([]);
  const [seriesData, setSeriesData] = useState<Record<string, SeriesData>>({});

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
  const [showAddForm, setShowAddForm] = useState(false);
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

  // Load saved chart when chartId changes
  useEffect(() => {
    if (!chartId) {
      if (loadedChartIdRef.current !== undefined) {
        setCurrentChart(null);
        setSeries([]);
        setSeriesData({});
        setRange("24h");
        loadedChartIdRef.current = undefined;
      }
      return;
    }

    if (chartId === loadedChartIdRef.current) return;

    setLoadingChart(true);
    getChart(chartId)
      .then((chart) => {
        setCurrentChart(chart);
        loadedChartIdRef.current = chartId;
        setRange((chart.config.timeRange as TimeRange) || "24h");
        const newSeries: SeriesConfig[] = [];
        for (const sc of chart.config.series) {
          const eq = equipments.find((e) => e.id === sc.equipmentId);
          const id = `${sc.equipmentId}:${sc.alias}`;
          newSeries.push({
            id,
            equipmentId: sc.equipmentId,
            equipmentName: eq?.name ?? sc.equipmentId,
            alias: sc.alias,
            category: "",
            color: SERIES_COLORS[newSeries.length % SERIES_COLORS.length],
          });
        }
        setSeries(newSeries);
        setSeriesData({});
      })
      .catch(() => {
        setCurrentChart(null);
        loadedChartIdRef.current = chartId;
      })
      .finally(() => setLoadingChart(false));
  }, [chartId, equipments]);

  const flatZones = useMemo(() => flattenZones(zones), [zones]);

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
    async (seriesList: SeriesConfig[], timeRange: TimeRange) => {
      for (const s of seriesList) {
        setSeriesData((prev) => ({
          ...prev,
          [s.id]: { points: [], resolution: "raw", loading: true, error: null },
        }));
        try {
          const result = await getHistoryData(s.equipmentId, s.alias, {
            from: rangeToFrom(timeRange),
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

  useEffect(() => {
    if (series.length > 0) {
      fetchSeriesData(series, range);
    }
  }, [series, range, fetchSeriesData]);

  // --- Actions ---
  const addSeries = (binding: HistoryBindingState) => {
    const equipment = equipments.find((e) => e.id === selectedEquipmentId);
    if (!equipment) return;

    const id = `${selectedEquipmentId}:${binding.alias}`;
    if (series.some((s) => s.id === id)) return;

    const newSeries: SeriesConfig = {
      id,
      equipmentId: selectedEquipmentId,
      equipmentName: equipment.name,
      alias: binding.alias,
      category: binding.category,
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
    timeRange: range,
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
  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    const timeMap = new Map<string, Record<string, number>>();

    for (const s of series) {
      const data = seriesData[s.id];
      if (!data?.points) continue;
      for (const p of data.points) {
        const existing = timeMap.get(p.time) ?? {};
        existing[s.id] = p.value;
        timeMap.set(p.time, existing);
      }
    }

    const sorted = Array.from(timeMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    return sorted.map(([time, values]) => ({
      time,
      label: formatTime(time, range),
      ...values,
    }));
  }, [series, seriesData, range]);

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
      {/* Header with range selector + save buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} strokeWidth={1.5} className="text-primary" />
          <h1 className="text-[18px] font-semibold text-text">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          {series.length > 0 && (
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
                {t("analyse.save")}
              </button>
              <button
                type="button"
                onClick={handleSaveAs}
                disabled={saving}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium
                  text-text-secondary hover:bg-border-light hover:text-text
                  transition-colors cursor-pointer disabled:opacity-50"
                title={t("analyse.saveAs")}
              >
                <Copy size={14} strokeWidth={1.5} />
              </button>
              {currentChart && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium
                    text-text-secondary hover:bg-error/10 hover:text-error
                    transition-colors cursor-pointer"
                  title={t("analyse.deleteChart")}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              )}
            </>
          )}
          <TimeRangeSelector value={range} onChange={setRange} />
        </div>
      </div>

      {/* Series pills + add button */}
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
            <span className="text-text">{s.equipmentName}</span>
            <span className="text-text-tertiary">/ {s.alias}</span>
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
                      {z.label}
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
                    return (
                      <button
                        key={b.bindingId}
                        type="button"
                        disabled={alreadyAdded}
                        onClick={() => addSeries(b)}
                        className={`px-2.5 py-1 rounded-[4px] text-[12px] font-medium transition-colors cursor-pointer ${
                          alreadyAdded
                            ? "bg-border-light text-text-tertiary cursor-not-allowed"
                            : "bg-border-light/50 text-text hover:bg-primary-light hover:text-primary"
                        }`}
                      >
                        {b.alias}
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
        <div className="bg-surface rounded-[10px] border border-border flex flex-col items-center justify-center py-20 text-center">
          <BarChart3 size={40} strokeWidth={1} className="text-border mb-3" />
          <p className="text-[14px] text-text-secondary">{t("analyse.empty")}</p>
          <p className="text-[12px] text-text-tertiary mt-1">{t("analyse.emptyHint")}</p>
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
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: textTertiary }}
                  tickLine={false}
                  axisLine={{ stroke: borderColor }}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: textTertiary }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "var(--color-text)",
                  }}
                  labelFormatter={(_, payload) => {
                    if (payload?.[0]?.payload?.time) {
                      return formatTooltipTime(payload[0].payload.time as string);
                    }
                    return "";
                  }}
                  formatter={(value?: number, name?: string) => {
                    const v = value ?? 0;
                    const s = series.find((ser) => ser.id === name);
                    const unit = s ? CATEGORY_UNITS[s.category] : "";
                    const formatted = Number.isInteger(v) ? String(v) : v.toFixed(1);
                    const label = s ? `${s.equipmentName} / ${s.alias}` : (name ?? "");
                    return [unit ? `${formatted} ${unit}` : formatted, label];
                  }}
                />
                <Legend
                  formatter={(value: string) => {
                    const s = series.find((ser) => ser.id === value);
                    if (!s) return value;
                    return `${s.equipmentName} / ${s.alias}`;
                  }}
                  wrapperStyle={{ fontSize: "11px" }}
                />
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
              </LineChart>
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

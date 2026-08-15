import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
  MoveVertical,
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
import type { LegendPayload } from "recharts";
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
  axisForCategory,
  booleanTickLabels,
  CATEGORY_UNITS,
  familiesCompatible,
  familyOf,
  hasEnvelope,
  isBooleanCategory,
  measurementUnits,
  periodTodayStr,
  periodToWindow,
  SERIES_COLORS,
  type ChartFamily,
  type Period,
} from "./history-utils";
import { humanBindingLabel, humanBindingLabelFromList } from "./binding-label";
import { SeriesColorPicker } from "./SeriesColorPicker";
import { fitYAxis } from "./y-axis";
import { firstChartTarget } from "./analyse-nav";
import { ChartTooltip } from "./ChartTooltip";
import { mergeSeriesData } from "./chart-utils";

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
}

/** A series with its effective colour resolved — what the render consumes.
 * Spec 145 keeps the colour out of `SeriesConfig` on purpose: `series` is a
 * dependency of the history-fetch effect, so recolouring a series through it
 * would refetch every series from InfluxDB. */
type StyledSeries = SeriesConfig & { color: string };

/** Where the colour picker was opened from — see `colorPicker` state. */
type ColorPickerAnchor =
  | { kind: "pill"; id: string }
  | { kind: "legend"; id: string; x: number; y: number };

interface SeriesData {
  points: HistoryPoint[];
  resolution: "raw" | "1h" | "1d";
  loading: boolean;
  error: string | null;
}

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

/** Y axis tick label. The unit is appended only when the chart carries two
 *  scales — on a single-axis chart the legend and tooltip already say it. */
function formatAxisTick(value: number, unit: string): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

// ============================================================
// Component
// ============================================================

export function AnalyseView() {
  const { t } = useTranslation();
  const { chartId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `?new` = the user explicitly asked for the empty "build a new chart"
  // workspace (sidebar / mobile-drawer "New chart"). Without it, the bare
  // /analyse route redirects to the first saved chart (#498, point 1).
  const isNewWorkspace = searchParams.has("new");
  const createChart = useCharts((s) => s.createChart);
  const updateChartStore = useCharts((s) => s.updateChart);
  const deleteChartStore = useCharts((s) => s.deleteChart);
  const fetchCharts = useCharts((s) => s.fetchCharts);
  const savedCharts = useCharts((s) => s.charts);
  const chartsLoading = useCharts((s) => s.loading);
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
  // Spec 145 — per-series colour overrides, keyed by series id. Kept apart
  // from `series` so recolouring never re-triggers the history fetch.
  const [seriesColors, setSeriesColors] = useState<Record<string, string>>({});
  // The picker opens from two places: the dot on a series pill, and the legend
  // entry under the chart. A legend entry has no DOM node of ours to anchor to,
  // so it carries the click point, expressed in chart-card coordinates.
  const [colorPicker, setColorPicker] = useState<ColorPickerAnchor | null>(null);
  // Spec 145 — fit the measurement axis to the data. Off by default: the
  // zero-anchored axis is how every chart reads today.
  const [yAxisFit, setYAxisFit] = useState(false);

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
  // Open on the empty workspace (`/analyse` / `/analyse?new`, no chartId) so
  // the user immediately sees the zone / equipment / metric pickers; collapsed
  // when viewing a saved chart for a cleaner screen (#498, point 3). Synced to
  // `chartId` below — `/analyse` and `/analyse/:id` share one AnalysePage
  // element (no route key), so the default-landing redirect (#498, point 1)
  // changes chartId without remounting, and an init-only value would stay
  // stale (add panel left open on the first chart).
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
        setSeriesColors({});
        setYAxisFit(false);
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
        // Keep the saved period (day/week/month/year) but always open on
        // today rather than the date the chart was saved on (#498, point 2) —
        // a saved chart is a view template, users want the latest data.
        if (chart.config.period) {
          setPeriod(chart.config.period);
        } else {
          const legacy = chart.config.timeRange;
          setPeriod(legacy === "30d" ? "month" : legacy === "7d" ? "week" : "day");
        }
        setDate(periodTodayStr());
        // Spec 145 — absent on pre-145 charts, which then keep the
        // zero-anchored axis they were saved with.
        setYAxisFit(chart.config.yAxisFit ?? false);

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
        const newColors: Record<string, string> = {};
        for (const sc of chart.config.series) {
          const eq = equipments.find((e) => e.id === sc.equipmentId);
          const eqBindings = bindingsPerEq.get(sc.equipmentId) ?? [];
          const binding = eqBindings.find((b) => b.alias === sc.alias);
          const sameCategoryCount = binding
            ? eqBindings.filter((b) => b.category === binding.category).length
            : 1;
          const id = `${sc.equipmentId}:${sc.alias}`;
          if (sc.color) newColors[id] = sc.color;
          newSeries.push({
            id,
            equipmentId: sc.equipmentId,
            equipmentName: eq?.name ?? sc.equipmentId,
            zoneName: eq?.zoneId ? (zoneNameById.get(eq.zoneId) ?? "") : "",
            alias: sc.alias,
            category: binding?.category ?? "",
            deviceName: binding?.deviceName ?? "",
            sameCategoryCount,
          });
        }
        setSeries(newSeries);
        setSeriesColors(newColors);
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
    setSeriesColors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // Spec 145 — resolve each series' colour: the user's override if any, the
  // palette entry at its position otherwise (the pre-145 behaviour). Everything
  // that renders reads this list; `series` stays the identity list.
  const styledSeries = useMemo<StyledSeries[]>(
    () =>
      series.map((s, i) => ({
        ...s,
        color: seriesColors[s.id] ?? SERIES_COLORS[i % SERIES_COLORS.length],
      })),
    [series, seriesColors],
  );

  // Anchor for the picker opened from a legend entry — the click point is
  // expressed relative to this card.
  const chartCardRef = useRef<HTMLDivElement>(null);

  /** Legend entries carry `name={series.id}`, so the payload identifies the
   *  series directly. */
  const openColorPickerFromLegend = useCallback(
    (data: LegendPayload, _index: number, event: MouseEvent) => {
      const id = typeof data.value === "string" ? data.value : "";
      const rect = chartCardRef.current?.getBoundingClientRect();
      if (!id || !rect) return;
      // Always open, never toggle: the picker's own outside-click handler has
      // already closed it by the time this click fires, so a toggle would only
      // ever reopen. Escape or a click elsewhere closes it (same as IconPicker).
      setColorPicker({
        kind: "legend",
        id,
        // Clamped so the panel stays inside the card when the entry clicked
        // sits near the right edge.
        x: Math.min(Math.max(event.clientX - rect.left, 0), Math.max(rect.width - 184, 0)),
        y: event.clientY - rect.top,
      });
    },
    [],
  );

  // --- Save handlers ---
  // The effective colour is persisted for every series, not just the
  // overridden ones, so a saved chart keeps its exact look even if the default
  // palette is later reordered.
  const buildConfig = () => ({
    series: styledSeries.map((s) => ({
      equipmentId: s.equipmentId,
      alias: s.alias,
      color: s.color,
    })),
    period,
    date,
    yAxisFit,
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

  // #498, point 1 — the bare /analyse workspace opens on the first saved chart
  // instead of the empty builder. `?new` (sidebar / mobile "New chart") opts
  // out; with no saved charts the empty workspace stays.
  useEffect(() => {
    if (chartId) return;
    const target = firstChartTarget({
      isNew: isNewWorkspace,
      loading: chartsLoading,
      charts: savedCharts,
    });
    if (target) navigate(target, { replace: true });
  }, [chartId, isNewWorkspace, chartsLoading, savedCharts, navigate]);

  // Keep the add panel collapsed on a saved chart and open on the empty
  // builder as chartId changes (the redirect above mutates it without a
  // remount). Runs only on chartId transitions, so it never fights the
  // user's manual toggle while they stay on one view.
  useEffect(() => {
    setShowAddForm(!chartId);
  }, [chartId]);

  // --- Merge all series into a unified chart dataset ---
  // The X axis is a continuous time-scale (epoch milliseconds), not a
  // categorical string. Otherwise Recharts treats each point as its own
  // category and a month label like "mars" appears multiple times on the
  // X axis (once per data point in that month). With a time scale,
  // tickFormatter renders "mars" / "avr." / ... only where Recharts
  // places a tick, and minTickGap controls the spacing.
  // Each row is `{ time, [seriesId]: value, [seriesId:min]: …, [seriesId:max]: … }`
  // — annotated so the fitted-axis pass can read the series keys back out.
  // Merge + dedup live in `mergeSeriesData` (see #537 for why epoch keying,
  // not ISO strings, is what keeps the tick culling alive).
  const chartData = useMemo<Record<string, number>[]>(
    () => mergeSeriesData(series.map((s) => ({ id: s.id, points: seriesData[s.id]?.points ?? [] }))),
    [series, seriesData],
  );

  // Families present in the chart. Spec 144 — `measurements` and `states` may
  // coexist (states get their own 0/1 axis); `cumulative` stays alone. An
  // unclassified category (family `null`) is charted as a measurement.
  const chartFamilies = useMemo(() => {
    const families = new Set<ChartFamily>();
    for (const s of series) {
      const f = familyOf(s.category);
      if (f) families.add(f);
    }
    return families;
  }, [series]);

  const hasStateSeries = useMemo(() => series.some((s) => isBooleanCategory(s.category)), [series]);
  // Anything that is neither a state nor a bar series lands on the left axis,
  // including unclassified categories (family `null`).
  const hasMeasurementSeries = useMemo(
    () => series.some((s) => familyOf(s.category) === null || familyOf(s.category) === "measurements"),
    [series],
  );

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
    !chartFamilies.has("cumulative") &&
    hasMeasurementSeries &&
    activeResolution !== "raw" &&
    series.some((s) => hasEnvelope(s.category));

  // Whether the min/max band is actually drawn — the fitted domain has to
  // cover it, so this moves out of the render branch.
  const showBand = envelopeOn && activeResolution !== "raw";

  // Spec 145 — the fit only makes sense on the measurement axis: bars need
  // their zero baseline, and a states-only chart owns the fixed [0, 1] scale.
  const showYAxisFitToggle = !chartFamilies.has("cumulative") && hasMeasurementSeries;

  // F3 — the distinct quantities plotted on the measurement axis. Two of them
  // get an axis each (left and right); the rule itself lives in history-utils
  // so it can be tested.
  const chartUnits = useMemo(() => measurementUnits(series.map((s) => s.category)), [series]);
  const splitAxes = chartUnits.length === 2;

  const axisIdOf = useCallback(
    (category: string) => axisForCategory(category, chartUnits),
    [chartUnits],
  );

  // With one scale per side, tinting each axis like its curve says at a glance
  // which side to read a series off. Only when the axis carries a single
  // series: several curves on one axis have no single colour to borrow, and a
  // shared axis (one, or three-plus quantities) stays neutral.
  const axisColors = useMemo(() => {
    const colorOf = (target: "left" | "right") => {
      if (!splitAxes) return null;
      const onAxis = styledSeries.filter((s) => axisIdOf(s.category) === target);
      return onAxis.length === 1 ? onAxis[0].color : null;
    };
    return { left: colorOf("left"), right: colorOf("right") };
  }, [splitAxes, styledSeries, axisIdOf]);

  // Domain + ticks per measurement axis when the fit is on. Built from what
  // each axis actually carries: its own series, plus their envelope bounds
  // when the band is on screen.
  const fittedAxes = useMemo(() => {
    const fitAxis = (target: "left" | "right") => {
      if (!yAxisFit || !showYAxisFitToggle) return null;

      const keys: string[] = [];
      for (const s of series) {
        if (axisIdOf(s.category) !== target) continue;
        keys.push(s.id);
        if (showBand && hasEnvelope(s.category)) keys.push(`${s.id}:min`, `${s.id}:max`);
      }
      if (keys.length === 0) return null;

      const values: number[] = [];
      for (const row of chartData) {
        for (const key of keys) {
          const v = row[key];
          if (typeof v === "number") values.push(v);
        }
      }
      return fitYAxis(values);
    };

    return { left: fitAxis("left"), right: fitAxis("right") };
  }, [yAxisFit, showYAxisFitToggle, series, chartData, showBand, axisIdOf]);

  const familyLabel = useMemo(() => {
    if (series.length === 0) return "";
    if (hasStateSeries && hasMeasurementSeries) return t("analyse.family.mixed");
    if (hasStateSeries) return t("analyse.family.states");
    if (chartFamilies.has("cumulative")) return t("analyse.family.cumulative");
    return t("analyse.family.measurements");
  }, [series, hasStateSeries, hasMeasurementSeries, chartFamilies, t]);

  const clearChart = useCallback(() => {
    setSeries([]);
    setSeriesData({});
    setSeriesColors({});
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
          {styledSeries.map((s) => (
            <div
              key={s.id}
              className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-surface border border-border"
            >
              {/* Spec 145 — the dot opens the colour picker for this series. */}
              <button
                type="button"
                onClick={() => setColorPicker({ kind: "pill", id: s.id })}
                title={t("analyse.seriesColor")}
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer
                  hover:ring-2 hover:ring-primary/30 transition-shadow"
                style={{ backgroundColor: s.color }}
              />
              {colorPicker?.kind === "pill" && colorPicker.id === s.id && (
                <SeriesColorPicker
                  color={s.color}
                  onChange={(color) => setSeriesColors((prev) => ({ ...prev, [s.id]: color }))}
                  onClose={() => setColorPicker(null)}
                />
              )}
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

          {/* F7 — family indicator (spec 144: reads "Mesures + États" on a
              mixed chart) */}
          {familyLabel && (
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
            {/* Spec 145 — fit the measurement axis to the data instead of
                anchoring it at zero. */}
            {showYAxisFitToggle && (
              <button
                type="button"
                onClick={() => setYAxisFit((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-[12px] font-medium
                  transition-colors cursor-pointer ${
                    yAxisFit
                      ? "bg-primary-light text-primary hover:bg-primary hover:text-white"
                      : "text-text-secondary hover:bg-border-light hover:text-text"
                  }`}
                title={t("analyse.yAxisFit")}
              >
                <MoveVertical size={14} strokeWidth={1.5} />
                <span className="hidden sm:inline">{t("analyse.yAxisFit")}</span>
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
                    // F7 — family lock, relaxed by spec 144: a binding is
                    // rejected only when it cannot share a chart with one of
                    // the families already plotted (i.e. cumulative vs rest).
                    const bindingFamily = familyOf(b.category);
                    const familyMismatch = [...chartFamilies].some(
                      (f) => !familiesCompatible(f, bindingFamily),
                    );
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
        <div ref={chartCardRef} className="relative bg-surface rounded-[10px] border border-border p-4">
          {/* Colour picker opened from a legend entry — placed at the click
              point and opening upwards, so it does not fall out of the card
              (the legend sits at its bottom edge). */}
          {colorPicker?.kind === "legend" && (
            <div className="absolute w-0 h-0" style={{ left: colorPicker.x, top: colorPicker.y }}>
              <SeriesColorPicker
                color={
                  styledSeries.find((s) => s.id === colorPicker.id)?.color ?? SERIES_COLORS[0]
                }
                placement="above"
                onChange={(color) =>
                  setSeriesColors((prev) => ({ ...prev, [colorPicker.id]: color }))
                }
                onClose={() => setColorPicker(null)}
              />
            </div>
          )}
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
                    wrapperStyle={{ fontSize: "11px", cursor: "pointer" }}
                    onClick={openColorPickerFromLegend}
                  />
                );
                // #498, point 4 — one responsive tooltip for every family. The
                // custom card caps its width and wraps the long labels so it
                // never overflows on mobile; per-series value formatting
                // (measurement unit, boolean state, envelope band) lives in
                // ChartTooltip / tooltip-format.
                const tooltip = (
                  <Tooltip
                    content={<ChartTooltip series={styledSeries} />}
                    allowEscapeViewBox={{ x: false, y: false }}
                    wrapperStyle={{ zIndex: 20 }}
                  />
                );

                if (chartFamilies.has("cumulative")) {
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
                      {tooltip}
                      {commonLegend}
                      {styledSeries.map((s) => (
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

                // Tick labels of the 0/1 axis come from the first state series'
                // category — every state series shares that axis.
                const stateSeries = series.filter((s) => isBooleanCategory(s.category));
                const [stateOffKey, stateOnKey] = booleanTickLabels(
                  stateSeries[0]?.category ?? "",
                );

                if (hasStateSeries && !hasMeasurementSeries) {
                  // F5 — step chart on a [0, 1] axis with semantic tick labels.
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
                        tickFormatter={(v: number) => (v >= 0.5 ? t(stateOnKey) : t(stateOffKey))}
                      />
                      {tooltip}
                      {commonLegend}
                      {styledSeries.map((s) => (
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

                // measurements (default) — line chart, optionally with envelope
                // band. Spec 144 — when state series are mixed in, they get a
                // dedicated 0/1 axis on the right so the measurement scale is
                // left untouched.
                return (
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                    {commonGrid}
                    {commonXAxis}
                    {/* Spec 145 — passing our own ticks alongside the domain is
                        what pins the bounds down: an explicit domain alone gets
                        re-niced (and widened) by Recharts. Without the fit,
                        neither prop is set and the axis is the zero-anchored
                        default. F3 — when the chart plots exactly two
                        quantities, the ticks carry their unit: with a scale on
                        each side, bare numbers give no clue which is which. */}
                    <YAxis
                      yAxisId="left"
                      {...(fittedAxes.left
                        ? { domain: fittedAxes.left.domain, ticks: fittedAxes.left.ticks }
                        : {})}
                      tick={{ fontSize: 10, fill: axisColors.left ?? textTertiary }}
                      tickLine={false}
                      axisLine={false}
                      width={splitAxes ? 62 : 52}
                      tickFormatter={(v: number) => formatAxisTick(v, splitAxes ? chartUnits[0] : "")}
                    />
                    {splitAxes && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        {...(fittedAxes.right
                          ? { domain: fittedAxes.right.domain, ticks: fittedAxes.right.ticks }
                          : {})}
                        tick={{ fontSize: 10, fill: axisColors.right ?? textTertiary }}
                        tickLine={false}
                        axisLine={false}
                        width={62}
                        tickFormatter={(v: number) => formatAxisTick(v, chartUnits[1])}
                      />
                    )}
                    {hasStateSeries && (
                      <YAxis
                        yAxisId="state"
                        orientation="right"
                        domain={[0, 1]}
                        ticks={[0, 1]}
                        tick={{ fontSize: 10, fill: textTertiary }}
                        tickLine={false}
                        axisLine={false}
                        width={68}
                        tickFormatter={(v: number) => (v >= 0.5 ? t(stateOnKey) : t(stateOffKey))}
                      />
                    )}
                    {tooltip}
                    {commonLegend}
                    {showBand &&
                      styledSeries
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
                              yAxisId={axisIdOf(s.category)}
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
                    {styledSeries.map((s) => {
                      const isState = isBooleanCategory(s.category);
                      return (
                        <Line
                          key={s.id}
                          yAxisId={axisIdOf(s.category)}
                          type={isState ? "stepAfter" : "monotone"}
                          dataKey={s.id}
                          name={s.id}
                          stroke={s.color}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, fill: s.color }}
                          isAnimationActive={false}
                          connectNulls
                        />
                      );
                    })}
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

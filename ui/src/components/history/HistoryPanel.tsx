import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { getHistoryData, getHistoryStatus } from "../../api";
import type { HistoryPoint, HistoryBindingState } from "../../types";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { rangeToFrom } from "./history-utils";
import type { TimeRange } from "./history-utils";
import { TimeSeriesChart } from "./TimeSeriesChart";

interface HistoryPanelProps {
  equipmentId: string;
  bindings: HistoryBindingState[];
}

interface ChartState {
  points: HistoryPoint[];
  resolution: "raw" | "1h" | "1d";
  loading: boolean;
  error: string | null;
}

const RESOLUTION_I18N: Record<string, string> = {
  raw: "history.raw",
  "1h": "history.hourly",
  "1d": "history.daily",
};

/**
 * History charts panel — shows expandable charts for each historized binding.
 * Only visible when history is enabled and the equipment has historized bindings.
 */
export function HistoryPanel({ equipmentId, bindings }: HistoryPanelProps) {
  const { t } = useTranslation();
  const [historyEnabled, setHistoryEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(true);
  const [range, setRange] = useState<TimeRange>("24h");
  const [expandedAlias, setExpandedAlias] = useState<string | null>(null);
  const [charts, setCharts] = useState<Record<string, ChartState>>({});

  // Check if history is enabled on mount
  useEffect(() => {
    getHistoryStatus()
      .then((status) => setHistoryEnabled(status.enabled && status.connected))
      .catch(() => setHistoryEnabled(false));
  }, []);

  const historizedBindings = bindings.filter((b) => b.effectiveOn);

  const fetchChart = useCallback(
    async (alias: string, timeRange: TimeRange) => {
      setCharts((prev) => ({
        ...prev,
        [alias]: { points: [], resolution: "raw", loading: true, error: null },
      }));

      try {
        const result = await getHistoryData(equipmentId, alias, {
          from: rangeToFrom(timeRange),
          aggregation: "auto",
        });
        setCharts((prev) => ({
          ...prev,
          [alias]: {
            points: result.points,
            resolution: result.resolution,
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        setCharts((prev) => ({
          ...prev,
          [alias]: {
            points: [],
            resolution: "raw",
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load",
          },
        }));
      }
    },
    [equipmentId],
  );

  // Fetch chart data when expanding or changing range
  useEffect(() => {
    if (expandedAlias) {
      fetchChart(expandedAlias, range);
    }
  }, [expandedAlias, range, fetchChart]);

  // Don't render if history is not enabled or no historized bindings
  if (historyEnabled === null) return null; // Still loading
  if (!historyEnabled || historizedBindings.length === 0) return null;

  const handleToggle = (alias: string) => {
    setExpandedAlias((prev) => (prev === alias ? null : alias));
  };

  // Find the unit for a binding from its category
  const getUnit = (binding: HistoryBindingState): string | undefined => {
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
    return CATEGORY_UNITS[binding.category];
  };

  return (
    <div className="bg-surface rounded-[10px] border border-border mb-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full p-4 text-left cursor-pointer"
      >
        {open
          ? <ChevronDown size={14} strokeWidth={1.5} className="text-text-tertiary" />
          : <ChevronRight size={14} strokeWidth={1.5} className="text-text-tertiary" />
        }
        <BarChart3 size={14} strokeWidth={1.5} className="text-text-tertiary" />
        <span className="text-[13px] font-medium text-text-secondary">
          {t("history.chart")}
        </span>
        <span className="text-[11px] text-text-tertiary">
          {historizedBindings.length}
        </span>
        {open && (
          <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
            <TimeRangeSelector value={range} onChange={setRange} />
          </div>
        )}
      </button>

      {open && <div className="px-4 pb-4 space-y-1">
        {historizedBindings.map((binding) => {
          const isExpanded = expandedAlias === binding.alias;
          const chart = charts[binding.alias];
          const unit = getUnit(binding);

          return (
            <div key={binding.bindingId}>
              {/* Binding row — clickable to expand */}
              <button
                type="button"
                onClick={() => handleToggle(binding.alias)}
                className={`flex items-center justify-between w-full px-2.5 py-1.5 rounded-[4px] text-[12px] cursor-pointer transition-colors ${
                  isExpanded
                    ? "bg-primary-light"
                    : "bg-border-light/50 hover:bg-border-light"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-primary">{binding.alias}</span>
                  <span className="text-text-tertiary">({binding.category})</span>
                </div>
                <BarChart3
                  size={12}
                  strokeWidth={1.5}
                  className={isExpanded ? "text-primary" : "text-text-tertiary"}
                />
              </button>

              {/* Chart (expanded) */}
              {isExpanded && (
                <div className="mt-2 mb-3 px-1">
                  {chart?.loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={16} className="animate-spin text-text-tertiary" />
                      <span className="ml-2 text-[12px] text-text-tertiary">
                        {t("history.loading")}
                      </span>
                    </div>
                  ) : chart?.error ? (
                    <div className="text-[12px] text-error text-center py-8">
                      {chart.error}
                    </div>
                  ) : (
                    <>
                      <TimeSeriesChart
                        points={chart?.points ?? []}
                        range={range}
                        resolution={chart?.resolution ?? "raw"}
                        unit={unit}
                      />
                      {chart?.resolution && (
                        <div className="text-[10px] text-text-tertiary text-right mt-1">
                          {t("history.resolution")}: {t(RESOLUTION_I18N[chart.resolution])}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

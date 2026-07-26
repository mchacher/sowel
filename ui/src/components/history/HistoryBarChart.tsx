import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { HistoryPoint } from "../../types";
import type { TimeRange } from "./history-utils";
import { aggregateToBuckets, formatLabel, pickTickInterval } from "./chart-utils";

interface HistoryBarChartProps {
  points: HistoryPoint[];
  range: TimeRange;
  resolution: "raw" | "1h" | "1d";
  unit?: string;
  height?: number;
}

const BAR_COLOR = "#4F7BE8";

interface ChartDatum {
  /** First line of the X tick label. */
  label: string;
  /** Optional second line (used for 7d to stack weekday + day). */
  label2?: string;
  time: string;
  value: number;
}

function formatTooltipTime(iso: string, range: TimeRange): string {
  const d = new Date(iso);
  if (range === "7d" || range === "30d") {
    // Daily bucket — show the day in full, no hour.
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
  // Hourly bucket — show the day + start hour.
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a value with its unit for tooltip display. */
function formatValueWithUnit(value: number, unit?: string): string {
  // Energy: convert Wh to kWh when appropriate
  if (unit === "Wh" || unit === "kWh") {
    const kwh = unit === "kWh" ? value : value / 1000;
    if (kwh >= 100) return `${Math.round(kwh)} kWh`;
    if (kwh >= 10) return `${kwh.toFixed(1)} kWh`;
    if (kwh >= 1) return `${kwh.toFixed(2)} kWh`;
    const wh = unit === "kWh" ? value * 1000 : value;
    return `${Math.round(wh)} Wh`;
  }

  // Generic: show value with appropriate precision + unit
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Format Y-axis tick value — adapts to unit. */
function formatYAxis(value: number, unit?: string): string {
  // Energy: show in kWh
  if (unit === "Wh" || unit === "kWh") {
    const kwh = unit === "kWh" ? value : value / 1000;
    if (kwh >= 100) return `${Math.round(kwh)}`;
    if (kwh >= 10) return `${kwh.toFixed(0)}`;
    if (kwh >= 1) return `${kwh.toFixed(1)}`;
    return `${kwh.toFixed(2)}`;
  }

  // Generic: show raw value with smart precision
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return `${value.toFixed(0)}`;
  if (value >= 1) return `${value.toFixed(1)}`;
  if (value > 0) return `${value.toFixed(2)}`;
  return "0";
}

/** Track the current viewport width so the chart can adapt tick density. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

interface RechartsTick {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value: string; index?: number };
}

interface CustomTickProps extends RechartsTick {
  fontSize: number;
  /** Pre-computed labels keyed by data index — only indices in this map render. */
  labels: Map<number, { line1: string; line2?: string }>;
}

/**
 * Renders the X-axis tick on one or two lines if the index is in `labels`.
 *
 * Indices missing from the map render an empty <g> — this is how we dedupe
 * adjacent ticks that would otherwise show the same label twice (e.g. two
 * "jeu. 14" labels when 7d data clusters several samples on one day).
 */
function CustomTick({ x = 0, y = 0, index, payload, fontSize, labels }: CustomTickProps) {
  const dataIndex = payload?.index ?? index ?? -1;
  const entry = labels.get(dataIndex);
  if (!entry) return <g />;
  const { line1, line2 } = entry;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={12}
        textAnchor="middle"
        fill="var(--color-text-tertiary)"
        fontSize={fontSize}
      >
        {line1}
      </text>
      {line2 !== undefined && (
        <text
          x={0}
          y={0}
          dy={12 + fontSize + 1}
          textAnchor="middle"
          fill="var(--color-text-secondary)"
          fontSize={fontSize}
          fontWeight={600}
        >
          {line2}
        </text>
      )}
    </g>
  );
}

export function HistoryBarChart({ points, range, unit, height = 200 }: HistoryBarChartProps) {
  const viewportWidth = useViewportWidth();
  const isNarrow = viewportWidth < 360;

  const data = useMemo<ChartDatum[]>(() => {
    // Re-bucket raw points into uniform time slots (hourly for 6h/24h, daily for
    // 7d/30d). This collapses sparse hourly samples into 1 bar per day on the
    // longer ranges — e.g. 2 rainy hours on Thursday show as a single Thursday
    // bar instead of 2 detached spikes.
    const bucketed = aggregateToBuckets(points, range);
    return bucketed.map((p) => {
      const { line1, line2 } = formatLabel(p.time, range);
      return { label: line1, label2: line2, time: p.time, value: p.value };
    });
  }, [points, range]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12px] text-text-tertiary" style={{ height }}>
        Aucune donnée
      </div>
    );
  }

  const tickInterval = pickTickInterval(data.length, viewportWidth, range);
  const tickFontSize = isNarrow ? 9 : 10;
  const has2LineLabels = data.some((d) => d.label2 !== undefined);
  const xAxisHeight = has2LineLabels ? 36 : 20;
  const chartHeight = has2LineLabels ? height + 16 : height;

  // Pre-compute the labels Recharts will actually show, and skip those that
  // would repeat the previous shown label (e.g. two "jeu. 14" in a row when
  // hourly data clusters around one day).
  const labels = new Map<number, { line1: string; line2?: string }>();
  const step = tickInterval + 1;
  let prevKey = "";
  for (let i = 0; i < data.length; i += step) {
    const d = data[i];
    const key = `${d.label}|${d.label2 ?? ""}`;
    if (key !== prevKey) {
      labels.set(i, { line1: d.label, line2: d.label2 });
      prevKey = key;
    }
  }

  // Tooltip label adapts to unit
  const tooltipLabel = unit === "Wh" || unit === "kWh"
    ? "Consommation"
    : unit === "mm"
      ? "Pluie"
      : "Valeur";

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
        <XAxis
          // Use the unique timestamp as the category key. `label` (the weekday
          // on 7d) is NOT unique — a 7-day window spans 8 daily bars, so the
          // repeated weekday made Recharts resolve a hovered bar to the first
          // bar sharing that label (e.g. hovering "Sun 26" showed "Sun 19").
          // Tick labels are drawn by CustomTick via the row index, so switching
          // the key does not change what the axis displays.
          dataKey="time"
          interval={tickInterval}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          height={xAxisHeight}
          tick={(tickProps: unknown) => (
            <CustomTick
              {...(tickProps as RechartsTick)}
              fontSize={tickFontSize}
              labels={labels}
            />
          )}
        />
        <YAxis
          tick={{ fontSize: tickFontSize, fill: "var(--color-text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatYAxis(v, unit)}
          width={isNarrow ? 36 : 50}
        />
        <Tooltip
          cursor={false}
          contentStyle={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          formatter={(value: number | undefined) => [formatValueWithUnit(value ?? 0, unit), tooltipLabel]}
          labelFormatter={(_, payload) => {
            if (payload?.[0]?.payload?.time) {
              return formatTooltipTime(payload[0].payload.time as string, range);
            }
            return "";
          }}
        />
        <Bar
          dataKey="value"
          fill={BAR_COLOR}
          activeBar={{ fill: "#6B93F0" }}
          radius={[2, 2, 0, 0]}
          maxBarSize={40}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

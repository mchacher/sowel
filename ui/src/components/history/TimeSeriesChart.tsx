import { CHART_TICK_FONT, CHART_TOOLTIP_FONT } from "../../lib/chart-font";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { HistoryPoint } from "../../types";
import { rangeToDurationMs, type TimeRange } from "./history-utils";
import { formatSeriesTooltip } from "./tooltip-format";
import { currentLocale, formatDuration, formatNumber } from "../../lib/format";

interface TimeSeriesChartProps {
  points: HistoryPoint[];
  range: TimeRange;
  resolution: "raw" | "1h" | "1d";
  unit?: string;
  height?: number;
  /** Timestamp (ms) when the data was fetched — used to extend chart to "now". */
  fetchTime?: number;
  /** Data type — "boolean" or "enum" use step interpolation instead of smooth curves. */
  dataType?: string;
  /** Data category — "power" renders as area chart with gradient fill. */
  category?: string;
}

function formatTime(iso: string, range: TimeRange): string {
  const d = new Date(iso);
  if (range === "6h" || range === "24h") {
    return d.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return d.toLocaleDateString(currentLocale(), { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(currentLocale(), { month: "short", day: "numeric" });
}

function formatTooltipTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(currentLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** How long the series has been silent, or null if the gap is under 5 minutes. */
function formatRelativeTime(isoTime: string, now: number): string | null {
  const diffMs = now - new Date(isoTime).getTime();
  if (diffMs < 5 * 60_000) return null;
  return formatDuration(diffMs / 1000);
}

const POWER_COLOR = "#D4963F";
const POWER_GRADIENT_ID = "powerGradient";

export function TimeSeriesChart({ points, range, resolution, unit, height = 200, fetchTime, dataType, category }: TimeSeriesChartProps) {
  const { t } = useTranslation();
  const isDiscrete = dataType === "boolean" || dataType === "enum";
  const isPower = category === "power";

  const { data, lastRealTime, domain } = useMemo(() => {
    const mapped = points.map((p) => ({
      time: p.time,
      ts: new Date(p.time).getTime(),
      value: p.value,
      min: p.min,
      max: p.max,
    }));

    if (mapped.length === 0) {
      return { data: mapped, lastRealTime: null as string | null, domain: undefined };
    }

    const lastPoint = mapped[mapped.length - 1];
    const lastRealTimeIso = lastPoint.time;

    // Extend chart line to current time with a synthetic point (only when fetchTime is known)
    if (fetchTime && fetchTime - lastPoint.ts > 60_000) {
      mapped.push({
        time: new Date(fetchTime).toISOString(),
        ts: fetchTime,
        value: lastPoint.value,
        min: undefined,
        max: undefined,
      });
    }

    // Anchor the X-axis to the requested window [now - range, now] so spacing is linear in time,
    // not in data-point index. Without an explicit numeric domain Recharts would otherwise treat
    // the axis as categorical and squash long gaps between irregular samples.
    const to = fetchTime ?? mapped[mapped.length - 1].ts;
    const from = to - rangeToDurationMs(range);

    return { data: mapped, lastRealTime: lastRealTimeIso, domain: [from, to] as [number, number] };
  }, [points, range, fetchTime]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-caption text-text-tertiary" style={{ height }}>
        {t("history.noData")}
      </div>
    );
  }

  const hasMinMax = resolution !== "raw" && data.some((d) => d.min !== undefined);
  const staleDuration = lastRealTime && fetchTime ? formatRelativeTime(lastRealTime, fetchTime) : null;

  // Use CSS variables for chart colors — works in both light and dark mode
  const primaryColor = isPower ? POWER_COLOR : "var(--color-primary)";
  const primaryLightColor = "var(--color-primary-light)";
  const textSecondary = "var(--color-text-secondary)";
  const textTertiary = "var(--color-text-tertiary)";
  const borderColor = "var(--color-border-light)";

  return (
    <div>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        {/* Gradient definition for power area fill */}
        {isPower && (
          <defs>
            <linearGradient id={POWER_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={POWER_COLOR} stopOpacity={0.3} />
              <stop offset="100%" stopColor={POWER_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
        )}

        <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={domain ?? ["dataMin", "dataMax"]}
          tickFormatter={(ts: number) => formatTime(new Date(ts).toISOString(), range)}
          tick={{ fontSize: CHART_TICK_FONT, fill: textTertiary }}
          tickLine={false}
          axisLine={{ stroke: borderColor }}
          minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: CHART_TICK_FONT, fill: textTertiary }}
          tickLine={false}
          axisLine={false}
          width={48}
          {...(isDiscrete
            ? { domain: [0, 1], ticks: [0, 1], tickFormatter: (v: number) => (v === 1 ? t("controls.on") : t("controls.off")) }
            : isPower
              ? { tickFormatter: (v: number) => (v >= 1000 ? `${formatNumber(v / 1000, { maxDecimals: 1 })}k` : formatNumber(v, { maxDecimals: 0 })) }
              : { tickFormatter: (v: number) => formatNumber(v, { maxDecimals: 1 }) }
          )}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-surface)",
            border: `1px solid var(--color-border)`,
            borderRadius: "6px",
            fontSize: CHART_TOOLTIP_FONT,
            color: "var(--color-text)",
          }}
          labelFormatter={(_, payload) => {
            if (payload?.[0]?.payload?.time) {
              return formatTooltipTime(payload[0].payload.time as string);
            }
            return "";
          }}
          formatter={(value: unknown, name: unknown) =>
            formatSeriesTooltip(value, name, { unit, isPower, isDiscrete, t })
          }
        />

        {/* Min/Max area fill for aggregated data (non-power) */}
        {hasMinMax && !isPower && (
          <Area
            type="monotone"
            dataKey="max"
            stroke="none"
            fill={primaryLightColor}
            fillOpacity={0.5}
            isAnimationActive={false}
          />
        )}

        {/* Power: area chart with gradient fill */}
        {isPower && (
          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#${POWER_GRADIENT_ID})`}
            isAnimationActive={false}
          />
        )}

        {/* Main value line */}
        <Line
          type={isDiscrete ? "stepAfter" : "monotone"}
          dataKey="value"
          stroke={primaryColor}
          strokeWidth={isPower ? 2 : 1.5}
          dot={false}
          activeDot={{ r: 3, fill: primaryColor }}
          isAnimationActive={false}
        />

        {/* Min line (subtle) */}
        {hasMinMax && (
          <Line
            type="monotone"
            dataKey="min"
            stroke={textTertiary}
            strokeWidth={0.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
        )}
        {/* Max line (subtle) */}
        {hasMinMax && (
          <Line
            type="monotone"
            dataKey="max"
            stroke={textSecondary}
            strokeWidth={0.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
    {staleDuration && (
      <div className="text-caption text-warning-ink text-right mt-1">
        {t("history.lastMeasurement", { duration: staleDuration })}
      </div>
    )}
    </div>
  );
}

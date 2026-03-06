import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  CartesianGrid,
} from "recharts";
import type { HistoryPoint } from "../../types";
import type { TimeRange } from "./history-utils";

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

function formatValue(v: number, unit?: string): string {
  const formatted = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Returns a human-readable relative time string, or null if gap < 5 minutes. */
function formatRelativeTime(isoTime: string, now: number, tFn: (key: string) => string): string | null {
  const diffMs = now - new Date(isoTime).getTime();
  if (diffMs < 5 * 60_000) return null;

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remH = hours % 24;
    return remH > 0
      ? `${days}${tFn("time.day")} ${remH}${tFn("time.hour")}`
      : `${days}${tFn("time.day")}`;
  }
  if (hours > 0) {
    const remM = minutes % 60;
    return remM > 0
      ? `${hours}${tFn("time.hour")} ${remM}${tFn("time.min")}`
      : `${hours}${tFn("time.hour")}`;
  }
  return `${minutes}${tFn("time.min")}`;
}

export function TimeSeriesChart({ points, range, resolution, unit, height = 200, fetchTime, dataType }: TimeSeriesChartProps) {
  const { t } = useTranslation();
  const isDiscrete = dataType === "boolean" || dataType === "enum";

  const { data, lastRealTime } = useMemo(() => {
    const mapped = points.map((p) => ({
      time: p.time,
      label: formatTime(p.time, range),
      value: p.value,
      min: p.min,
      max: p.max,
    }));

    if (mapped.length === 0 || !fetchTime) return { data: mapped, lastRealTime: null as string | null };

    const lastPoint = mapped[mapped.length - 1];
    const lastTime = new Date(lastPoint.time).getTime();

    // Extend chart line to current time with a synthetic point
    if (fetchTime - lastTime > 60_000) {
      const nowIso = new Date(fetchTime).toISOString();
      mapped.push({
        time: nowIso,
        label: formatTime(nowIso, range),
        value: lastPoint.value,
        min: undefined,
        max: undefined,
      });
    }

    return { data: mapped, lastRealTime: lastPoint.time };
  }, [points, range, fetchTime]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12px] text-text-tertiary" style={{ height }}>
        {t("history.noData")}
      </div>
    );
  }

  const hasMinMax = resolution !== "raw" && data.some((d) => d.min !== undefined);
  const staleDuration = lastRealTime && fetchTime ? formatRelativeTime(lastRealTime, fetchTime, t) : null;

  // Use CSS variables for chart colors — works in both light and dark mode
  const primaryColor = "var(--color-primary)";
  const primaryLightColor = "var(--color-primary-light)";
  const textSecondary = "var(--color-text-secondary)";
  const textTertiary = "var(--color-text-tertiary)";
  const borderColor = "var(--color-border-light)";

  return (
    <div>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: textTertiary }}
          tickLine={false}
          axisLine={{ stroke: borderColor }}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tick={{ fontSize: 10, fill: textTertiary }}
          tickLine={false}
          axisLine={false}
          width={48}
          {...(isDiscrete
            ? { domain: [0, 1], ticks: [0, 1], tickFormatter: (v: number) => (v === 1 ? "ON" : "OFF") }
            : { tickFormatter: (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) }
          )}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-surface)",
            border: `1px solid var(--color-border)`,
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
            if (name === "min" || name === "max") return [formatValue(v, unit), name];
            if (isDiscrete) return [v === 1 ? "ON" : "OFF", ""];
            return [formatValue(v, unit), ""];
          }}
        />

        {/* Min/Max area fill for aggregated data */}
        {hasMinMax && (
          <Area
            type="monotone"
            dataKey="max"
            stroke="none"
            fill={primaryLightColor}
            fillOpacity={0.5}
            isAnimationActive={false}
          />
        )}

        {/* Main value line */}
        <Line
          type={isDiscrete ? "stepAfter" : "monotone"}
          dataKey="value"
          stroke={primaryColor}
          strokeWidth={1.5}
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
      </LineChart>
    </ResponsiveContainer>
    {staleDuration && (
      <div className="text-[10px] text-accent text-right mt-1">
        {t("history.lastMeasurement", { duration: staleDuration })}
      </div>
    )}
    </div>
  );
}

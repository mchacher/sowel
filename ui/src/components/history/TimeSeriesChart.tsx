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
import type { TimeRange } from "./TimeRangeSelector";

interface TimeSeriesChartProps {
  points: HistoryPoint[];
  range: TimeRange;
  resolution: "raw" | "1h" | "1d";
  unit?: string;
  height?: number;
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

export function TimeSeriesChart({ points, range, resolution, unit, height = 200 }: TimeSeriesChartProps) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      points.map((p) => ({
        time: p.time,
        label: formatTime(p.time, range),
        value: p.value,
        min: p.min,
        max: p.max,
      })),
    [points, range],
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12px] text-text-tertiary" style={{ height }}>
        {t("history.noData")}
      </div>
    );
  }

  const hasMinMax = resolution !== "raw" && data.some((d) => d.min !== undefined);

  // Use CSS variables for chart colors — works in both light and dark mode
  const primaryColor = "var(--color-primary)";
  const primaryLightColor = "var(--color-primary-light)";
  const textSecondary = "var(--color-text-secondary)";
  const textTertiary = "var(--color-text-tertiary)";
  const borderColor = "var(--color-border-light)";

  return (
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
          tickFormatter={(v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))}
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
          formatter={(value: number, name: string) => {
            if (name === "min" || name === "max") return [formatValue(value, unit), name];
            return [formatValue(value, unit), ""];
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
          type="monotone"
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
  );
}

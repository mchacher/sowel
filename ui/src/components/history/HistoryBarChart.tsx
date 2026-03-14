import { useMemo } from "react";
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

interface HistoryBarChartProps {
  points: HistoryPoint[];
  range: TimeRange;
  resolution: "raw" | "1h" | "1d";
  unit?: string;
  height?: number;
}

const BAR_COLOR = "#4F7BE8";

interface ChartDatum {
  label: string;
  time: string;
  value: number;
}

function formatLabel(iso: string, range: TimeRange): string {
  const d = new Date(iso);
  if (range === "6h" || range === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "7d") {
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
  }
  return d.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
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

function formatKWh(wh: number): string {
  const kwh = wh / 1000;
  if (kwh >= 100) return `${Math.round(kwh)} kWh`;
  if (kwh >= 10) return `${kwh.toFixed(1)} kWh`;
  if (kwh >= 1) return `${kwh.toFixed(2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

function formatYAxis(wh: number): string {
  const kwh = wh / 1000;
  if (kwh >= 100) return `${Math.round(kwh)}`;
  if (kwh >= 10) return `${kwh.toFixed(0)}`;
  if (kwh >= 1) return `${kwh.toFixed(1)}`;
  return `${kwh.toFixed(2)}`;
}

export function HistoryBarChart({ points, range, height = 200 }: HistoryBarChartProps) {
  const data = useMemo<ChartDatum[]>(() => {
    return points.map((p) => ({
      label: formatLabel(p.time, range),
      time: p.time,
      value: p.value,
    }));
  }, [points, range]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-[12px] text-text-tertiary" style={{ height }}>
        Aucune donnée
      </div>
    );
  }

  // Determine tick interval to avoid label overlap
  const tickInterval = data.length > 15 ? Math.max(1, Math.floor(data.length / 12)) - 1 : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
          interval={tickInterval}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--color-text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatYAxis}
          width={50}
        />
        <Tooltip
          cursor={false}
          contentStyle={{
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          formatter={(value: number) => [formatKWh(value), "Consommation"]}
          labelFormatter={(_, payload) => {
            if (payload?.[0]?.payload?.time) {
              return formatTooltipTime(payload[0].payload.time as string);
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

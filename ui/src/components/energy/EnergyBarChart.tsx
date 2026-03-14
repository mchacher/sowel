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
import type { EnergyPoint } from "../../types";

interface EnergyBarChartProps {
  points: EnergyPoint[];
  period: string;
  /** Current date string "YYYY-MM-DD" — used to compute week start */
  date?: string;
  height?: number;
}

interface ChartDatum {
  label: string;
  /** Tooltip label — e.g. "14h00 – 15h00" for day view */
  tooltipLabel?: string;
  consumption: number; // always in kWh for display
}

const CONSUMPTION_COLOR = "#4F7BE8";

// ============================================================
// Aggregation: collapse raw points into period-appropriate bars
// ============================================================

/** Day view: always 24 bars (00:00–23:00), empty bars for hours without data */
function aggregateDay(points: EnergyPoint[]): ChartDatum[] {
  const byHour = new Map<number, number>();

  for (const p of points) {
    const d = new Date(p.time);
    const hour = d.getHours();
    byHour.set(hour, (byHour.get(hour) ?? 0) + p.consumption);
  }

  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    tooltipLabel: `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
    consumption: (byHour.get(hour) ?? 0) / 1000,
  }));
}

/** Week view: always 7 bars (Mon–Sun), empty bars for days without data */
function aggregateWeek(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  // Sum hourly points by local date
  const byDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    byDay.set(key, (byDay.get(key) ?? 0) + p.consumption);
  }

  // Compute Monday of the week containing the given date
  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const dayOfWeek = ref.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(ref);
  monday.setDate(monday.getDate() + mondayOffset);

  // Generate 7 days
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const key = localDateKey(day);
    const label = capitalizeFirst(
      day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
    );
    const tooltipLabel = capitalizeFirst(
      day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    );
    return {
      label,
      tooltipLabel,
      consumption: (byDay.get(key) ?? 0) / 1000,
    };
  });
}

/** Month view: always N bars (1 per day of the month), empty bars for days without data */
function aggregateMonth(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const byDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    byDay.set(key, (byDay.get(key) ?? 0) + p.consumption);
  }

  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = new Date(year, month, i + 1);
    const key = localDateKey(day);
    const tooltipLabel = capitalizeFirst(
      day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    );
    return {
      label: String(i + 1),
      tooltipLabel,
      consumption: (byDay.get(key) ?? 0) / 1000,
    };
  });
}

/** Year view: always 12 bars (Jan–Dec), empty bars for months without data */
function aggregateYear(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();

  const monthTotals = new Array<number>(12).fill(0);
  for (const p of points) {
    const d = new Date(p.time);
    monthTotals[d.getMonth()] += p.consumption;
  }

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const tooltipLabel = capitalizeFirst(
      d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    );
    return {
      label: capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      tooltipLabel,
      consumption: monthTotals[i] / 1000,
    };
  });
}

/** Local date key to avoid UTC midnight split (e.g., 23:00 UTC = next day in CET). */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildChartData(points: EnergyPoint[], period: string, date?: string): ChartDatum[] {
  switch (period) {
    case "day":
      return aggregateDay(points);
    case "week":
      return aggregateWeek(points, date);
    case "month":
      return aggregateMonth(points, date);
    case "year":
      return aggregateYear(points, date);
    default:
      return aggregateDay(points);
  }
}

// ============================================================
// Formatters
// ============================================================

function formatKWh(kwh: number): string {
  if (kwh >= 1) return `${kwh.toFixed(2)} kWh`;
  if (kwh > 0) return `${Math.round(kwh * 1000)} Wh`;
  return "0 Wh";
}

function formatYAxis(kwh: number): string {
  if (kwh >= 100) return `${Math.round(kwh)} kWh`;
  if (kwh >= 1) return `${kwh.toFixed(1)} kWh`;
  if (kwh === 0) return "0";
  return `${kwh.toFixed(2)} kWh`;
}

// ============================================================
// Component
// ============================================================

export function EnergyBarChart({ points, period, date, height = 300 }: EnergyBarChartProps) {
  const data = useMemo(() => buildChartData(points, period, date), [points, period, date]);

  // Fixed gridline intervals per period
  const yTicks = useMemo(() => {
    const stepByPeriod: Record<string, number> = {
      day: 1,
      week: 10,
      month: 25,
      year: 500,
    };
    const step = stepByPeriod[period] ?? 1;
    const max = Math.ceil(Math.max(...data.map((d) => d.consumption), step) / step) * step;
    return Array.from({ length: max / step + 1 }, (_, i) => i * step);
  }, [data, period]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-text-tertiary text-[13px]" style={{ height }}>
        Aucune donnée pour cette période
      </div>
    );
  }

  // Determine tick interval to avoid label overlap on day view
  const tickInterval = period === "day" ? Math.max(1, Math.floor(data.length / 12)) - 1 : 0;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
          interval={tickInterval}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatYAxis}
          width={70}
          domain={[0, yTicks[yTicks.length - 1] ?? "dataMax"]}
          ticks={yTicks}
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
          labelFormatter={(_label: string, payload: Array<{ payload?: ChartDatum }>) =>
            payload[0]?.payload?.tooltipLabel ?? _label
          }
        />
        <Bar
          dataKey="consumption"
          fill={CONSUMPTION_COLOR}
          activeBar={{ fill: "#6B93F0" }}
          radius={[4, 4, 0, 0]}
          maxBarSize={period === "day" ? 20 : 40}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

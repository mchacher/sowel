import { useMemo } from "react";
import { useTranslation } from "react-i18next";
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

interface ProductionBarChartProps {
  points: EnergyPoint[];
  period: string;
  date?: string;
  height?: number;
}

interface ChartDatum {
  label: string;
  tooltipLabel?: string;
  autoconso: number; // kWh
  injection: number; // kWh
}

const AUTOCONSO_COLOR = "#6BCB77"; // light green
const INJECTION_COLOR = "#2D8F3E"; // dark green

/** Local date key to avoid UTC midnight split. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function aggregateDay(points: EnergyPoint[]): ChartDatum[] {
  const autoByHour = new Map<number, number>();
  const injByHour = new Map<number, number>();

  for (const p of points) {
    const d = new Date(p.time);
    const hour = d.getHours();
    autoByHour.set(hour, (autoByHour.get(hour) ?? 0) + p.autoconso);
    injByHour.set(hour, (injByHour.get(hour) ?? 0) + p.injection);
  }

  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    tooltipLabel: `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
    autoconso: (autoByHour.get(hour) ?? 0) / 1000,
    injection: (injByHour.get(hour) ?? 0) / 1000,
  }));
}

function aggregateWeek(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const autoByDay = new Map<string, number>();
  const injByDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    autoByDay.set(key, (autoByDay.get(key) ?? 0) + p.autoconso);
    injByDay.set(key, (injByDay.get(key) ?? 0) + p.injection);
  }

  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const dayOfWeek = ref.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(ref);
  monday.setDate(monday.getDate() + mondayOffset);

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
      autoconso: (autoByDay.get(key) ?? 0) / 1000,
      injection: (injByDay.get(key) ?? 0) / 1000,
    };
  });
}

function aggregateMonth(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const autoByDay = new Map<string, number>();
  const injByDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    autoByDay.set(key, (autoByDay.get(key) ?? 0) + p.autoconso);
    injByDay.set(key, (injByDay.get(key) ?? 0) + p.injection);
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
      autoconso: (autoByDay.get(key) ?? 0) / 1000,
      injection: (injByDay.get(key) ?? 0) / 1000,
    };
  });
}

function aggregateYear(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();

  const autoTotals = new Array<number>(12).fill(0);
  const injTotals = new Array<number>(12).fill(0);
  for (const p of points) {
    const d = new Date(p.time);
    autoTotals[d.getMonth()] += p.autoconso;
    injTotals[d.getMonth()] += p.injection;
  }

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const tooltipLabel = capitalizeFirst(
      d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    );
    return {
      label: capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      tooltipLabel,
      autoconso: autoTotals[i] / 1000,
      injection: injTotals[i] / 1000,
    };
  });
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

export function ProductionBarChart({ points, period, date, height = 300 }: ProductionBarChartProps) {
  const { t } = useTranslation();
  const data = useMemo(() => buildChartData(points, period, date), [points, period, date]);

  const yTicks = useMemo(() => {
    const stepByPeriod: Record<string, number> = {
      day: 0.5,
      week: 5,
      month: 10,
      year: 200,
    };
    const step = stepByPeriod[period] ?? 0.5;
    const max = Math.ceil(Math.max(...data.map((d) => d.autoconso + d.injection), step) / step) * step;
    return Array.from({ length: max / step + 1 }, (_, i) => i * step);
  }, [data, period]);

  const hasData = data.some((d) => d.autoconso > 0 || d.injection > 0);
  if (!hasData) {
    return (
      <div className="flex items-center justify-center text-text-tertiary text-[13px]" style={{ height }}>
        {t("common.noData")}
      </div>
    );
  }

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
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const datum = payload[0]?.payload as ChartDatum | undefined;
            if (!datum) return null;
            const total = (datum.autoconso ?? 0) + (datum.injection ?? 0);
            return (
              <div
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  padding: "8px 12px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{datum.tooltipLabel}</div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("energy.production")} : {formatKWh(total)}</div>
                <div style={{ color: AUTOCONSO_COLOR }}>{t("energy.autoconsumption")} : {formatKWh(datum.autoconso)}</div>
                {datum.injection > 0 && (
                  <div style={{ color: INJECTION_COLOR }}>{t("energy.gridInjection")} : {formatKWh(datum.injection)}</div>
                )}
              </div>
            );
          }}
        />
        <Bar
          dataKey="autoconso"
          stackId="production"
          fill={AUTOCONSO_COLOR}
          maxBarSize={period === "day" ? 20 : 40}
          name="autoconso"
          shape={(props: unknown) => {
            const p = props as Record<string, unknown>;
            const x = p.x as number, y = p.y as number, width = p.width as number, height = p.height as number;
            const f = p.fill as string, injVal = p.injection as number;
            if (!height || height <= 0) return null;
            const r = injVal > 0 ? 0 : 4;
            return (
              <path
                d={`M${x},${y + height}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ""}H${x + width - r}${r ? `Q${x + width},${y} ${x + width},${y + r}` : ""}V${y + height}Z`}
                fill={f}
              />
            );
          }}
        />
        <Bar
          dataKey="injection"
          stackId="production"
          fill={INJECTION_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={period === "day" ? 20 : 40}
          name="injection"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

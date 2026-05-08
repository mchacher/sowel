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
import type { EnergyByUsageResponse } from "../../types";

interface Props {
  data: EnergyByUsageResponse;
  period: string;
  date?: string;
  height?: number;
}

const OTHER_COLOR = "#94A3B8";
const OTHER_KEY = "__other__";

interface Series {
  id: string;
  name: string;
  color: string;
}

interface Datum {
  label: string;
  tooltipLabel: string;
  /** kWh per series id */
  [key: string]: string | number;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function makeBuckets(period: string, dateStr?: string): { keyOf: (time: string) => string | null; buckets: { key: string; label: string; tooltipLabel: string }[] } {
  if (period === "day") {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${String(hour).padStart(2, "0")}h`,
      tooltipLabel: `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
    }));
    return {
      keyOf: (time) => String(new Date(time).getHours()),
      buckets,
    };
  }

  if (period === "week") {
    const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
    const dayOfWeek = ref.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(ref);
    monday.setDate(monday.getDate() + mondayOffset);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(day.getDate() + i);
      return {
        key: localDateKey(day),
        label: capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })),
        tooltipLabel: capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      };
    });
    return { keyOf: (time) => localDateKey(new Date(time)), buckets };
  }

  if (period === "month") {
    const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const buckets = Array.from({ length: daysInMonth }, (_, i) => {
      const day = new Date(year, month, i + 1);
      return {
        key: localDateKey(day),
        label: String(i + 1),
        tooltipLabel: capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      };
    });
    return { keyOf: (time) => localDateKey(new Date(time)), buckets };
  }

  // year
  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    return {
      key: String(i),
      label: capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      tooltipLabel: capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })),
    };
  });
  return { keyOf: (time) => String(new Date(time).getMonth()), buckets };
}

function buildChart(data: EnergyByUsageResponse, period: string, dateStr?: string): {
  data: Datum[];
  series: Series[];
} {
  const { keyOf, buckets } = makeBuckets(period, dateStr);

  const otherKey = OTHER_KEY;
  const series: Series[] = [
    ...data.submeters.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    { id: otherKey, name: "Other", color: OTHER_COLOR },
  ];

  // Initialize all bars to zero for every series so missing data renders as gaps.
  const datums: Datum[] = buckets.map((b) => {
    const d: Datum = { label: b.label, tooltipLabel: b.tooltipLabel };
    for (const s of series) d[s.id] = 0;
    return d;
  });
  const indexByKey = new Map(buckets.map((b, i) => [b.key, i]));

  for (const sm of data.submeters) {
    for (const p of sm.points) {
      const k = keyOf(p.time);
      if (k === null) continue;
      const idx = indexByKey.get(k);
      if (idx === undefined) continue;
      datums[idx][sm.id] = (datums[idx][sm.id] as number) + p.wh / 1000;
    }
  }
  for (const p of data.other.points) {
    const k = keyOf(p.time);
    if (k === null) continue;
    const idx = indexByKey.get(k);
    if (idx === undefined) continue;
    datums[idx][otherKey] = (datums[idx][otherKey] as number) + p.wh / 1000;
  }

  return { data: datums, series };
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

export function EnergyByUsageChart({ data, period, date, height = 300 }: Props) {
  const { t } = useTranslation();
  const { data: rows, series } = useMemo(() => buildChart(data, period, date), [data, period, date]);

  // Re-label "Other" using i18n (we only know the t() at render time)
  const seriesWithI18n = useMemo(() => {
    return series.map((s) => (s.id === OTHER_KEY ? { ...s, name: t("energy.byUsage.other") } : s));
  }, [series, t]);

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
          <YAxis tickFormatter={formatYAxis} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              const datum = payload[0].payload as Datum;
              const total = seriesWithI18n.reduce((acc, s) => acc + (datum[s.id] as number), 0);
              return (
                <div className="bg-surface border border-border rounded-[6px] p-3 text-[12px] shadow-lg">
                  <div className="font-semibold text-text mb-1">{datum.tooltipLabel ?? label}</div>
                  {seriesWithI18n.map((s) => {
                    const v = datum[s.id] as number;
                    if (v <= 0) return null;
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-text-secondary">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                        <span>{s.name}</span>
                        <span className="ml-auto tabular-nums">{formatKWh(v)}</span>
                      </div>
                    );
                  })}
                  {total > 0 && (
                    <div className="mt-1 pt-1 border-t border-border flex items-center text-text">
                      <span className="font-semibold">Total</span>
                      <span className="ml-auto tabular-nums font-semibold">{formatKWh(total)}</span>
                    </div>
                  )}
                </div>
              );
            }}
          />
          {seriesWithI18n.map((s) => (
            <Bar key={s.id} dataKey={s.id} stackId="usage" fill={s.color} name={s.name} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

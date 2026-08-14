import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { localDateStr } from "../../lib/local-date";
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
  prod: number; // kWh — raw production, used when the split is unavailable
}

// Spec 148 — energy palette tokens (dark-mode correct), shared across energy UI.
const AUTOCONSO_COLOR = "var(--color-solar-auto)"; // light green
const INJECTION_COLOR = "var(--color-solar-injection)"; // dark green
/** Single-series green, used when only the raw production is known. */
const PRODUCTION_COLOR = "var(--color-solar-production)";

/** Local date key to avoid UTC midnight split. */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Wh totals for one chart bucket. */
interface Totals {
  autoconso: number;
  injection: number;
  prod: number;
}

const EMPTY: Totals = { autoconso: 0, injection: 0, prod: 0 };

/** Sum the three production series per bucket, keyed by `keyOf(point date)`. */
function bucketize<K>(points: EnergyPoint[], keyOf: (d: Date) => K): Map<K, Totals> {
  const buckets = new Map<K, Totals>();
  for (const p of points) {
    const key = keyOf(new Date(p.time));
    const acc = buckets.get(key) ?? { ...EMPTY };
    acc.autoconso += p.autoconso;
    acc.injection += p.injection;
    acc.prod += p.prod;
    buckets.set(key, acc);
  }
  return buckets;
}

/** Wh → kWh on the three series at once. */
function toKWh(t: Totals): Totals {
  return { autoconso: t.autoconso / 1000, injection: t.injection / 1000, prod: t.prod / 1000 };
}

function aggregateDay(points: EnergyPoint[]): ChartDatum[] {
  const byHour = bucketize(points, (d) => d.getHours());

  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    tooltipLabel: `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
    ...toKWh(byHour.get(hour) ?? EMPTY),
  }));
}

function aggregateWeek(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const byDay = bucketize(points, localDateKey);

  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
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
      ...toKWh(byDay.get(key) ?? EMPTY),
    };
  });
}

function aggregateMonth(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const byDay = bucketize(points, localDateKey);

  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
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
      ...toKWh(byDay.get(key) ?? EMPTY),
    };
  });
}

function aggregateYear(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const year = ref.getFullYear();
  const byMonth = bucketize(points, (d) => d.getMonth());

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const tooltipLabel = capitalizeFirst(
      d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    );
    return {
      label: capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      tooltipLabel,
      ...toKWh(byMonth.get(i) ?? EMPTY),
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

  // The autoconso / injection split needs BOTH a production and a grid meter.
  // With only a production meter — or while the grid side is silent — the raw
  // `prod` series is all we have; plot it as a single bar rather than
  // pretending there is no production at all.
  const hasSplit = data.some((d) => d.autoconso > 0 || d.injection > 0);
  const barTotal = (d: ChartDatum): number => (hasSplit ? d.autoconso + d.injection : d.prod);

  const yTicks = useMemo(() => {
    const stepByPeriod: Record<string, number> = {
      day: 0.5,
      week: 5,
      month: 10,
      year: 200,
    };
    const step = stepByPeriod[period] ?? 0.5;
    const max = Math.ceil(Math.max(...data.map(barTotal), step) / step) * step;
    return Array.from({ length: max / step + 1 }, (_, i) => i * step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, period, hasSplit]);

  const hasData = data.some((d) => barTotal(d) > 0);
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
            const total = barTotal(datum);
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
                <div style={{ fontWeight: 600, marginBottom: hasSplit ? 4 : 0 }}>{t("energy.production")} : {formatKWh(total)}</div>
                {hasSplit && (
                  <>
                    <div style={{ color: AUTOCONSO_COLOR }}>{t("energy.autoconsumption")} : {formatKWh(datum.autoconso)}</div>
                    {datum.injection > 0 && (
                      <div style={{ color: INJECTION_COLOR }}>{t("energy.gridInjection")} : {formatKWh(datum.injection)}</div>
                    )}
                  </>
                )}
              </div>
            );
          }}
        />
        {!hasSplit && (
          <Bar
            dataKey="prod"
            fill={PRODUCTION_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={period === "day" ? 20 : 40}
            name="prod"
          />
        )}
        <Bar
          dataKey="autoconso"
          stackId="production"
          fill={AUTOCONSO_COLOR}
          maxBarSize={period === "day" ? 20 : 40}
          name="autoconso"
          hide={!hasSplit}
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
          hide={!hasSplit}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

import { CHART_TICK_FONT, CHART_TOOLTIP_FONT } from "../../lib/chart-font";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../../lib/locale";
import { formatHourLabel, formatHourRange } from "../../lib/hour-label";
import { localDateStr } from "../../lib/local-date";
import { xTickInterval, ENERGY_CHART_Y_AXIS_PX } from "../../lib/chart-ticks";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { EnergyPoint } from "../../types";
import { formatKwhTick, formatKwhTooltip } from "./format";
import { TooltipSeriesRow } from "./TooltipSeriesRow";
import { productionYTicks } from "./period-headline";

interface ProductionBarChartProps {
  points: EnergyPoint[];
  period: string;
  date?: string;
  height?: number;
  /**
   * Spec 197 (FR-E6.2) — today's largest expected hour, kWh. On the day view
   * the Y axis reaches at least this high, so the morning's first bars sit in
   * the frame of the day the forecast announces.
   */
  floorKwh?: number;
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

function aggregateDay(points: EnergyPoint[], locale: string): ChartDatum[] {
  const byHour = bucketize(points, (d) => d.getHours());

  return Array.from({ length: 24 }, (_, hour) => ({
    label: formatHourLabel(hour, locale),
    tooltipLabel: formatHourRange(hour, locale),
    ...toKWh(byHour.get(hour) ?? EMPTY),
  }));
}

function aggregateWeek(points: EnergyPoint[], locale: string, dateStr?: string): ChartDatum[] {
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
      day.toLocaleDateString(locale, { weekday: "short", day: "numeric" }),
    );
    const tooltipLabel = capitalizeFirst(
      day.toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
    return {
      label,
      tooltipLabel,
      ...toKWh(byDay.get(key) ?? EMPTY),
    };
  });
}

function aggregateMonth(points: EnergyPoint[], locale: string, dateStr?: string): ChartDatum[] {
  const byDay = bucketize(points, localDateKey);

  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = new Date(year, month, i + 1);
    const key = localDateKey(day);
    const tooltipLabel = capitalizeFirst(
      day.toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    );
    return {
      label: String(i + 1),
      tooltipLabel,
      ...toKWh(byDay.get(key) ?? EMPTY),
    };
  });
}

function aggregateYear(points: EnergyPoint[], locale: string, dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const year = ref.getFullYear();
  const byMonth = bucketize(points, (d) => d.getMonth());

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const tooltipLabel = capitalizeFirst(
      d.toLocaleDateString(locale, { month: "long", year: "numeric" }),
    );
    return {
      label: capitalizeFirst(d.toLocaleDateString(locale, { month: "short" })),
      tooltipLabel,
      ...toKWh(byMonth.get(i) ?? EMPTY),
    };
  });
}

function buildChartData(
  points: EnergyPoint[],
  period: string,
  locale: string,
  date?: string,
): ChartDatum[] {
  switch (period) {
    case "day":
      return aggregateDay(points, locale);
    case "week":
      return aggregateWeek(points, locale, date);
    case "month":
      return aggregateMonth(points, locale, date);
    case "year":
      return aggregateYear(points, locale, date);
    default:
      return aggregateDay(points, locale);
  }
}

export function ProductionBarChart({
  points,
  period,
  date,
  height = 300,
  floorKwh,
}: ProductionBarChartProps) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const data = useMemo(
    () => buildChartData(points, period, locale, date),
    [points, period, locale, date],
  );

  // The autoconso / injection split needs BOTH a production and a grid meter.
  // With only a production meter — or while the grid side is silent — the raw
  // `prod` series is all we have; plot it as a single bar rather than
  // pretending there is no production at all.
  const hasSplit = data.some((d) => d.autoconso > 0 || d.injection > 0);
  const barTotal = (d: ChartDatum): number => (hasSplit ? d.autoconso + d.injection : d.prod);

  const yTicks = useMemo(
    () => productionYTicks(Math.max(0, ...data.map(barTotal)), period, floorKwh),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, period, hasSplit, floorKwh],
  );

  // Measured chart width, for the X tick density (spec 196). 0 until measured.
  const [chartWidth, setChartWidth] = useState(0);

  const hasData = data.some((d) => barTotal(d) > 0);
  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center text-text-tertiary text-small"
        style={{ height }}
      >
        {t("common.noData")}
      </div>
    );
  }

  const tickInterval = xTickInterval(period, data.length, chartWidth - ENERGY_CHART_Y_AXIS_PX);

  return (
    <ResponsiveContainer width="100%" height={height} onResize={(w) => setChartWidth(w)}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: CHART_TICK_FONT, fill: "var(--color-text-tertiary)" }}
          interval={tickInterval}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          tick={{ fontSize: CHART_TICK_FONT, fill: "var(--color-text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(kwh: number) => formatKwhTick(kwh, locale)}
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
                  fontSize: CHART_TOOLTIP_FONT,
                  padding: "8px 12px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{datum.tooltipLabel}</div>
                <div style={{ fontWeight: 600, marginBottom: hasSplit ? 4 : 0 }}>
                  {t("energy.production")}
                  {t("common.colon")}
                  {formatKwhTooltip(total, locale)}
                </div>
                {hasSplit && (
                  <>
                    <TooltipSeriesRow
                      color={AUTOCONSO_COLOR}
                      label={t("energy.autoconsumption")}
                      value={formatKwhTooltip(datum.autoconso, locale)}
                    />
                    {datum.injection > 0 && (
                      <TooltipSeriesRow
                        color={INJECTION_COLOR}
                        label={t("energy.gridInjection")}
                        value={formatKwhTooltip(datum.injection, locale)}
                      />
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
            const x = p.x as number,
              y = p.y as number,
              width = p.width as number,
              height = p.height as number;
            const f = p.fill as string,
              injVal = p.injection as number;
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

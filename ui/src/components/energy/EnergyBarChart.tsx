import { useMemo, useRef } from "react";
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

interface EnergyBarChartProps {
  points: EnergyPoint[];
  period: string;
  /** Current date string "YYYY-MM-DD" — used to compute week start */
  date?: string;
  height?: number;
}

interface ChartDatum {
  label: string;
  tooltipLabel?: string;
  hp: number; // kWh
  hc: number; // kWh
  autoconso: number; // kWh — already included in hp+hc
}

const HP_COLOR = "#4F7BE8";
const HC_COLOR = "#93B5F0";
const AUTOCONSO_COLOR = "#6BCB77";

// ============================================================
// Aggregation: collapse raw points into period-appropriate bars
// ============================================================

function toDatum(label: string, tooltipLabel: string, hpWh: number, hcWh: number, autoWh: number): ChartDatum {
  const hp = hpWh / 1000;
  const hc = hcWh / 1000;
  const autoconso = Math.min(autoWh / 1000, hp + hc);
  return { label, tooltipLabel, hp, hc, autoconso };
}

/** Day view: always 24 bars (00:00–23:00) */
function aggregateDay(points: EnergyPoint[]): ChartDatum[] {
  const hpByHour = new Map<number, number>();
  const hcByHour = new Map<number, number>();
  const autoByHour = new Map<number, number>();

  for (const p of points) {
    const d = new Date(p.time);
    const hour = d.getHours();
    hpByHour.set(hour, (hpByHour.get(hour) ?? 0) + p.hp);
    hcByHour.set(hour, (hcByHour.get(hour) ?? 0) + p.hc);
    autoByHour.set(hour, (autoByHour.get(hour) ?? 0) + p.autoconso);
  }

  return Array.from({ length: 24 }, (_, hour) =>
    toDatum(
      `${String(hour).padStart(2, "0")}h`,
      `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
      hpByHour.get(hour) ?? 0,
      hcByHour.get(hour) ?? 0,
      autoByHour.get(hour) ?? 0,
    ),
  );
}

/** Week view: always 7 bars (Mon–Sun) */
function aggregateWeek(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const hpByDay = new Map<string, number>();
  const hcByDay = new Map<string, number>();
  const autoByDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    hpByDay.set(key, (hpByDay.get(key) ?? 0) + p.hp);
    hcByDay.set(key, (hcByDay.get(key) ?? 0) + p.hc);
    autoByDay.set(key, (autoByDay.get(key) ?? 0) + p.autoconso);
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
    return toDatum(
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })),
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      hpByDay.get(key) ?? 0,
      hcByDay.get(key) ?? 0,
      autoByDay.get(key) ?? 0,
    );
  });
}

/** Month view: always N bars (1 per day of the month) */
function aggregateMonth(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const hpByDay = new Map<string, number>();
  const hcByDay = new Map<string, number>();
  const autoByDay = new Map<string, number>();
  for (const p of points) {
    const d = new Date(p.time);
    const key = localDateKey(d);
    hpByDay.set(key, (hpByDay.get(key) ?? 0) + p.hp);
    hcByDay.set(key, (hcByDay.get(key) ?? 0) + p.hc);
    autoByDay.set(key, (autoByDay.get(key) ?? 0) + p.autoconso);
  }

  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = new Date(year, month, i + 1);
    const key = localDateKey(day);
    return toDatum(
      String(i + 1),
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      hpByDay.get(key) ?? 0,
      hcByDay.get(key) ?? 0,
      autoByDay.get(key) ?? 0,
    );
  });
}

/** Year view: always 12 bars (Jan–Dec) */
function aggregateYear(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? new Date().toISOString().slice(0, 10)) + "T12:00:00");
  const year = ref.getFullYear();

  const hpTotals = new Array<number>(12).fill(0);
  const hcTotals = new Array<number>(12).fill(0);
  const autoTotals = new Array<number>(12).fill(0);
  for (const p of points) {
    const d = new Date(p.time);
    hpTotals[d.getMonth()] += p.hp;
    hcTotals[d.getMonth()] += p.hc;
    autoTotals[d.getMonth()] += p.autoconso;
  }

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    return toDatum(
      capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })),
      hpTotals[i],
      hcTotals[i],
      autoTotals[i],
    );
  });
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildChartData(points: EnergyPoint[], period: string, date?: string): ChartDatum[] {
  switch (period) {
    case "day": return aggregateDay(points);
    case "week": return aggregateWeek(points, date);
    case "month": return aggregateMonth(points, date);
    case "year": return aggregateYear(points, date);
    default: return aggregateDay(points);
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
// SVG path helper: rectangle with only top corners rounded
// ============================================================

function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y} L${x + w - radius},${y} Q${x + w},${y} ${x + w},${y + radius} L${x + w},${y + h}Z`;
}

// ============================================================
// Component
// ============================================================

export function EnergyBarChart({ points, period, date, height = 300 }: EnergyBarChartProps) {
  const { t } = useTranslation();
  const data = useMemo(() => buildChartData(points, period, date), [points, period, date]);

  const hasAutoconso = useMemo(() => data.some((d) => d.autoconso > 0), [data]);

  // Fixed gridline intervals per period
  const yTicks = useMemo(() => {
    const stepByPeriod: Record<string, number> = {
      day: 1,
      week: 10,
      month: 25,
      year: 500,
    };
    const step = stepByPeriod[period] ?? 1;
    const max = Math.ceil(Math.max(...data.map((d) => d.hp + d.hc), step) / step) * step;
    return Array.from({ length: max / step + 1 }, (_, i) => i * step);
  }, [data, period]);

  // Store HC bar baseline positions (bottom y of each HC bar = bottom of full stack)
  // Populated during HC shape render, consumed during HP shape render for autoconso overlay
  const hcBaselinesRef = useRef<Array<{ x: number; width: number; baseline: number }>>([]);
  const hcBaselines = hcBaselinesRef.current;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-text-tertiary text-[13px]" style={{ height }}>
        Aucune donnée pour cette période
      </div>
    );
  }

  const tickInterval = period === "day" ? Math.max(1, Math.floor(data.length / 12)) - 1 : 0;
  const maxBarSize = period === "day" ? 20 : 40;

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
            const total = datum.hp + datum.hc;
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
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t("energy.consumption")} : {formatKWh(total)}</div>
                <div style={{ color: HP_COLOR }}>{t("energy.peakHours")} : {formatKWh(datum.hp)}</div>
                <div style={{ color: HC_COLOR }}>{t("energy.offPeakHours")} : {formatKWh(datum.hc)}</div>
                {datum.autoconso > 0 && (
                  <div style={{ color: AUTOCONSO_COLOR }}>
                    {t("energy.autoconsumption")} : {formatKWh(datum.autoconso)}
                  </div>
                )}
              </div>
            );
          }}
        />
        {/* HC (light blue) at bottom — captures baseline for autoconso overlay */}
        <Bar
          dataKey="hc"
          stackId="consumption"
          fill={HC_COLOR}
          maxBarSize={maxBarSize}
          name="hc"
          shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: ChartDatum }) => {
            const { x = 0, y = 0, width: w = 0, height: h = 0, index = 0, payload } = props;
            // Record baseline for autoconso overlay
            hcBaselines[index] = { x, width: w, baseline: y + h };
            if (!h || h <= 0) return null;
            const rounded = !payload || payload.hp <= 0;
            if (!rounded) return <rect x={x} y={y} width={w} height={h} fill={HC_COLOR} />;
            return <path d={roundedTopRect(x, y, w, h, 4)} fill={HC_COLOR} />;
          }}
        />
        {/* HP (dark blue) on top — also draws autoconso green overlay */}
        <Bar
          dataKey="hp"
          stackId="consumption"
          fill={HP_COLOR}
          radius={[4, 4, 0, 0]}
          maxBarSize={maxBarSize}
          name="hp"
          shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: ChartDatum }) => {
            const { x = 0, y = 0, width: w = 0, height: h = 0, index = 0, payload } = props;
            const hpRect = h > 0
              ? <path d={roundedTopRect(x, y, w, h, 4)} fill={HP_COLOR} />
              : null;

            // Draw autoconso overlay from baseline upward
            let autoRect = null;
            if (hasAutoconso && payload && payload.autoconso > 0) {
              const total = payload.hp + payload.hc;
              const geo = hcBaselines[index];
              if (total > 0 && geo) {
                // Full stack pixel height: from top of HP (or top of HC if HP=0) to baseline
                // y = top of HP segment (or top of stack when HP=0, since recharts positions it there)
                const fullStackH = geo.baseline - y;
                if (fullStackH > 0) {
                  const ratio = payload.autoconso / total;
                  const autoH = fullStackH * ratio;
                  autoRect = (
                    <rect
                      x={geo.x}
                      y={geo.baseline - autoH}
                      width={geo.width}
                      height={autoH}
                      fill={AUTOCONSO_COLOR}
                    />
                  );
                }
              }
            }

            return (
              <g>
                {hpRect}
                {autoRect}
              </g>
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

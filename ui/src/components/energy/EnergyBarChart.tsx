import { useMemo, useRef } from "react";
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
import type { EnergyUnit } from "../../store/useUiState";
import { formatEur } from "./format";

interface EnergyBarChartProps {
  points: EnergyPoint[];
  period: string;
  /** Current date string "YYYY-MM-DD" — used to compute week start */
  date?: string;
  height?: number;
  /** Spec 123 — Wh / € unit selector. */
  unit?: EnergyUnit;
}

interface ChartDatum {
  label: string;
  tooltipLabel?: string;
  hp: number; // kWh
  hc: number; // kWh
  autoconso: number; // kWh — already included in hp+hc
  cost_hp: number; // € (spec 123)
  cost_hc: number; // € (spec 123)
}

// Spec 148 — energy palette tokens (dark-mode correct), shared across energy UI.
const HP_COLOR = "var(--color-energy-hp)";
const HC_COLOR = "var(--color-energy-hc)";
const AUTOCONSO_COLOR = "var(--color-solar-auto)";

// ============================================================
// Aggregation: collapse raw points into period-appropriate bars
// ============================================================

function toDatum(
  label: string,
  tooltipLabel: string,
  hpWh: number,
  hcWh: number,
  autoWh: number,
  costHp: number,
  costHc: number,
): ChartDatum {
  const hp = hpWh / 1000;
  const hc = hcWh / 1000;
  const autoconso = Math.min(autoWh / 1000, hp + hc);
  return { label, tooltipLabel, hp, hc, autoconso, cost_hp: costHp, cost_hc: costHc };
}

interface BucketAcc {
  hp: number;
  hc: number;
  auto: number;
  costHp: number;
  costHc: number;
}

function newAcc(): BucketAcc {
  return { hp: 0, hc: 0, auto: 0, costHp: 0, costHc: 0 };
}

function accumulate(acc: BucketAcc, p: EnergyPoint): void {
  acc.hp += p.hp;
  acc.hc += p.hc;
  acc.auto += p.autoconso;
  acc.costHp += p.cost_hp ?? 0;
  acc.costHc += p.cost_hc ?? 0;
}

/** Day view: always 24 bars (00:00–23:00) */
function aggregateDay(points: EnergyPoint[]): ChartDatum[] {
  const byHour = new Map<number, BucketAcc>();
  for (let h = 0; h < 24; h++) byHour.set(h, newAcc());
  for (const p of points) {
    const acc = byHour.get(new Date(p.time).getHours());
    if (acc) accumulate(acc, p);
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const a = byHour.get(hour)!;
    return toDatum(
      `${String(hour).padStart(2, "0")}h`,
      `${String(hour).padStart(2, "0")}h00 – ${String((hour + 1) % 24).padStart(2, "0")}h00`,
      a.hp,
      a.hc,
      a.auto,
      a.costHp,
      a.costHc,
    );
  });
}

/** Week view: always 7 bars (Mon–Sun) */
function aggregateWeek(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const byDay = new Map<string, BucketAcc>();
  for (const p of points) {
    const key = localDateKey(new Date(p.time));
    const a = byDay.get(key) ?? newAcc();
    accumulate(a, p);
    byDay.set(key, a);
  }

  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const dayOfWeek = ref.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(ref);
  monday.setDate(monday.getDate() + mondayOffset);

  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const key = localDateKey(day);
    const a = byDay.get(key) ?? newAcc();
    return toDatum(
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })),
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      a.hp,
      a.hc,
      a.auto,
      a.costHp,
      a.costHc,
    );
  });
}

/** Month view: always N bars (1 per day of the month) */
function aggregateMonth(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const byDay = new Map<string, BucketAcc>();
  for (const p of points) {
    const key = localDateKey(new Date(p.time));
    const a = byDay.get(key) ?? newAcc();
    accumulate(a, p);
    byDay.set(key, a);
  }

  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = new Date(year, month, i + 1);
    const key = localDateKey(day);
    const a = byDay.get(key) ?? newAcc();
    return toDatum(
      String(i + 1),
      capitalizeFirst(day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })),
      a.hp,
      a.hc,
      a.auto,
      a.costHp,
      a.costHc,
    );
  });
}

/** Year view: always 12 bars (Jan–Dec) */
function aggregateYear(points: EnergyPoint[], dateStr?: string): ChartDatum[] {
  const ref = new Date((dateStr ?? localDateStr()) + "T12:00:00");
  const year = ref.getFullYear();

  const accs = Array.from({ length: 12 }, () => newAcc());
  for (const p of points) {
    accumulate(accs[new Date(p.time).getMonth()], p);
  }

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(year, i, 1);
    const a = accs[i];
    return toDatum(
      capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "short" })),
      capitalizeFirst(d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })),
      a.hp,
      a.hc,
      a.auto,
      a.costHp,
      a.costHc,
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

export function EnergyBarChart({ points, period, date, height = 300, unit = "wh" }: EnergyBarChartProps) {
  const { t } = useTranslation();
  const data = useMemo(() => buildChartData(points, period, date), [points, period, date]);

  // Spec 123 — when unit==="eur", bars show cost_hp / cost_hc instead
  // of hp / hc kWh. Autoconso has no billed cost so its overlay is
  // hidden in € mode to keep the bar height = "what you pay".
  const isEur = unit === "eur";
  const hasAutoconso = useMemo(
    () => !isEur && data.some((d) => d.autoconso > 0),
    [data, isEur],
  );

  // Fixed gridline intervals per period — only meaningful in kWh mode.
  // In € mode let recharts auto-pick (cost distributions vary too much
  // across tariffs for hard-coded ticks to look right).
  const yTicks = useMemo(() => {
    if (isEur) return undefined;
    const stepByPeriod: Record<string, number> = {
      day: 1,
      week: 10,
      month: 25,
      year: 500,
    };
    const step = stepByPeriod[period] ?? 1;
    const max = Math.ceil(Math.max(...data.map((d) => d.hp + d.hc), step) / step) * step;
    return Array.from({ length: max / step + 1 }, (_, i) => i * step);
  }, [data, period, isEur]);

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
          tickFormatter={isEur ? formatEur : formatYAxis}
          width={70}
          domain={isEur ? [0, "auto"] : [0, yTicks?.[yTicks.length - 1] ?? "dataMax"]}
          ticks={isEur ? undefined : yTicks}
        />
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const datum = payload[0]?.payload as ChartDatum | undefined;
            if (!datum) return null;
            // Per-slot hp/hc from Influx already include autoconso (= household).
            // Match the API totals semantic (energy.ts/computeTotals): show
            // grid-only HP and HC by subtracting autoconso pro rata, so that
            // HP + HC + autoconso = household = bar height.
            const consoTotal = datum.hp + datum.hc;
            const hpGrid =
              consoTotal > 0
                ? Math.max(0, datum.hp - datum.autoconso * (datum.hp / consoTotal))
                : datum.hp;
            const hcGrid =
              consoTotal > 0
                ? Math.max(0, datum.hc - datum.autoconso * (datum.hc / consoTotal))
                : datum.hc;
            const costTotal = datum.cost_hp + datum.cost_hc;
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
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {t("energy.consumption")} :{" "}
                  {isEur ? formatEur(costTotal) : formatKWh(consoTotal)}
                </div>
                <div style={{ color: HP_COLOR }}>
                  {t("energy.peakHours")} :{" "}
                  {isEur ? formatEur(datum.cost_hp) : formatKWh(hpGrid)}
                </div>
                <div style={{ color: HC_COLOR }}>
                  {t("energy.offPeakHours")} :{" "}
                  {isEur ? formatEur(datum.cost_hc) : formatKWh(hcGrid)}
                </div>
                {!isEur && datum.autoconso > 0 && (
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
          dataKey={isEur ? "cost_hc" : "hc"}
          stackId="consumption"
          fill={HC_COLOR}
          maxBarSize={maxBarSize}
          name="hc"
          shape={(props: { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: ChartDatum }) => {
            const { x = 0, y = 0, width: w = 0, height: h = 0, index = 0, payload } = props;
            // Record baseline for autoconso overlay
            hcBaselines[index] = { x, width: w, baseline: y + h };
            if (!h || h <= 0) return null;
            const topValue = payload ? (isEur ? payload.cost_hp : payload.hp) : 0;
            const rounded = topValue <= 0;
            if (!rounded) return <rect x={x} y={y} width={w} height={h} fill={HC_COLOR} />;
            return <path d={roundedTopRect(x, y, w, h, 4)} fill={HC_COLOR} />;
          }}
        />
        {/* HP (dark blue) on top — also draws autoconso green overlay */}
        <Bar
          dataKey={isEur ? "cost_hp" : "hp"}
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

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DotItemDotProps } from "recharts/types/util/types";
import { CHART_TICK_FONT, CHART_TOOLTIP_FONT } from "../../lib/chart-font";
import { ENERGY_CHART_Y_AXIS_PX, xTickInterval } from "../../lib/chart-ticks";
import { formatHourLabel, formatHourRange } from "../../lib/hour-label";
import { dateLocale } from "../../lib/locale";
import type { BilanPeriod, BilanPoint } from "../../types";
import { formatEur } from "./format";
import { TooltipSeriesRow } from "./TooltipSeriesRow";

// Spec 200 (FR6) — the Bilan's cost bars: paid at peak, paid off-peak, and what
// solar avoided on top. The year view adds the previous year's bill for the
// same month as a dashed tick.

const HP_COLOR = "var(--color-energy-hp)";
const HC_COLOR = "var(--color-energy-hc)";
const AVOIDED_COLOR = "var(--color-solar-auto)";
const PREVIOUS_COLOR = "var(--color-text-tertiary)";

interface Datum {
  label: string;
  tooltipLabel: string;
  paidHp: number;
  paidHc: number;
  avoided: number;
  previousYearBill: number | null;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toData(points: BilanPoint[], period: BilanPeriod, locale: string): Datum[] {
  return points.map((p) => {
    const d = new Date(p.time);
    let label: string;
    let tooltipLabel: string;
    if (period === "day") {
      label = formatHourLabel(d.getHours(), locale);
      tooltipLabel = formatHourRange(d.getHours(), locale);
    } else if (period === "month") {
      label = String(d.getDate());
      tooltipLabel = capitalizeFirst(
        d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
      );
    } else {
      label = capitalizeFirst(d.toLocaleDateString(locale, { month: "short" }));
      tooltipLabel = capitalizeFirst(
        d.toLocaleDateString(locale, { month: "long", year: "numeric" }),
      );
    }
    return {
      label,
      tooltipLabel,
      paidHp: p.paidHp,
      paidHc: p.paidHc,
      avoided: p.avoided,
      previousYearBill: p.previousYearBill ?? null,
    };
  });
}

/** A short dashed line across the bar, at the previous year's bill. */
function PreviousTick(props: { cx?: number; cy?: number; payload?: Datum; halfWidth: number }) {
  const { cx, cy, payload, halfWidth } = props;
  if (cx === undefined || cy === undefined || payload?.previousYearBill == null) return null;
  return (
    <line
      x1={cx - halfWidth}
      x2={cx + halfWidth}
      y1={cy}
      y2={cy}
      stroke={PREVIOUS_COLOR}
      strokeWidth={2}
      strokeDasharray="4 3"
    />
  );
}

export function BilanChart({
  points,
  period,
  showAvoided,
  previousYear,
  height = 260,
}: {
  points: BilanPoint[];
  period: BilanPeriod;
  showAvoided: boolean;
  /** The previous year, for the year view's legend; null elsewhere. */
  previousYear: number | null;
  height?: number;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const data = useMemo(() => toData(points, period, locale), [points, period, locale]);
  const [chartWidth, setChartWidth] = useState(0);

  const tickInterval = xTickInterval(period, data.length, chartWidth - ENERGY_CHART_Y_AXIS_PX);
  const plotWidth = Math.max(0, chartWidth - ENERGY_CHART_Y_AXIS_PX);
  const halfTick = data.length > 0 ? Math.max(4, Math.min(16, plotWidth / data.length / 2 - 2)) : 8;
  const hasPrevious = previousYear !== null && data.some((d) => d.previousYearBill !== null);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height} onResize={(w) => setChartWidth(w)}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-light)"
            vertical={false}
          />
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
            tickFormatter={(eur: number) => formatEur(eur, locale)}
            width={70}
            domain={[0, "auto"]}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload as Datum | undefined;
              if (!d) return null;
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
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.tooltipLabel}</div>
                  <TooltipSeriesRow
                    color={HP_COLOR}
                    label={t("energy.bilan.chart.paidHp")}
                    value={formatEur(d.paidHp, locale)}
                  />
                  <TooltipSeriesRow
                    color={HC_COLOR}
                    label={t("energy.bilan.chart.paidHc")}
                    value={formatEur(d.paidHc, locale)}
                  />
                  {showAvoided && (
                    <TooltipSeriesRow
                      color={AVOIDED_COLOR}
                      label={t("energy.bilan.chart.avoided")}
                      value={formatEur(d.avoided, locale)}
                    />
                  )}
                  {hasPrevious && d.previousYearBill !== null && (
                    <TooltipSeriesRow
                      color={PREVIOUS_COLOR}
                      label={t("energy.bilan.chart.previousYear", { year: previousYear })}
                      value={formatEur(d.previousYearBill, locale)}
                    />
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="paidHp"
            stackId="cost"
            fill={HP_COLOR}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Bar
            dataKey="paidHc"
            stackId="cost"
            fill={HC_COLOR}
            maxBarSize={40}
            isAnimationActive={false}
          />
          {showAvoided && (
            <Bar
              dataKey="avoided"
              stackId="cost"
              fill={AVOIDED_COLOR}
              maxBarSize={40}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          )}
          {hasPrevious && (
            <Line
              dataKey="previousYearBill"
              stroke="none"
              isAnimationActive={false}
              connectNulls={false}
              activeDot={false}
              dot={(p: DotItemDotProps) => (
                <PreviousTick
                  key={`prev-${p.index}`}
                  cx={p.cx}
                  cy={p.cy}
                  payload={p.payload as Datum | undefined}
                  halfWidth={halfTick}
                />
              )}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 mt-3 text-small text-text-secondary flex-wrap">
        <LegendSwatch color={HP_COLOR} label={t("energy.bilan.chart.paidHp")} />
        <LegendSwatch color={HC_COLOR} label={t("energy.bilan.chart.paidHc")} />
        {showAvoided && (
          <LegendSwatch color={AVOIDED_COLOR} label={t("energy.bilan.chart.avoided")} />
        )}
        {hasPrevious && (
          <span className="flex items-center gap-1.5">
            <svg width="14" height="4" aria-hidden>
              <line
                x1="0"
                x2="14"
                y1="2"
                y2="2"
                stroke={PREVIOUS_COLOR}
                strokeWidth={2}
                strokeDasharray="4 3"
              />
            </svg>
            {t("energy.bilan.chart.previousYear", { year: previousYear })}
          </span>
        )}
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block w-2.5 h-2.5 rounded-xs"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

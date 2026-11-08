import type { EnergyTotals, PvForecastResponse } from "../../types";
import type { EnergyUnit } from "../../store/useUiState";
import { canGoForward } from "../../store/useEnergy";
import { formatDateLabel, type SelectorPeriod } from "../../lib/period-label";

/**
 * The figures the Consumption and Production cards open on (spec 197,
 * FR-E6.1–2). Pure, so the arithmetic is tested without rendering a chart.
 */

/** The Consumption headline: the period total and what it is made of. */
export interface ConsumptionHeadline {
  /** Wh, or € in the € view. */
  total: number;
  /** Peak / off-peak split, in the same unit; null without an HP/HC tariff. */
  peak: number | null;
  offPeak: number | null;
  /** Share of the consumption the sun covered, percent; null without any. */
  selfPct: number | null;
}

/**
 * In Wh the total is everything the house used: the grid's share plus the
 * solar self-consumption. In € it is the bill, which self-consumption is not
 * on (spec 123), so the € total stays `cost_total`. The self-consumed share is
 * a share of energy in both views.
 */
export function consumptionHeadline(
  totals: EnergyTotals,
  unit: EnergyUnit,
  hasProduction: boolean,
): ConsumptionHeadline {
  const autoconso = totals.total_autoconso ?? 0;
  const used = totals.total_consumption + autoconso;
  const hasHpHc = totals.total_hc > 0;
  const eur = unit === "eur";
  return {
    total: eur ? totals.cost_total : used,
    peak: hasHpHc ? (eur ? totals.cost_hp : totals.total_hp) : null,
    offPeak: hasHpHc ? (eur ? totals.cost_hc : totals.total_hc) : null,
    selfPct:
      hasProduction && totals.total_consumption > 0 && autoconso > 0
        ? (autoconso / used) * 100
        : null,
  };
}

/** What today's forecast says, summed over every declared array. */
export interface TodayForecast {
  /** Expected energy for the whole local day, kWh. */
  totalKwh: number;
  /** The largest expected hour, kWh — the Production day view's axis floor. */
  peakHourKwh: number;
}

/**
 * Today's expected production across the declared arrays, or null when none
 * has a curve for today. Each curve point is one hour's mean power, so its
 * watts are that hour's watt-hours; arrays are summed hour by hour before the
 * peak is taken, since two arrays peak at the same hour.
 */
export function todayForecast(
  responses: readonly PvForecastResponse[],
  now: Date = new Date(),
): TodayForecast | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const byHour = new Map<number, number>();
  for (const r of responses) {
    if (!r.active) continue;
    for (const p of r.curve) {
      const ms = Date.parse(p.at);
      if (!Number.isFinite(ms) || ms < start.getTime() || ms >= end.getTime()) continue;
      if (!Number.isFinite(p.watts)) continue;
      byHour.set(ms, (byHour.get(ms) ?? 0) + p.watts);
    }
  }
  if (byHour.size === 0) return null;

  let totalWh = 0;
  let peakWh = 0;
  for (const wh of byHour.values()) {
    totalWh += wh;
    if (wh > peakWh) peakWh = wh;
  }
  if (totalWh <= 0) return null;
  return { totalKwh: totalWh / 1000, peakHourKwh: peakWh / 1000 };
}

/**
 * The Production chart's Y ticks: a step per period, the top rounded up from
 * the largest bar. On the day view `floorKwh` (today's forecast peak hour)
 * lifts that top, so a morning's first bars sit in the frame of the day they
 * announce instead of filling a 0.5 kWh one (FR-E6.2).
 */
export function productionYTicks(maxBarKwh: number, period: string, floorKwh = 0): number[] {
  const stepByPeriod: Record<string, number> = { day: 0.5, week: 5, month: 10, year: 200 };
  const step = stepByPeriod[period] ?? 0.5;
  const floor = period === "day" ? floorKwh : 0;
  const top = Math.ceil(Math.max(maxBarKwh, floor, step) / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

/**
 * The words beside the total: « aujourd'hui », « cette semaine »… for the
 * running period, the period's own label (« 7 novembre 2026 ») for a past
 * one, where « aujourd'hui » would be false.
 */
export function periodContextLabel(
  period: SelectorPeriod,
  date: string,
  locale: string,
  t: (key: string) => string,
): string {
  return canGoForward(date, period)
    ? formatDateLabel(date, period, locale)
    : t(`energy.headline.current.${period}`);
}

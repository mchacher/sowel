import type { TFunction } from "i18next";
import { CATEGORY_UNITS, booleanTickLabels, isBooleanCategory } from "./history-utils";
import { humanBindingLabel } from "./binding-label";
import { humanizeAlias } from "../../lib/humanize-alias";
import {
  NBSP,
  NNBSP,
  formatEnergy,
  formatPercent,
  formatPower,
  formatWithUnit,
} from "../../lib/format";

/** The slice of a series the tooltip needs to render one row (#498, point 4). */
export interface TooltipSeries {
  id: string;
  alias: string;
  category: string;
  deviceName: string;
  sameCategoryCount: number;
  equipmentName: string;
  zoneName: string;
  /** The series' equipment no longer exists (a saved chart outlived it). */
  deleted?: boolean;
  color: string;
}

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

/** The unit at the end of a formatted value: what follows its last no-break space. */
function unitSuffix(s: string): string | null {
  const i = Math.max(s.lastIndexOf(NNBSP), s.lastIndexOf(NBSP));
  return i < 0 ? null : s.slice(i);
}

/**
 * The min/max band, by the value's own formatter: « (1 / 1,2 kW) », « (19,0 / 22,0 °C) ».
 * The unit is said once when both ends share it, and on each end when they do not
 * (« (950 W / 1,2 kW) »).
 */
export function formatBand(min: number, max: number, unit?: string): string {
  const lo = formatWithUnit(min, unit);
  const hi = formatWithUnit(max, unit);
  const u = unitSuffix(hi);
  if (u && unitSuffix(lo) === u) return `(${lo.slice(0, -u.length)} / ${hi})`;
  return `(${lo} / ${hi})`;
}

type SeriesLabelInput = Pick<
  TooltipSeries,
  | "alias"
  | "category"
  | "deviceName"
  | "sameCategoryCount"
  | "equipmentName"
  | "zoneName"
  | "deleted"
>;

/** The metric's words. Without a category (the binding is gone with its equipment) the
 *  alias is looked up as a category — `humidity` reads « Humidité » — then humanised. */
export function seriesMetricLabel(s: SeriesLabelInput, t: TFunction): string {
  if (s.category) {
    return humanBindingLabel(
      {
        alias: s.alias,
        category: s.category,
        deviceName: s.deviceName,
        sameCategoryCount: s.sameCategoryCount,
      },
      t,
    );
  }
  return t(`category.${s.alias}`, { defaultValue: humanizeAlias(s.alias) });
}

/** "Zone / Equipment / Metric" (Zone omitted when unknown) — the same label the
 *  legend uses. A series whose equipment was deleted reads « Équipement supprimé ·
 *  Humidité » instead of the equipment's id (spec 196). */
export function seriesFullLabel(s: SeriesLabelInput, t: TFunction): string {
  const metric = seriesMetricLabel(s, t);
  if (s.deleted) return `${t("analyse.series.deleted")} · ${metric}`;
  return s.zoneName
    ? `${s.zoneName} / ${s.equipmentName} / ${metric}`
    : `${s.equipmentName} / ${metric}`;
}

/**
 * Format one tooltip row for a series at a data point. Mirrors the previous
 * inline measurement/boolean formatters:
 * - boolean/state category → localized On/Off (or "NN% On" for an aggregated
 *   bucket mean in (0, 1));
 * - measurement → value with its unit, plus the `(min / max)` envelope band
 *   when the row carries it.
 *
 * Returns `null` when the value is not finite (nothing to show for that row).
 * `rowData` is the merged chart row, read for the `id:min` / `id:max` band keys.
 */
export function formatTooltipRow(
  s: TooltipSeries,
  value: number | string | undefined,
  rowData: Record<string, number> | undefined,
  t: TFunction,
): TooltipRow | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;

  let valueText: string;
  if (isBooleanCategory(s.category)) {
    const [offKey, onKey] = booleanTickLabels(s.category);
    if (num <= 0.05) valueText = t(offKey);
    else if (num >= 0.95) valueText = t(onKey);
    else valueText = `${formatPercent(num * 100)} ${t(onKey)}`;
  } else {
    const unit = CATEGORY_UNITS[s.category];
    valueText = formatWithUnit(num, unit);
    const min = rowData?.[`${s.id}:min`];
    const max = rowData?.[`${s.id}:max`];
    if (typeof min === "number" && typeof max === "number") {
      valueText += ` ${formatBand(min, max, unit)}`;
    }
  }

  return { label: seriesFullLabel(s, t), value: valueText, color: s.color };
}

// ============================================================
// Recharts <Tooltip formatter> (#681)
// ============================================================
//
// Recharts hands a tooltip formatter its value as `ValueType`
// (string | number | (string | number)[]) and its name as `NameType`
// (string | number). Recharts 3.10 tightened `Formatter<ValueType, NameType>`,
// so a formatter declared as `(value: number | undefined)` stopped
// typechecking: a parameter has to accept everything the caller may hand it,
// not just the shape this chart happens to feed in.
//
// Both history charts therefore declare `unknown` at the call site and narrow
// through the helpers below. That keeps the components off the recharts type
// surface, so the next tightening of `Formatter` cannot break them again.

/** Narrow a recharts tooltip value to a number. Non-finite input reads 0,
 *  which is what the previous `value ?? 0` call sites did. */
export function tooltipNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Narrow a recharts tooltip series name to a string. */
export function tooltipName(name: unknown): string {
  return typeof name === "string" || typeof name === "number" ? String(name) : "";
}

/** Format a value with its unit for tooltip display (bar chart). */
export function formatValueWithUnit(value: number, unit?: string): string {
  // Energy: convert Wh to kWh when appropriate
  if (unit === "Wh" || unit === "kWh") {
    const kwh = unit === "kWh" ? value : value / 1000;
    return formatEnergy(kwh, { unit: "auto" });
  }

  // Generic: the unit's own precision (lib/format).
  return formatWithUnit(value, unit);
}

function formatValue(v: number, unit?: string): string {
  return formatWithUnit(v, unit);
}

/**
 * A Y axis tick: one unit for every tick of the axis, picked from the axis's largest
 * magnitude. `formatWithUnit` alone picks per value, so a power axis read
 * « 500 W, 1 kW, 1,5 kW ». Here it reads « 0,5 kW, 1 kW, 1,5 kW » when the axis reaches
 * a kilowatt, « 200 W, 400 W » when it does not; the same for Wh / kWh. Other units
 * have one unit already. `unit` empty: the bare number.
 */
export function formatAxisTick(value: number, unit: string, axisMax: number): string {
  const peak = Math.abs(axisMax);
  if (unit === "W" || unit === "kW") {
    const watts = unit === "kW" ? value * 1000 : value;
    const peakW = unit === "kW" ? peak * 1000 : peak;
    return formatPower(watts, { unit: peakW >= 1000 ? "kW" : "W" });
  }
  if (unit === "Wh" || unit === "kWh") {
    const kwh = unit === "Wh" ? value / 1000 : value;
    const peakKwh = unit === "Wh" ? peak / 1000 : peak;
    return formatEnergy(kwh, { unit: peakKwh >= 1 ? "kWh" : "Wh" });
  }
  return formatWithUnit(value, unit);
}

/** Bar chart tooltip row: the value with its unit, plus the fixed series label. */
export function formatBarTooltip(
  value: unknown,
  unit: string | undefined,
  label: string,
): [string, string] {
  return [formatValueWithUnit(tooltipNumber(value), unit), label];
}

export interface SeriesTooltipOptions {
  unit?: string;
  /** Power series render in W/kW and carry their own label. */
  isPower: boolean;
  /** Boolean/enum series render as on/off words. */
  isDiscrete: boolean;
  /** Localizer for the power label and the on/off words. */
  t: (key: string) => string;
}

/** Time series tooltip row: power, min/max envelope band, discrete on/off, or
 *  a plain value with its unit. */
export function formatSeriesTooltip(
  value: unknown,
  name: unknown,
  { unit, isPower, isDiscrete, t }: SeriesTooltipOptions,
): [string, string] {
  const v = tooltipNumber(value);
  const key = tooltipName(name);
  const isBand = key === "min" || key === "max";

  if (isPower) {
    return [formatPower(v), isBand ? key : t("category.power")];
  }
  if (isBand) return [formatValue(v, unit), key];
  if (isDiscrete) return [v === 1 ? t("controls.on") : t("controls.off"), ""];
  return [formatValue(v, unit), ""];
}

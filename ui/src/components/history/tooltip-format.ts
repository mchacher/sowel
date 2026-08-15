import type { TFunction } from "i18next";
import { CATEGORY_UNITS, booleanTickLabels, isBooleanCategory } from "./history-utils";
import { humanBindingLabel } from "./binding-label";

/** The slice of a series the tooltip needs to render one row (#498, point 4). */
export interface TooltipSeries {
  id: string;
  alias: string;
  category: string;
  deviceName: string;
  sameCategoryCount: number;
  equipmentName: string;
  zoneName: string;
  color: string;
}

export interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** "Zone / Equipment / Metric" (Zone omitted when unknown) — the same label the
 *  legend uses. */
export function seriesFullLabel(s: TooltipSeries, t: TFunction): string {
  const metric = s.category
    ? humanBindingLabel(
        { alias: s.alias, category: s.category, deviceName: s.deviceName, sameCategoryCount: s.sameCategoryCount },
        t,
      )
    : s.alias;
  return s.zoneName ? `${s.zoneName} / ${s.equipmentName} / ${metric}` : `${s.equipmentName} / ${metric}`;
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
    else valueText = `${Math.round(num * 100)}% ${t(onKey)}`;
  } else {
    const unit = CATEGORY_UNITS[s.category];
    valueText = unit ? `${fmt(num)} ${unit}` : fmt(num);
    const min = rowData?.[`${s.id}:min`];
    const max = rowData?.[`${s.id}:max`];
    if (typeof min === "number" && typeof max === "number") {
      valueText += ` (${fmt(min)} / ${fmt(max)})`;
    }
  }

  return { label: seriesFullLabel(s, t), value: valueText, color: s.color };
}

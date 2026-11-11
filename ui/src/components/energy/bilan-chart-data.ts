// Spec 200/205 — the data of the Bilan chart, apart from the component so it
// can be tested without Recharts: the buckets as the axis shows them, and where
// the « New prices » markers go.

import { formatHourLabel, formatHourRange } from "../../lib/hour-label";
import { localDateStr } from "../../lib/local-date";
import type { BilanPeriod, BilanPoint } from "../../types";

export interface Datum {
  /** The local day ("YYYY-MM-DD") or month ("YYYY-MM") of the bucket, for the markers. */
  key: string;
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

export function toData(points: BilanPoint[], period: BilanPeriod, locale: string): Datum[] {
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
    // The buckets carry UTC instants: the local calendar names the day or month.
    const day = localDateStr(d);
    return {
      key: period === "year" ? day.slice(0, 7) : day,
      label,
      tooltipLabel,
      paidHp: p.paidHp,
      paidHc: p.paidHc,
      avoided: p.avoided,
      previousYearBill: p.previousYearBill ?? null,
    };
  });
}

export interface ChangeMarker {
  /** The x-axis label of the bucket the new prices start in. */
  label: string;
  /** Which side of the line the label sits on: away from the plot's nearer edge. */
  side: "right" | "left";
  /** 0 on top; 1 one line lower, when the previous marker's label is too close. */
  row: number;
}

/**
 * Spec 205 — the « New prices » markers: one per bucket a change starts in.
 * The label sits right of the line in the left half of the axis, left of it in
 * the right half, so it stays inside the plot; a label that would run into the
 * previous one drops one line.
 */
export function changeMarkerLayout(
  data: Datum[],
  changes: string[],
  plotWidth: number,
  labelWidth: number,
): ChangeMarker[] {
  const step = data.length > 0 ? plotWidth / data.length : 0;
  const markers: ChangeMarker[] = [];
  let previous: { index: number; row: number } | null = null;
  data.forEach((d, index) => {
    if (!changes.includes(d.key)) return;
    const tooClose = previous !== null && (index - previous.index) * step < labelWidth;
    const row = tooClose && previous ? 1 - previous.row : 0;
    markers.push({ label: d.label, side: index < data.length / 2 ? "right" : "left", row });
    previous = { index, row };
  });
  return markers;
}

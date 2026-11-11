import type { TariffVersion } from "../types";

// Spec 202 (FR6) — what the price history shows, apart from how it is drawn.
// The server stores a start date per version; the end date and the « En cours »
// / « À venir » pill are derived here, from the next version and today's date.

/** `current`: in force, the last one. `upcoming`: the last one, not started yet. */
export type TariffVersionStatus = "current" | "upcoming" | null;

export interface TariffVersionRow {
  version: TariffVersion;
  /** Local `YYYY-MM-DD`; null for the version without a date (« Origine »). */
  startDate: string | null;
  /** The day before the next version starts; null for the last version. */
  endDate: string | null;
  status: TariffVersionStatus;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The day before a `YYYY-MM-DD` day. A calendar count through `Date.UTC`, so no
 * browser timezone and no DST jump can shift it.
 */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

/** Oldest first: the version without a date, then by start date. */
function byStart(a: TariffVersion, b: TariffVersion): number {
  if (a.startDate === b.startDate) return 0;
  if (a.startDate === null) return -1;
  if (b.startDate === null) return 1;
  return a.startDate < b.startDate ? -1 : 1;
}

/**
 * The rows of the price history, newest first.
 *
 * @param today the viewer's local date, `YYYY-MM-DD` (`localDateStr()`).
 */
export function buildTariffVersionRows(
  versions: readonly TariffVersion[],
  today: string,
): TariffVersionRow[] {
  const ordered = [...versions].sort(byStart);
  const rows = ordered.map((version, i): TariffVersionRow => {
    const next = ordered[i + 1];
    const last = i === ordered.length - 1;
    const started = version.startDate === null || version.startDate <= today;
    return {
      version,
      startDate: version.startDate,
      endDate: next?.startDate ? dayBefore(next.startDate) : null,
      status: last ? (started ? "current" : "upcoming") : null,
    };
  });
  return rows.reverse();
}

/**
 * A number typed in a form field, with a comma or a dot as the decimal mark
 * (« 0,2142 », « 0.2142 »). Null when the text is not a plain positive number;
 * an empty field is the caller's business. `\s` covers the no-break spaces a
 * pasted French number carries between thousands.
 */
export function parseDecimalInput(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

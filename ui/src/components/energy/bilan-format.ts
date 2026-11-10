// Spec 200 — the words of the Bilan page, apart from the component so they can
// be tested without rendering. Every function takes the locale and `t` rather
// than reading i18n itself (the #730 lesson).

import type { BilanArbiter, BilanComparison, BilanPeriod } from "../../types";
import { formatPercent } from "../../lib/format";
import { formatEur, formatWh } from "./format";

type T = (key: string, opts?: Record<string, unknown>) => string;

function at(date: string): Date {
  return new Date(date + "T12:00:00");
}

function monthName(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { month: "long" });
}

/** "10 novembre" / "November 10". */
function dayMonth(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { day: "numeric", month: "long" });
}

/** "10 novembre 2026" / "November 10, 2026". */
function fullDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/** French elides "de" before a vowel: « d'octobre », « de novembre ». */
function startsWithVowel(word: string): boolean {
  return /^[aeiouyàâéèêîôûh]/i.test(word);
}

/** The bill's label (FR2). `today` is the local "YYYY-MM-DD" of now. */
export function billLabel(
  period: BilanPeriod,
  date: string,
  today: string,
  locale: string,
  t: T,
): string {
  const d = at(date);
  const now = at(today);
  if (period === "day") {
    return date === today
      ? t("energy.bilan.bill.today")
      : t("energy.bilan.bill.day", { date: dayMonth(d, locale) });
  }
  if (period === "month") {
    const current = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    const month = current
      ? monthName(d, locale)
      : d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    const key = startsWithVowel(month) ? "energy.bilan.bill.monthVowel" : "energy.bilan.bill.month";
    const label = t(key, { month });
    return current ? t("energy.bilan.bill.asOf", { label, day: now.getDate() }) : label;
  }
  const label = t("energy.bilan.bill.year", { year: d.getFullYear() });
  return d.getFullYear() === now.getFullYear()
    ? t("energy.bilan.bill.asOfDate", { label, date: dayMonth(now, locale) })
    : label;
}

/** Are these "YYYY-MM" months consecutive? */
function contiguous(months: string[]): boolean {
  for (let i = 1; i < months.length; i++) {
    const [y0, m0] = months[i - 1].split("-").map(Number);
    const [y1, m1] = months[i].split("-").map(Number);
    if (y1 * 12 + m1 - (y0 * 12 + m0) !== 1) return false;
  }
  return true;
}

function monthOf(key: string, locale: string): string {
  const [y, m] = key.split("-").map(Number);
  return monthName(new Date(y, m - 1, 15), locale);
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The comparison under the bill (FR3): a main line and an optional second one. */
export function comparisonLines(
  c: BilanComparison | null,
  date: string,
  locale: string,
  t: T,
): { main: string; sub?: string } | null {
  const lines = comparisonText(c, date, locale, t);
  if (!lines) return null;
  // A line may open on a month name, lower case in French.
  return {
    main: capitalizeFirst(lines.main),
    ...(lines.sub ? { sub: capitalizeFirst(lines.sub) } : {}),
  };
}

function comparisonText(
  c: BilanComparison | null,
  date: string,
  locale: string,
  t: T,
): { main: string; sub?: string } | null {
  if (!c) return null;
  const d = at(date);
  if (c.kind === "days") {
    return {
      main: t("energy.bilan.compare.days", {
        count: c.days,
        amount: formatEur(c.averageBill, locale),
      }),
    };
  }
  if (c.kind === "month") {
    const prev =
      c.previousYearBill !== null
        ? t("energy.bilan.compare.previousYearMonth", {
            month: new Date(d.getFullYear() - 1, d.getMonth(), 15).toLocaleDateString(locale, {
              month: "long",
              year: "numeric",
            }),
            amount: formatEur(c.previousYearBill, locale),
          })
        : undefined;
    if (c.projectedBill !== null) {
      return {
        main: t("energy.bilan.compare.projection", {
          month: monthName(d, locale),
          amount: formatEur(c.projectedBill, locale),
        }),
        sub: prev,
      };
    }
    return prev ? { main: prev } : null;
  }
  const params: Record<string, unknown> = {
    bill: formatEur(c.bill, locale),
    previous: formatEur(c.previousYearBill, locale),
    year: d.getFullYear() - 1,
  };
  const pct =
    c.previousYearBill > 0
      ? formatPercent(((c.bill - c.previousYearBill) / c.previousYearBill) * 100, {
          signed: true,
          locale,
        })
      : null;
  let main: string;
  if (c.months.length === 1) {
    main = t("energy.bilan.compare.yearOneMonth", {
      ...params,
      month: monthOf(c.months[0], locale),
    });
  } else if (contiguous(c.months)) {
    const first = monthOf(c.months[0], locale);
    const key = startsWithVowel(first)
      ? "energy.bilan.compare.yearRangeVowel"
      : "energy.bilan.compare.yearRange";
    main = t(key, {
      ...params,
      first,
      last: monthOf(c.months[c.months.length - 1], locale),
    });
  } else {
    main = t("energy.bilan.compare.yearMonths", { ...params, count: c.months.length });
  }
  return { main: pct ? t("energy.bilan.compare.withPercent", { text: main, pct }) : main };
}

/** Whether the arbiter tile shows at all (FR5). */
export function showArbiterTile(a: BilanArbiter): boolean {
  return a.enabled || a.loads.length > 0;
}

/** The arbiter tile (FR5): its value (null = not measured) and its captions. */
export function arbiterTileText(
  a: BilanArbiter,
  locale: string,
  t: T,
): { value: string | null; caption: string; note?: string } {
  if (a.measured === "none") {
    return {
      value: null,
      caption: a.since
        ? t("energy.bilan.arbiter.from", { date: fullDate(at(a.since), locale) })
        : t("energy.bilan.arbiter.starting"),
    };
  }
  const caption =
    a.loads.length === 0
      ? t("energy.bilan.arbiter.noLoad")
      : a.loads
          .slice(0, 2)
          .map((l) =>
            t("energy.bilan.arbiter.load", {
              name: l.name ?? t("energy.bilan.arbiter.removed"),
              energy: formatWh(l.solarWh, locale),
            }),
          )
          .join(", ");
  const note =
    a.measured === "partial" && a.since
      ? t("energy.bilan.arbiter.since", { date: fullDate(at(a.since), locale) })
      : undefined;
  return { value: formatEur(a.avoided, locale), caption, note };
}

// Spec 200 — the words of the Bilan page, apart from the component so they can
// be tested without rendering. Every function takes the locale and `t` rather
// than reading i18n itself (the #730 lesson).

import type {
  BilanArbiter,
  BilanComparison,
  BilanFee,
  BilanPeriod,
  BilanPriceSpan,
  TariffPrices,
} from "../../types";
import { formatCurrency, formatNumber, formatPercent } from "../../lib/format";
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

/** Spec 205 FR3 — the fee block of the bill card. */
export function feeLines(
  fee: BilanFee,
  bill: number,
  locale: string,
  t: T,
): { label: string; amount: string; caption: string; missing: boolean; total: string } {
  const label =
    fee.kva !== null
      ? t("energy.bilan.fee.labelKva", { kva: formatNumber(fee.kva, { maxDecimals: 1, locale }) })
      : t("energy.bilan.fee.label");
  const prorata = t("energy.bilan.fee.prorata", { count: fee.days });
  const caption =
    fee.daysWithoutFee > 0
      ? t("energy.bilan.fee.missing", { caption: prorata, count: fee.daysWithoutFee })
      : prorata;
  return {
    label,
    amount: formatEur(fee.total, locale),
    caption,
    missing: fee.daysWithoutFee > 0,
    total: formatEur(bill + fee.total, locale),
  };
}

function isFrench(locale: string): boolean {
  return locale.toLowerCase().startsWith("fr");
}

/** « 1er février », « 31 juillet » / "February 1"; the day alone without the month. */
function spanDay(day: string, locale: string, withMonth: boolean): string {
  const d = at(day);
  if (isFrench(locale)) {
    const n = d.getDate() === 1 ? "1er" : String(d.getDate());
    return withMonth ? `${n} ${monthName(d, locale)}` : n;
  }
  return withMonth ? dayMonth(d, locale) : String(d.getDate());
}

/** « Du 1er au 31 janvier », « Du 1er février au 31 juillet », « Le 31 mars ». */
function spanRange(span: BilanPriceSpan, locale: string, t: T): string {
  if (span.from === span.to) {
    return t("energy.bilan.method.rangeDay", { date: spanDay(span.from, locale, true) });
  }
  // Within one month the month is said once: after the last day in French
  // (« Du 1er au 31 janvier »), after the first in English ("From January 1 to 31").
  const sameMonth = span.from.slice(0, 7) === span.to.slice(0, 7);
  const fr = isFrench(locale);
  return t("energy.bilan.method.range", {
    from: spanDay(span.from, locale, !sameMonth || !fr),
    to: spanDay(span.to, locale, !sameMonth || fr),
  });
}

/**
 * Spec 205 FR4 — the prices of the method card: today's single sentence (with
 * the fee and the power when known) for one version over the period, else an
 * intro and one item per span.
 */
export function methodSpans(
  spans: BilanPriceSpan[],
  prices: TariffPrices,
  locale: string,
  t: T,
): { intro: string; items: string[] } {
  const kwh = (v: number) => formatCurrency(v, { locale, decimals: 4 });
  const year = (v: number) => formatCurrency(v, { locale });
  if (spans.length <= 1) {
    // The prices, the fee and the power of one and the same version.
    const span = spans[0];
    const params = span
      ? { hp: kwh(span.hp), hc: kwh(span.hc) }
      : { hp: kwh(prices.hp), hc: kwh(prices.hc) };
    if (!span || span.fixedFeeYear === null) {
      return { intro: t("energy.bilan.method.tariff", params), items: [] };
    }
    const fee = year(span.fixedFeeYear);
    const intro =
      span.kva !== null
        ? t("energy.bilan.method.tariffFeeKva", {
            ...params,
            fee,
            kva: formatNumber(span.kva, { maxDecimals: 1, locale }),
          })
        : t("energy.bilan.method.tariffFee", { ...params, fee });
    return { intro, items: [] };
  }
  const items = spans.map((span) => {
    const params = { range: spanRange(span, locale, t), hp: kwh(span.hp), hc: kwh(span.hc) };
    return span.fixedFeeYear === null
      ? t("energy.bilan.method.span", params)
      : t("energy.bilan.method.spanFee", { ...params, fee: year(span.fixedFeeYear) });
  });
  return { intro: t("energy.bilan.method.changed"), items };
}

/**
 * Spec 205 FR4 — where the chart marks a price change: the local day (month
 * view) or month ("YYYY-MM", year view) each span after the first starts.
 * None on the day view.
 */
export function changeMarkers(period: BilanPeriod, spans: BilanPriceSpan[]): string[] {
  if (period === "day") return [];
  return spans.slice(1).map((s) => (period === "month" ? s.from : s.from.slice(0, 7)));
}

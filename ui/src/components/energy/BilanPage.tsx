import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getEnergyBilan } from "../../api";
import { formatNumber } from "../../lib/format";
import { localDateStr } from "../../lib/local-date";
import { dateLocale } from "../../lib/locale";
import { useEnergy } from "../../store/useEnergy";
import type { BilanPeriod, BilanUsageRow, EnergyBilanResponse } from "../../types";
import { BilanChart } from "./BilanChart";
import {
  arbiterTileText,
  averagePrice,
  billLabel,
  changeMarkers,
  comparisonLines,
  energyComparisonLines,
  energyLabel,
  energyLines,
  feeLines,
  methodSpans,
  showArbiterTile,
  type EnergyPart,
} from "./bilan-format";
import { EnergyMobileNav } from "./EnergyMobileNav";
import { formatEur, formatWh } from "./format";
import { PeriodSelector } from "./PeriodSelector";
import { ColumnLabel } from "../ui/ColumnLabel";

// Spec 200 — Energy > Bilan: what electricity cost, what solar avoided, and
// what the arbiter earned, for a day, a month or a year.

const BILAN_PERIODS = ["day", "month", "year"] as const;
const PAID_COLOR = "var(--color-energy-hp)";
const HC_COLOR = "var(--color-energy-hc)";
const AVOIDED_COLOR = "var(--color-solar-auto)";
/** Spec 207 — the kWh bar's parts, in the chart colours. */
const PART_COLOR: Record<EnergyPart["key"], string> = {
  hp: PAID_COLOR,
  hc: HC_COLOR,
  solar: AVOIDED_COLOR,
};

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 rounded-xs flex-none"
      style={{ backgroundColor: color }}
    />
  );
}

/** A bar split into paid and avoided, as shares of `max`. */
function SplitBar({
  paid,
  avoided,
  max,
  className,
  track = "bg-border-light",
  label,
}: {
  paid: number;
  avoided: number;
  max: number;
  className: string;
  /** The background of the part that is neither paid nor avoided. */
  track?: string;
  label?: string;
}) {
  const pct = (v: number) => (max > 0 ? `${(v / max) * 100}%` : "0%");
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`flex overflow-hidden ${track} ${className}`}
    >
      <div style={{ width: pct(paid), backgroundColor: PAID_COLOR }} />
      <div style={{ width: pct(avoided), backgroundColor: AVOIDED_COLOR }} />
    </div>
  );
}

export function BilanPage() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const period = useEnergy((s) => s.period);
  const date = useEnergy((s) => s.date);
  const setPeriod = useEnergy((s) => s.setPeriod);
  const [data, setData] = useState<EnergyBilanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // The page has no week: arriving with it selected reads the month around the date.
  useEffect(() => {
    if (period === "week") setPeriod("month");
  }, [period, setPeriod]);

  const bilanPeriod: BilanPeriod | null = period === "week" ? null : period;

  useEffect(() => {
    if (!bilanPeriod) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    getEnergyBilan(bilanPeriod, date)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bilanPeriod, date]);

  const today = localDateStr();

  return (
    <div className="p-4 sm:p-6">
      <EnergyMobileNav />
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
        <h1 className="hidden lg:block">{t("energy.bilan")}</h1>
        <PeriodSelector periods={BILAN_PERIODS} />
      </div>

      {error ? (
        <div className="card p-6 text-small text-text-secondary">{t("energy.bilan.error")}</div>
      ) : !data ? (
        <div className="flex items-center justify-center h-[300px] text-text-tertiary text-small">
          {t("common.loading")}
        </div>
      ) : !data.tariffConfigured ? (
        <div className="card p-6 flex flex-col gap-2 text-small text-text-secondary">
          <p>{t("energy.bilan.noTariff")}</p>
          <Link to="/settings?tab=energy" className="text-primary hover:underline self-start">
            {t("energy.bilan.noTariffLink")}
          </Link>
        </div>
      ) : (
        <div
          className={`flex flex-col gap-4 sm:gap-5 transition-opacity ${loading ? "opacity-50" : ""}`}
          aria-busy={loading}
        >
          <BillCard data={data} date={date} today={today} locale={locale} />
          <Tiles data={data} locale={locale} />
          <section className="card p-4 sm:p-6 flex flex-col gap-4">
            <h2 className="text-lead font-semibold text-text">
              {t(`energy.bilan.chart.${data.period}`)}
            </h2>
            <BilanChart
              points={data.points}
              period={data.period}
              showAvoided={data.hasProduction}
              changes={changeMarkers(data.period, data.priceSpans)}
              previousYear={
                data.period === "year" ? new Date(date + "T12:00:00").getFullYear() - 1 : null
              }
            />
          </section>
          {data.usage.length > 0 && <UsageCard data={data} locale={locale} />}
          <MethodCard data={data} locale={locale} />
        </div>
      )}
    </div>
  );
}

function BillCard({
  data,
  date,
  today,
  locale,
}: {
  data: EnergyBilanResponse;
  date: string;
  today: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const comparison = comparisonLines(data.comparison, date, locale, t);
  // Spec 205 — the fixed fee, apart from the consumption the headline states.
  const fee = data.fee ? feeLines(data.fee, data.bill.total, locale, t) : null;
  // Spec 207 — euros on the left, kWh on the right: two cards on a phone, the
  // two columns of one card from lg, a vertical rule between them.
  return (
    <div className="flex flex-col gap-4 sm:gap-5 lg:card lg:grid lg:grid-cols-2 lg:gap-0 lg:p-7">
      <section className="card p-5 sm:p-7 lg:p-0 lg:pr-8 lg:shadow-none flex flex-col gap-2 min-w-0">
        <span className="text-small font-medium text-text-secondary">
          {billLabel(data.period, date, today, locale, t)}
        </span>
        <span className="text-value font-semibold text-text tabular-nums leading-tight">
          {formatEur(data.bill.total, locale)}
        </span>
        <div className="flex flex-col sm:flex-row gap-1 sm:gap-5 text-small text-text-secondary tabular-nums">
          <span className="flex items-center gap-1.5">
            <Swatch color={PAID_COLOR} />
            {t("energy.peakHours")} {formatEur(data.bill.hp, locale)}
          </span>
          <span className="flex items-center gap-1.5">
            <Swatch color={HC_COLOR} />
            {t("energy.offPeakHours")} {formatEur(data.bill.hc, locale)}
          </span>
        </div>
        {fee && (
          <div
            data-testid="bilan-fee"
            className="mt-2 pt-3.5 border-t border-border flex flex-col gap-2.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-small font-medium text-text">{fee.label}</span>
                <span className="text-caption text-text-tertiary tabular-nums">
                  {fee.caption}
                  {fee.missing && (
                    <>
                      {" "}
                      <Link to="/settings?tab=energy" className="text-primary hover:underline">
                        {t("energy.bilan.method.tariffLink")}
                      </Link>
                    </>
                  )}
                </span>
              </div>
              <span className="text-lead font-semibold text-text tabular-nums">{fee.amount}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small font-medium text-text">
                {t("energy.bilan.fee.total")}
              </span>
              <span className="text-title font-semibold text-text tabular-nums">{fee.total}</span>
            </div>
          </div>
        )}
        {comparison && (
          <div
            className={`${fee ? "mt-1.5" : "mt-2"} rounded-sm bg-background px-3.5 py-3 flex flex-col gap-1`}
          >
            <span className="text-small text-text tabular-nums">{comparison.main}</span>
            {comparison.sub && (
              <span className="text-caption text-text-tertiary tabular-nums">{comparison.sub}</span>
            )}
            {fee && (
              <span className="text-caption text-text-tertiary">
                {t("energy.bilan.fee.comparison")}
              </span>
            )}
          </div>
        )}
      </section>
      <EnergyColumn data={data} date={date} today={today} locale={locale} />
    </div>
  );
}

/** Spec 207 FR3 — what the period consumed, in kWh. */
function EnergyColumn({
  data,
  date,
  today,
  locale,
}: {
  data: EnergyBilanResponse;
  date: string;
  today: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const lines = energyLines(data.energy, data.hasProduction, locale, t);
  const gridWh = data.energy.gridHpWh + data.energy.gridHcWh;
  const comparison = energyComparisonLines(data.comparison, gridWh, date, today, locale, t);
  const price = averagePrice(data.bill.total, data.energy, data.fee, locale, t);
  const max = lines.parts.reduce((s, p) => s + p.wh, 0);
  const pct = (wh: number) => (max > 0 ? `${(wh / max) * 100}%` : "0%");
  return (
    <section
      data-testid="bilan-energy"
      className="card p-5 sm:p-7 lg:p-0 lg:pl-8 lg:shadow-none lg:border-l lg:border-border flex flex-col gap-2 min-w-0"
    >
      <span className="text-small font-medium text-text-secondary">
        {energyLabel(data.period, date, today, locale, t)}
      </span>
      <span className="text-display lg:text-value font-semibold text-text tabular-nums leading-tight">
        {lines.total}
      </span>
      <div
        role="img"
        aria-label={lines.parts.map((p) => `${p.label} ${p.value}`).join(", ")}
        className="mt-1 flex h-3 overflow-hidden rounded-sm bg-border-light"
      >
        {lines.parts.map((p) => (
          <div
            key={p.key}
            data-testid={`bilan-energy-${p.key}`}
            style={{ width: pct(p.wh), backgroundColor: PART_COLOR[p.key] }}
          />
        ))}
      </div>
      {/* Labels on one row, values on the next: a wrapped label never
          pushes its value out of line with the others. */}
      <div
        className={`mt-1 grid grid-flow-col grid-rows-[auto_auto] gap-x-2 sm:gap-x-3 gap-y-0.5 ${lines.parts.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
      >
        {lines.parts.flatMap((p) => [
          <span
            key={`${p.key}-label`}
            className="flex items-start gap-1.5 text-caption text-text-tertiary min-w-0"
          >
            <span className="flex h-4.5 items-center">
              <Swatch color={PART_COLOR[p.key]} />
            </span>
            {p.label}
          </span>,
          <span
            key={`${p.key}-value`}
            className={`text-lead font-semibold tabular-nums ${p.key === "solar" ? "text-solar-ink" : "text-text"}`}
          >
            {p.value}
          </span>,
        ])}
      </div>
      <span className="text-caption text-text-tertiary tabular-nums">{lines.sentence}</span>
      {(comparison || price) && (
        <div className="mt-1.5 rounded-sm bg-background px-3.5 py-3 flex flex-col gap-1">
          {comparison && (
            <span className="text-small text-text tabular-nums">{comparison.main}</span>
          )}
          {comparison?.sub && (
            <span className="text-caption text-text-tertiary tabular-nums">{comparison.sub}</span>
          )}
          {price && <span className="text-caption text-text-tertiary tabular-nums">{price}</span>}
        </div>
      )}
    </section>
  );
}

function Tiles({ data, locale }: { data: EnergyBilanResponse; locale: string }) {
  const { t } = useTranslation();
  const showArbiter = showArbiterTile(data.arbiter);
  if (!data.hasProduction && !showArbiter) return null;
  const arbiter = arbiterTileText(data.arbiter, locale, t);
  const withoutSolar = formatEur(data.bill.total + data.avoided, locale);
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5">
      {data.hasProduction && (
        <section className="card p-4 sm:px-6 sm:py-5 flex flex-col gap-1 sm:gap-1.5 min-w-0">
          <span className="text-caption sm:text-small font-medium text-text-secondary">
            {t("energy.bilan.solar.title")}
          </span>
          <span className="text-title sm:text-display font-semibold text-solar-ink tabular-nums">
            {formatEur(data.avoided, locale)}
          </span>
          {/* Spec 207 FR4 — the bill without panels; its kWh moved to the kWh column. */}
          <span className="hidden sm:block text-caption text-text-tertiary tabular-nums">
            {t("energy.bilan.solar.withoutSolar", { amount: withoutSolar })}
          </span>
          <span className="sm:hidden text-micro text-text-tertiary tabular-nums">
            {t("energy.bilan.solar.withoutSolarShort", { amount: withoutSolar })}
          </span>
        </section>
      )}
      {showArbiter && (
        <section className="card p-4 sm:px-6 sm:py-5 flex flex-col gap-1 sm:gap-1.5 min-w-0">
          <span className="text-caption sm:text-small font-medium text-text-secondary">
            {t("energy.bilan.arbiter.title")}
          </span>
          {arbiter.value ? (
            <span className="text-title sm:text-display font-semibold text-text tabular-nums">
              {arbiter.value}
            </span>
          ) : (
            <span className="text-lead sm:text-title font-semibold text-text-tertiary">
              {t("energy.bilan.arbiter.notMeasured")}
            </span>
          )}
          <span className="text-micro sm:text-caption text-text-tertiary tabular-nums">
            {arbiter.caption}
          </span>
          {arbiter.note && (
            <span className="text-micro sm:text-caption text-text-tertiary">{arbiter.note}</span>
          )}
        </section>
      )}
    </div>
  );
}

function usageName(row: BilanUsageRow, t: (k: string) => string): string {
  return row.id === null ? t("energy.bilan.usage.other") : row.name;
}

function UsageCard({ data, locale }: { data: EnergyBilanResponse; locale: string }) {
  const { t } = useTranslation();
  const max = Math.max(...data.usage.map((u) => u.paid + u.avoided), 0);
  const solar = data.hasProduction;
  return (
    <section className="card p-4 sm:p-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lead font-semibold text-text">{t("energy.bilan.usage.title")}</h2>
        <span className="text-caption text-text-tertiary">{t("energy.bilan.usage.sorted")}</span>
      </div>

      {/* Desktop and tablet: a table. */}
      <table className="hidden sm:table w-full text-small tabular-nums">
        <thead>
          <tr className="text-left text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            <th scope="col" className="py-2 font-semibold w-[22%]">
              {t("energy.bilan.usage.usage")}
            </th>
            <th scope="col" className="py-2 font-semibold text-right w-[10%]">
              <ColumnLabel text={t("energy.bilan.usage.energy")} />
            </th>
            <th scope="col" className="py-2 font-semibold text-right w-[12%]">
              {t("energy.bilan.usage.paid")}
            </th>
            {solar && (
              <th scope="col" className="py-2 font-semibold text-right w-[14%]">
                {t("energy.bilan.usage.avoided")}
              </th>
            )}
            <th scope="col" className="py-2 pl-8 font-semibold">
              {t("energy.bilan.usage.share")}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.usage.map((u) => (
            <tr key={u.id ?? "other"} className="border-t border-border-light">
              <td className="py-2.5 font-medium text-text">{usageName(u, t)}</td>
              <td className="py-2.5 text-right text-text-secondary">
                {formatNumber(u.wh / 1000, { maxDecimals: 1, locale })}
              </td>
              <td className="py-2.5 text-right font-semibold text-text">
                {formatEur(u.paid, locale)}
              </td>
              {solar && (
                <td className="py-2.5 text-right text-solar-ink">
                  {u.avoided > 0.004 ? formatEur(u.avoided, locale) : "—"}
                </td>
              )}
              <td className="py-2.5 pl-8">
                <SplitBar
                  paid={u.paid}
                  avoided={solar ? u.avoided : 0}
                  max={max}
                  className="h-2.5 rounded-xs"
                  track="bg-background"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phone: one row per usage. */}
      <ul className="sm:hidden flex flex-col">
        {data.usage.map((u) => (
          <li
            key={u.id ?? "other"}
            className="border-t border-border-light py-2.5 flex flex-col gap-1.5"
          >
            <div className="flex items-baseline justify-between gap-2 text-small">
              <span className="font-medium text-text">{usageName(u, t)}</span>
              <span className="font-semibold text-text tabular-nums">
                {formatEur(u.paid, locale)}
              </span>
            </div>
            <SplitBar
              paid={u.paid}
              avoided={solar ? u.avoided : 0}
              max={max}
              className="h-2 rounded-xs"
              track="bg-background"
            />
            <div className="flex justify-between text-micro text-text-tertiary tabular-nums">
              <span>{formatWh(u.wh, locale)}</span>
              {solar && u.avoided > 0.004 && (
                <span className="text-solar-ink">
                  {t("energy.bilan.usage.avoidedShort", { amount: formatEur(u.avoided, locale) })}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MethodText({ data, locale }: { data: EnergyBilanResponse; locale: string }) {
  const { t } = useTranslation();
  // Spec 205 — one sentence for one version, else one item per span.
  const prices = methodSpans(data.priceSpans, data.prices, locale, t);
  return (
    <>
      <p>
        {prices.intro}{" "}
        <Link to="/settings?tab=energy" className="text-primary hover:underline">
          {t("energy.bilan.method.tariffLink")}
        </Link>
      </p>
      {prices.items.length > 0 && (
        <ul className="list-disc pl-4.5 flex flex-col gap-0.5">
          {prices.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {data.fee && <p>{t("energy.bilan.method.fee")}</p>}
      <p>{t("energy.bilan.method.rule")}</p>
      {data.usage.length > 0 && <p>{t(`energy.bilan.method.${data.period}`)}</p>}
    </>
  );
}

function MethodCard({ data, locale }: { data: EnergyBilanResponse; locale: string }) {
  const { t } = useTranslation();
  return (
    <>
      <section className="hidden lg:flex card px-7 py-5 flex-col gap-1.5 text-caption text-text-secondary">
        <h2 className="text-small font-semibold text-text">{t("energy.bilan.method.title")}</h2>
        <MethodText data={data} locale={locale} />
      </section>
      <details className="lg:hidden card px-4 py-3.5 text-caption text-text-secondary">
        <summary className="text-small font-semibold text-text cursor-pointer min-h-6">
          {t("energy.bilan.method.title")}
        </summary>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <MethodText data={data} locale={locale} />
        </div>
      </details>
    </>
  );
}

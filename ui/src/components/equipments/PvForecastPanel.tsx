import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { History, RefreshCw, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "../../lib/locale";
import type { PvForecastResponse } from "../../types";
import { backfillPvForecast, getPvForecast, recalibratePvForecast } from "../../api";
import { SolarProfileForm } from "./SolarProfileForm";
import { sumKwh, dailyTicks } from "./pvForecastUtils";

/**
 * Expected PV production (spec 160).
 *
 * Shows the curve to J+5 and the declared peak power next to it. That second
 * part is not decoration: a household that changes its array without updating
 * the declaration gets a forecast that drifts for weeks, and the stale figure
 * has to be visible where it does the damage.
 */

interface PvForecastPanelProps {
  equipmentId: string;
}

export function PvForecastPanel({ equipmentId }: PvForecastPanelProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<PvForecastResponse | null>(null);
  const [busy, setBusy] = useState(false);
  /** How far back the forecast-versus-actual comparison looks, in days. */
  const [accuracyDays, setAccuracyDays] = useState(7);
  const [notice, setNotice] = useState<string | null>(null);

  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getPvForecast(equipmentId, accuracyDays));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [equipmentId, accuracyDays]);

  useEffect(() => {
    void load();
  }, [load]);

  // A transient failure must not silently offer an empty form: saving from it
  // would send an empty declaration and wipe whatever is stored. Say what
  // happened and offer a retry instead.
  if (!data) {
    return failed ? (
      <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
        <p className="text-[13px] text-text-secondary">{t("equipments.pv.loadFailed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 px-3 py-1.5 rounded-[6px] border border-border text-[12px] text-text-secondary hover:border-primary"
        >
          {t("common.retry")}
        </button>
      </div>
    ) : null;
  }

  // Nothing declared: the form is the whole panel. Not an error state — the
  // feature simply has not been set up.
  if (!data.active) {
    return <SolarProfileForm equipmentId={equipmentId} planes={[]} onSaved={load} />;
  }

  const locale = dateLocale(i18n.language);
  const chart = data.curve.map((p) => ({
    ts: Date.parse(p.at),
    watts: p.watts,
  }));

  // FR5 — a curve nobody refreshed must not be drawn like a fresh one.
  const ageHours = data.issuedAt
    ? (Date.now() - Date.parse(data.issuedAt)) / 3_600_000
    : null;
  const stale = ageHours !== null && ageHours > 3;
  const staleHours = ageHours === null ? 0 : Math.round(ageHours);

  const todayKwh = sumKwh(data.curve, 0);
  const tomorrowKwh = sumKwh(data.curve, 1);

  /**
   * Fit from history the installation already holds (spec 161).
   *
   * Offered mainly while there is no model, which is the twelve-day gap this
   * exists to close, but kept available afterwards: it is also how a household
   * rebuilds the fit after correcting the declared array or its date.
   */
  async function backfill(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await backfillPvForecast(equipmentId);
      setNotice(
        res.model
          ? t("equipments.pv.backfilled", { hours: res.hoursPaired })
          : t("equipments.pv.backfilledShort", { hours: res.hoursPaired }),
      );
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function recalibrate(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await recalibratePvForecast(equipmentId);
      setNotice(t("equipments.pv.recalibrated", { gain: res.gain.toFixed(2) }));
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="bg-surface rounded-[10px] border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sun size={16} strokeWidth={1.5} className="text-accent" />
          <h3 className="text-[14px] font-semibold text-text">{t("equipments.pv.title")}</h3>
          <span className="ml-auto text-[11px] text-text-tertiary tabular-nums font-mono">
            {t("equipments.pv.declared", { wc: data.declaredPeakWc })}
          </span>
        </div>

        {/* An empty curve has two very different causes. Waiting for samples
            resolves itself; a missing weather plugin never does, and saying
            "learning" there would leave the household waiting on nothing. */}
        {data.curve.length === 0 && !data.weatherAvailable ? (
          <p className="text-[13px] text-warning">{t("equipments.pv.noWeather")}</p>
        ) : data.model === null && data.curve.length === 0 ? (
          <p className="text-[13px] text-text-secondary">{t("equipments.pv.learning")}</p>
        ) : (
          <>
            <div className="flex gap-6 mb-4">
              <Figure label={t("equipments.pv.today")} value={todayKwh} />
              <Figure label={t("equipments.pv.tomorrow")} value={tomorrowKwh} />
            </div>

            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    // One tick per day. Left to itself Recharts puts a tick
                    // every few of the 144 hourly points, and formatted as
                    // weekday names that reads "Tue Tue Tue Wed Wed Wed".
                    ticks={dailyTicks(chart.map((p) => p.ts))}
                    tickFormatter={(ts: number) =>
                      new Date(ts).toLocaleDateString(locale, { weekday: "short", day: "numeric" })
                    }
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                    stroke="var(--color-border)"
                  />
                  <YAxis
                    // In kW, not W. Four-digit watt labels do not fit the
                    // gutter this chart leaves: at 11px behind a -16px left
                    // margin they were clipped to their last three digits, so a
                    // 3800 W peak read "800" — an axis that looked plausible
                    // and was wrong by an order of magnitude.
                    tickFormatter={(w: number) => (w > 0 ? `${(w / 1000).toFixed(1)} kW` : "0")}
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                    stroke="var(--color-border)"
                    width={56}
                  />
                  <Tooltip
                    labelFormatter={(ts) =>
                      new Date(ts as number).toLocaleString(locale, {
                        weekday: "short",
                        hour: "2-digit",
                      })
                    }
                    formatter={(v) => [`${Math.round(v as number)} W`, t("equipments.pv.expected")]}
                    contentStyle={{
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="watts"
                    stroke="var(--color-accent)"
                    strokeWidth={1.5}
                    fill="url(#pvFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* FR6 — what was promised against what happened. Without it the
                curve is a number to take on faith.
                Always rendered, never hidden when empty: an absent section is
                indistinguishable from an absent feature, and this one is empty
                for a whole day after the array is declared. */}
            <div className="mt-4 pt-3 border-t border-border-light">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[12px] text-text-secondary">
                  {t("equipments.pv.accuracy")}
                </span>
                {data.accuracy.maeW !== null ? (
                  <>
                    <span className="text-[13px] font-semibold font-mono tabular-nums text-text">
                      {t("equipments.pv.accuracyValue", { mae: data.accuracy.maeW })}
                    </span>
                    <span className="text-[11px] text-text-tertiary">
                      {t("equipments.pv.accuracySamples", { n: data.accuracy.samples })}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-text-tertiary">
                    {t("equipments.pv.accuracyPending")}
                  </span>
                )}
                {/* Which line is which. The chart draws two series in two
                    colours and nothing else said so — the question this panel
                    exists to answer is precisely "forecast versus actual". */}
                {data.accuracy.maeW !== null && (
                  <span className="flex items-center gap-3 ml-2">
                    <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                      <span
                        aria-hidden
                        className="inline-block w-3 h-[2px] rounded-full"
                        style={{ background: "var(--color-accent)" }}
                      />
                      {t("equipments.pv.expected")}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-text-secondary">
                      <span
                        aria-hidden
                        className="inline-block w-3 h-[2px] rounded-full"
                        style={{ background: "var(--color-primary)" }}
                      />
                      {t("equipments.pv.actual")}
                    </span>
                  </span>
                )}

                {/* The window. Bounded server-side by how long the measured
                    series is retained, so 90 days is the honest maximum. */}
                <span className="ml-auto flex items-center gap-1">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setAccuracyDays(d)}
                      className={`px-2 py-0.5 rounded-[6px] text-[11px] font-medium border ${
                        accuracyDays === d
                          ? "border-primary bg-primary-light text-primary"
                          : "border-border text-text-secondary hover:border-primary"
                      }`}
                    >
                      {t("equipments.pv.lastDays", { n: d })}
                    </button>
                  ))}
                </span>
              </div>
              {data.accuracy.maeW !== null && (
                <>
                <div className="h-32 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.accuracy.points.map((p) => ({ ...p, ts: Date.parse(p.at) }))}
                      margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        ticks={dailyTicks(data.accuracy.points.map((p) => Date.parse(p.at)))}
                        tickFormatter={(ts: number) =>
                          new Date(ts).toLocaleDateString(locale, {
                            day: "numeric",
                            month: "short",
                          })
                        }
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                        stroke="var(--color-border)"
                      />
                      <YAxis
                        // kW, like the forecast chart above: four-digit watt
                        // labels do not fit this gutter and were clipped to
                        // their last three digits.
                        tickFormatter={(w: number) => (w > 0 ? `${(w / 1000).toFixed(1)} kW` : "0")}
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                        stroke="var(--color-border)"
                        width={56}
                      />
                      <Tooltip
                        labelFormatter={(ts) =>
                          new Date(ts as number).toLocaleString(locale, {
                            weekday: "short",
                            hour: "2-digit",
                          })
                        }
                        contentStyle={{
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="forecastW"
                        name={t("equipments.pv.expected")}
                        stroke="var(--color-accent)"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="actualW"
                        name={t("equipments.pv.actual")}
                        stroke="var(--color-primary)"
                        strokeWidth={1.5}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                </>
              )}
            </div>

            {data.model === null && (
              <p className="mt-3 text-[11px] text-warning">{t("equipments.pv.provisional")}</p>
            )}

            <p className="mt-3 text-[11px] text-text-tertiary">
              {data.model === null
                ? t("equipments.pv.learning")
                : t("equipments.pv.provenance", {
                    samples: data.model.samples,
                    date: new Date(data.model.fittedAt).toLocaleDateString(locale),
                  })}
              {stale && ` — ${t("equipments.pv.stale", { hours: staleHours })}`}
            </p>
          </>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={recalibrate}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-border text-[12px] text-text-secondary hover:border-primary disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={1.5} />
            {t("equipments.pv.recalibrate")}
          </button>
          <button
            type="button"
            onClick={backfill}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-border text-[13px] text-text-secondary hover:border-primary disabled:opacity-50"
          >
            <History size={14} strokeWidth={1.5} />
            {t("equipments.pv.backfill")}
          </button>
          {notice && <span className="text-[12px] text-text-secondary">{notice}</span>}
        </div>
      </div>

      <SolarProfileForm
        equipmentId={equipmentId}
        planes={data.planes}
        since={data.since}
        onSaved={load}
      />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] text-text-tertiary">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-[22px] font-bold font-mono tabular-nums text-text leading-none">
          {value.toFixed(1)}
        </span>
        <span className="text-[12px] text-text-tertiary">kWh</span>
      </div>
    </div>
  );
}

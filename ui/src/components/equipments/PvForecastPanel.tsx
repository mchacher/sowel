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
import { RefreshCw, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PvForecastResponse } from "../../types";
import { getPvForecast, recalibratePvForecast } from "../../api";
import { SolarProfileForm } from "./SolarProfileForm";
import { sumKwh } from "./pvForecastUtils";

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
  const [notice, setNotice] = useState<string | null>(null);

  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getPvForecast(equipmentId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [equipmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A transient failure must not remove the only place an owner can declare or
  // fix their array, so the form stays reachable even with no data.
  if (!data) {
    return failed ? (
      <SolarProfileForm equipmentId={equipmentId} planes={[]} onSaved={load} />
    ) : null;
  }

  // Nothing declared: the form is the whole panel. Not an error state — the
  // feature simply has not been set up.
  if (!data.active) {
    return <SolarProfileForm equipmentId={equipmentId} planes={[]} onSaved={load} />;
  }

  const locale = i18n.language === "fr" ? "fr-FR" : "en-US";
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

        {data.model === null && data.curve.length === 0 ? (
          <p className="text-[13px] text-text-secondary">{t("equipments.pv.learning")}</p>
        ) : (
          <>
            <div className="flex gap-6 mb-4">
              <Figure label={t("equipments.pv.today")} value={todayKwh} />
              <Figure label={t("equipments.pv.tomorrow")} value={tomorrowKwh} />
            </div>

            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
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
                    tickFormatter={(ts: number) =>
                      new Date(ts).toLocaleDateString(locale, { weekday: "short" })
                    }
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                    stroke="var(--color-border)"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                    stroke="var(--color-border)"
                    width={44}
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
                curve is a number to take on faith. */}
            {data.accuracy.maeW !== null && (
              <div className="mt-4 pt-3 border-t border-border-light">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] text-text-secondary">
                    {t("equipments.pv.accuracy")}
                  </span>
                  <span className="text-[13px] font-semibold font-mono tabular-nums text-text">
                    {t("equipments.pv.accuracyValue", { mae: data.accuracy.maeW })}
                  </span>
                  <span className="text-[11px] text-text-tertiary">
                    {t("equipments.pv.accuracySamples", { n: data.accuracy.samples })}
                  </span>
                </div>
                <div className="h-32 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.accuracy.points.map((p) => ({ ...p, ts: Date.parse(p.at) }))}
                      margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                      <XAxis
                        dataKey="ts"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(ts: number) =>
                          new Date(ts).toLocaleDateString(locale, { weekday: "short" })
                        }
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                        stroke="var(--color-border)"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                        stroke="var(--color-border)"
                        width={44}
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
              </div>
            )}

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
          {notice && <span className="text-[12px] text-text-secondary">{notice}</span>}
        </div>
      </div>

      <SolarProfileForm equipmentId={equipmentId} planes={data.planes} onSaved={load} />
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

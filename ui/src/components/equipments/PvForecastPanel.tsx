import {
  CHART_TICK_FONT,
  CHART_TOOLTIP_FONT,
  CHART_TOOLTIP_ITEM_STYLE,
} from "../../lib/chart-font";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { dateLocale } from "../../lib/locale";
import {
  formatEnergy,
  formatEnergyParts,
  formatPercent,
  formatPower,
  formatWithUnit,
} from "../../lib/format";
import { useAuth } from "../../store/useAuth";
import type { PvForecastResponse } from "../../types";
import { getPvForecast } from "../../api";
import { sumKwh, dailyTicks, mergeTimeline } from "./pvForecastUtils";
import { SegmentedControl } from "../ui/SegmentedControl";

/**
 * Expected PV production (spec 160), monitoring only since spec 163: the
 * declaration form and the backfill action live in Settings -> Energy
 * (`SolarInstallationSettings`), and this panel renders nothing at all for an
 * undeclared array — the hosting page decides what that case shows.
 *
 * Shows the curve to J+5 and the declared peak power next to it. That second
 * part is not decoration: a household that changes its array without updating
 * the declaration gets a forecast that drifts for weeks, and the stale figure
 * has to be visible where it does the damage — for admins it links to the
 * settings section where the declaration is corrected.
 */

/**
 * The two lines (spec 197, FR-E6.3). « Attendu » is a prediction, so it is
 * drawn as one: a dashed neutral line with no fill. « Réalisé » is solar
 * production, the same green as the bars of the chart above it. Amber (#1126)
 * and the primary ink both said something else.
 */
const EXPECTED_COLOR = "var(--color-text-tertiary)";
const EXPECTED_DASH = "4 3";
const ACTUAL_COLOR = "var(--color-solar-production)";

/** The window chips, in days. */
const WINDOWS = [1, 3, 7, 30, 90] as const;

interface PvForecastPanelProps {
  equipmentId: string;
  /**
   * Called with each response, so the Production page can read today's
   * forecast without fetching it a second time (spec 197). Keep it stable.
   */
  onLoaded?: (equipmentId: string, data: PvForecastResponse) => void;
}

export function PvForecastPanel({ equipmentId, onLoaded }: PvForecastPanelProps) {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const [data, setData] = useState<PvForecastResponse | null>(null);
  /**
   * How wide the chart window is, in days. A zoom, not the score's sample: the
   * server floors the accuracy window at a week whatever is asked here (#907),
   * so looking at one day does not blank the figure.
   *
   * Three days by default: a week of hourly points is a picket fence, and the
   * daily shape is what this panel is read for.
   */
  const [accuracyDays, setAccuracyDays] = useState(3);

  const [failed, setFailed] = useState(false);
  /**
   * When the data was fetched. The render splits the timeline at "now" and
   * ages the weather curve against it; reading the clock during render is
   * impure (react-hooks/purity), and the fetch time is the honest reference
   * anyway — it is the moment the drawn data describes.
   */
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await getPvForecast(equipmentId, accuracyDays);
      setData(response);
      setLoadedAt(Date.now());
      setFailed(false);
      onLoaded?.(equipmentId, response);
    } catch {
      setFailed(true);
    }
  }, [equipmentId, accuracyDays, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  // A transient failure is said out loud with a retry, never rendered as an
  // absent panel: silence here would read as "nothing declared".
  if (!data) {
    return failed ? (
      <div className="card mb-6 p-4 sm:p-6">
        <p className="text-small text-text-secondary">{t("equipments.pv.loadFailed")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 px-3 py-1.5 rounded-sm border border-border text-caption text-text-secondary hover:border-primary"
        >
          {t("common.retry")}
        </button>
      </div>
    ) : null;
  }

  // Nothing declared: not this panel's story to tell. The Production page
  // shows admins a pointer to Settings -> Energy; everywhere else the panel
  // simply is not there.
  if (!data.active) {
    return null;
  }

  const locale = dateLocale(i18n.language);
  const now = loadedAt;
  // One timeline. Past hours carry what was promised for them, future hours the
  // current curve; see `mergeTimeline`.
  // The forward side is trimmed to the selected window on the short zooms only:
  // at 7 days and beyond the curve's own J+5 horizon is already the shorter of
  // the two, so capping changes nothing.
  const chart = mergeTimeline(
    data.accuracy.points,
    data.curve,
    now,
    data.accuracy.measured,
    accuracyDays,
  );
  const spanDays = chart.length > 1 ? (chart[chart.length - 1].ts - chart[0].ts) / 86_400_000 : 0;
  // A weekday name stops helping once the span passes a fortnight.
  const tickFormat: Intl.DateTimeFormatOptions =
    spanDays > 14 ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" };

  // FR5 — a curve nobody refreshed must not be drawn like a fresh one.
  const ageHours = data.issuedAt ? (loadedAt - Date.parse(data.issuedAt)) / 3_600_000 : null;
  const stale = ageHours !== null && ageHours > 3;
  const staleHours = ageHours === null ? 0 : Math.round(ageHours);

  const todayKwh = sumKwh(data.curve, 0);
  const tomorrowKwh = sumKwh(data.curve, 1);

  return (
    // Spec 197 (FR-E6.6) — the energy cards' padding, no heading icon.
    <div className="card mb-6 p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-body font-semibold text-text">{t("equipments.pv.title")}</h3>
        {/* The stale-declaration tell. For admins it is also the way to fix
            it: the same figure, linking to the section that edits it. */}
        {isAdmin ? (
          <Link
            to="/settings?tab=energy"
            className="ml-auto text-micro text-text-tertiary tabular-nums hover:text-primary hover:underline"
          >
            {t("equipments.pv.declared", {
              wc: formatWithUnit(data.declaredPeakWc, "Wc", { locale }),
            })}
          </Link>
        ) : (
          <span className="ml-auto text-micro text-text-tertiary tabular-nums">
            {t("equipments.pv.declared", {
              wc: formatWithUnit(data.declaredPeakWc, "Wc", { locale }),
            })}
          </span>
        )}
      </div>

      {/* An empty curve has two very different causes. Waiting for samples
            resolves itself; a missing weather plugin never does, and saying
            "learning" there would leave the household waiting on nothing. */}
      {data.curve.length === 0 && !data.weatherAvailable ? (
        <p className="text-small text-warning-ink">{t("equipments.pv.noWeather")}</p>
      ) : data.model === null && data.curve.length === 0 ? (
        <p className="text-small text-text-secondary">{t("equipments.pv.learning")}</p>
      ) : (
        <>
          <div className="flex gap-6 mb-4">
            <Figure label={t("equipments.pv.today")} value={todayKwh} />
            <Figure label={t("equipments.pv.tomorrow")} value={tomorrowKwh} />
          </div>

          {/* Is today on track. The aggregate score cannot say — it only
                counts finished days — and the running day compared against a
                whole day's forecast would read as a collapse, so both sides
                are summed over the hours that have actually happened (#907). */}
          {/* Gated on production, not on hours: `hours > 0` held from the
                first paired hour after midnight, so the line sat at "0.0 kWh
                forecast, 0.0 kWh measured" all night with a dangling delta. */}
          {data.accuracy.today !== null &&
            (data.accuracy.today.forecastWh > 0 || data.accuracy.today.actualWh > 0) && (
              <p className="text-caption text-text-tertiary mb-3">
                {t("equipments.pv.todaySoFar", {
                  expected: formatEnergy(data.accuracy.today.forecastWh / 1000, { locale }),
                  measured: formatEnergy(data.accuracy.today.actualWh / 1000, { locale }),
                  count: data.accuracy.today.hours,
                })}{" "}
                <span
                  className={`tabular-nums ${
                    data.accuracy.today.actualWh >= data.accuracy.today.forecastWh
                      ? "text-success"
                      : "text-text-secondary"
                  }`}
                >
                  {formatDelta(data.accuracy.today, locale)}
                </span>
              </p>
            )}

          {/* One chart, not two. The comparison and the forecast are the
                same quantity in the same unit on adjacent stretches of time;
                split apart, the reader had to join them up by eye. */}
          <div className="flex items-baseline gap-2 flex-wrap mb-2">
            <span className="text-caption text-text-secondary">{t("equipments.pv.accuracy")}</span>
            {data.accuracy.dailyMaeWh !== null ? (
              <>
                <span className="text-small font-semibold tabular-nums text-text">
                  {/* No percentage when nothing was produced to take a share
                        of: `?? 0` printed "(0%)" over a real error, so a dead
                        inverter under a live forecast read as a perfect score
                        at the one moment the figure has to shout. */}
                  {data.accuracy.dailyMaePct !== null
                    ? t("equipments.pv.accuracyValue", {
                        energy: formatEnergy(data.accuracy.dailyMaeWh / 1000, { locale }),
                        pct: formatPercent(data.accuracy.dailyMaePct, { decimals: 1, locale }),
                      })
                    : t("equipments.pv.accuracyValueNoPct", {
                        energy: formatEnergy(data.accuracy.dailyMaeWh / 1000, { locale }),
                      })}
                </span>
                <span className="text-micro text-text-tertiary">
                  {t("equipments.pv.accuracySamples", { count: data.accuracy.dailyDays })}
                </span>
              </>
            ) : (
              <span className="text-caption text-text-tertiary">
                {t("equipments.pv.accuracyPending")}
              </span>
            )}

            {/* Which line is which. Two series in two colours and nothing
                  else saying so is the question this panel exists to answer. */}
            <span className="flex items-center gap-3 ml-2">
              <span className="flex items-center gap-1 text-micro text-text-secondary">
                <LineKey color={EXPECTED_COLOR} width={1.5} dash={EXPECTED_DASH} />
                {t("equipments.pv.expected")}
              </span>
              {chart.some((p) => p.actualW !== undefined) && (
                <span className="flex items-center gap-1 text-micro text-text-secondary">
                  <LineKey color={ACTUAL_COLOR} width={2} />
                  {t("equipments.pv.actual")}
                </span>
              )}
            </span>

            {/* How far back. Bounded server-side by how long the measured
                  series is retained, so 90 days is the honest maximum. */}
            <SegmentedControl
              options={WINDOWS.map((d) => ({
                value: d,
                label: t("equipments.pv.lastDays", { n: d }),
              }))}
              value={accuracyDays}
              onChange={setAccuracyDays}
              label={t("equipments.pv.window")}
              className="ml-auto"
            />
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  // One tick per local day, thinned on a long window. Left to
                  // itself Recharts put one every few hourly points, and
                  // formatted as weekday names that read "Tue Tue Tue Wed".
                  ticks={dailyTicks(chart.map((p) => p.ts))}
                  tickFormatter={(ts: number) =>
                    new Date(ts).toLocaleDateString(locale, tickFormat)
                  }
                  tick={{ fontSize: CHART_TICK_FONT, fill: "var(--color-text-tertiary)" }}
                  stroke="var(--color-border)"
                />
                <YAxis
                  // kW, not W: four-digit watt labels do not fit this gutter
                  // and were clipped to their last three digits, so a 3800 W
                  // peak read "800".
                  tickFormatter={(w: number) =>
                    w > 0 ? formatPower(w, { unit: "kW", locale }) : "0"
                  }
                  tick={{ fontSize: CHART_TICK_FONT, fill: "var(--color-text-tertiary)" }}
                  stroke="var(--color-border)"
                  width={56}
                />
                <Tooltip
                  labelFormatter={(ts) =>
                    new Date(ts as number).toLocaleString(locale, {
                      weekday: "short",
                      day: "numeric",
                      hour: "2-digit",
                    })
                  }
                  formatter={(v, name) => [formatPower(v as number, { unit: "W", locale }), name]}
                  itemStyle={CHART_TOOLTIP_ITEM_STYLE}
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    fontSize: CHART_TOOLTIP_FONT,
                  }}
                />
                {/* Where the record stops and the promise starts. */}
                <ReferenceLine
                  x={now}
                  stroke="var(--color-text-tertiary)"
                  strokeDasharray="2 3"
                  label={{
                    value: t("equipments.pv.now"),
                    position: "insideTopRight",
                    fontSize: CHART_TICK_FONT,
                    fill: "var(--color-text-tertiary)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="forecastW"
                  name={t("equipments.pv.expected")}
                  stroke={EXPECTED_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray={EXPECTED_DASH}
                  dot={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="actualW"
                  name={t("equipments.pv.actual")}
                  stroke={ACTUAL_COLOR}
                  strokeWidth={2}
                  dot={false}
                  // Not connected: a gap is an hour the meter did not report,
                  // and drawing straight through it would invent production.
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {data.model === null && (
            <p className="mt-3 text-caption text-warning-ink">{t("equipments.pv.provisional")}</p>
          )}

          <p className="mt-3 text-caption text-text-tertiary">
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
    </div>
  );
}

/**
 * How far today is running from what was expected for the same hours, as a
 * signed percentage. Percent, not watt-hours: at 9am a 300 Wh gap means
 * something quite different than it does at 7pm, and the share does not.
 */
function formatDelta(today: { forecastWh: number; actualWh: number }, locale: string): string {
  if (today.forecastWh <= 0) return "";
  const pct = (100 * (today.actualWh - today.forecastWh)) / today.forecastWh;
  return formatPercent(pct, { signed: true, locale });
}

function Figure({ label, value }: { label: string; value: number }) {
  const energy = formatEnergyParts(value);
  return (
    <div>
      <div className="text-micro text-text-tertiary">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-title font-semibold tabular-nums text-text leading-none">
          {energy.value}
        </span>
        <span className="text-caption text-text-tertiary">{energy.unit}</span>
      </div>
    </div>
  );
}

/** A legend key drawn like the line it names: same stroke, width and dash. */
function LineKey({ color, width, dash }: { color: string; width: number; dash?: string }) {
  return (
    <svg aria-hidden width="14" height="4" className="shrink-0">
      <line
        x1="0"
        y1="2"
        x2="14"
        y2="2"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="butt"
      />
    </svg>
  );
}

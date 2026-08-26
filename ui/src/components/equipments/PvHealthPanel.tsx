import { memo, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getPvHealth, type PvHealthResponse } from "../../api";
import { dateLocale } from "../../lib/locale";
import { dailyTicks } from "./pvForecastUtils";
import { localDayToDate } from "../../lib/local-date";
import { loadWithRetry } from "../../lib/load-with-retry";

/**
 * Is the array still performing? (spec 162)
 *
 * One number a day — what the panels produced over what the sun offered them —
 * against its own recent normal. Not an absolute figure: the ratio carries a
 * scale that cancels only in the comparison, which is why the normal is drawn
 * rather than a target line.
 *
 * The card is deliberately explicit about two things it cannot do: it says how
 * fast a fault would show *at the rate this installation is actually getting
 * clear days*, and it says it cannot name a panel.
 */
export const PvHealthPanel = memo(function PvHealthPanel({
  equipmentId,
}: {
  equipmentId: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const [data, setData] = useState<PvHealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // loadWithRetry rather than a bare fetch: this card loads on every visit to
    // the page, and a single 429 or the 401 burst of a token refresh would
    // otherwise blank it for the whole visit — even while an alert is standing.
    let cancelled = false;
    void (async () => {
      const outcome = await loadWithRetry(() => getPvHealth(equipmentId), {
        retryDelaysMs: [1000, 3000],
        isCurrent: () => !cancelled,
      });
      if (outcome.status === "ok") {
        setData(outcome.value);
        setFailed(false);
      } else if (outcome.status === "failed") {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [equipmentId]);

  // Memoised: the detail page re-renders on every WebSocket equipment update,
  // several times a minute on a live production meter, and rebuilding a
  // 120-point array with fresh identity forced Recharts through a full
  // reconciliation each time.
  const chart = useMemo(
    () =>
      (data?.days ?? []).map((d) => ({
        ts: localDayToDate(d.day).getTime(),
        ratio: d.ratio,
        hours: d.hours,
      })),
    [data],
  );
  const ticks = useMemo(() => dailyTicks(chart.map((p) => p.ts)), [chart]);

  // Display anchor while the reference is still building (#724): the 80th
  // centile of the days accumulated so far. Display-only — the rules' own
  // reference stays server-side; this just lets the building chart read in
  // "percent of what looks usual so far" instead of a unit-less ratio.
  const provisional = useMemo(() => {
    if (chart.length === 0) return null;
    const sorted = chart.map((p) => p.ratio).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(0.8 * sorted.length))];
  }, [chart]);

  if (failed || !data) return null;

  // FR6 — no declared array means the feature is silent. Rendering the waiting
  // card here promised clear hours that can never come: nothing is collected
  // without a declaration, and the card could never progress.
  if (!data.active) return null;

  // Nothing has qualified yet. Say what the detector is waiting for rather than
  // rendering an empty chart that looks broken.
  if (data.days.length === 0) {
    return (
      <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
        <Header t={t} />
        <p className="text-[13px] text-text-secondary">{t("equipments.pvHealth.waiting")}</p>
      </div>
    );
  }

  // Days exist but the reference does not yet: say exactly where it stands and
  // show the days it has (#724). A generic waiting line here read as "your
  // history is being ignored" to a household that just backfilled a year of
  // production — the wait is the capacity-change reset doing its job, and the
  // card has to say so.
  if (data.normal === null) {
    return (
      <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
        <Header t={t} />
        <p className="text-[13px] text-text-secondary mb-3">
          {data.sinceCutoff
            ? t("equipments.pvHealth.building", {
                have: data.days.length,
                need: data.normalTarget,
                date: localDayToDate(data.sinceCutoff).toLocaleDateString(locale, {
                  day: "numeric",
                  month: "long",
                }),
              })
            : t("equipments.pvHealth.buildingNoDate", {
                have: data.days.length,
                need: data.normalTarget,
              })}
        </p>
        {provisional !== null && (
          <RatioChart chart={chart} ticks={ticks} anchor={provisional} locale={locale} t={t} />
        )}
      </div>
    );
  }

  // A spell of overcast leaves plenty of history and no recent judgement. Said
  // out loud, because the alternative is a card that looks current while its
  // newest figure is weeks old. `detection` is null exactly when no day
  // qualified in the observation fortnight.
  const blind = data.detection === null;


  const normal = data.normal;
  const latest = data.latest;
  const deviation = latest ? (latest.ratio / normal - 1) * 100 : null;

  return (
    <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
      <Header t={t} />

      {data.alert ? (
        <div className="flex items-start gap-2 mb-3 p-3 rounded-[8px] bg-warning/10 border border-warning/30">
          <AlertTriangle size={16} strokeWidth={1.5} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-[13px] text-text">
            {t("equipments.pvHealth.alert", {
              pct: Math.round(data.alert.deficit * 100),
              since: localDayToDate(data.alert.since).toLocaleDateString(locale, {
                day: "numeric",
                month: "long",
              }),
            })}
          </p>
        </div>
      ) : blind ? (
        <p className="text-[13px] text-text-secondary mb-3">{t("equipments.pvHealth.blind")}</p>
      ) : (
        <p className="text-[13px] text-text-secondary mb-3">
          {t("equipments.pvHealth.normal", {
            date: latest ? localDayToDate(latest.day).toLocaleDateString(locale) : "",
            pct: deviation === null ? 0 : Math.abs(Math.round(deviation)),
            direction: t(
              deviation !== null && deviation < 0
                ? "equipments.pvHealth.below"
                : "equipments.pvHealth.above",
            ),
          })}
        </p>
      )}

      <RatioChart chart={chart} ticks={ticks} anchor={normal} showReference locale={locale} t={t} />

      {/* What the detector can and cannot do, from the days it has actually had. */}
      {data.detection && (
        <p className="mt-3 text-[11px] text-text-tertiary">
          {t("equipments.pvHealth.speed", {
            clear: data.detection.qualifyingDays,
            window: data.detection.windowDays,
            pct: Math.round(data.detection.minDetectableLoss * 100),
            days: data.detection.calendarDays,
          })}
        </p>
      )}
      <p className="mt-1 text-[11px] text-text-tertiary">{t("equipments.pvHealth.noPanelId")}</p>
    </div>
  );
});

function Header({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Activity size={16} strokeWidth={1.5} className="text-accent" />
      <h3 className="text-[14px] font-semibold text-text">{t("equipments.pvHealth.title")}</h3>
    </div>
  );
}

/**
 * The ratio series, read in percent of `anchor` — the established normal, or
 * the provisional centile while the reference is still building. The dashed
 * reference line is drawn only for an established normal: drawing it on the
 * provisional anchor would present a figure still under construction as a
 * standard the array is being held to.
 */
function RatioChart({
  chart,
  ticks,
  anchor,
  showReference = false,
  locale,
  t,
}: {
  chart: { ts: number; ratio: number; hours: number }[];
  ticks: number[];
  anchor: number;
  showReference?: boolean;
  locale: string;
  t: (k: string) => string;
}) {
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={(ts: number) =>
              new Date(ts).toLocaleDateString(locale, { day: "numeric", month: "short" })
            }
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            stroke="var(--color-border)"
          />
          <YAxis
            // Relative to the anchor, because the ratio's own scale means
            // nothing to a household. 100 % is "as usual".
            tickFormatter={(r: number) => `${Math.round((r / anchor) * 100)} %`}
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            stroke="var(--color-border)"
            width={48}
          />
          <Tooltip
            labelFormatter={(ts) => new Date(ts as number).toLocaleDateString(locale)}
            formatter={(v) => [
              `${Math.round(((v as number) / anchor) * 100)} %`,
              t("equipments.pvHealth.ofNormal"),
            ]}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          {showReference && (
            <ReferenceLine y={anchor} stroke="var(--color-text-tertiary)" strokeDasharray="2 3" />
          )}
          <Line
            type="monotone"
            dataKey="ratio"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
            dot={{ r: 2 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

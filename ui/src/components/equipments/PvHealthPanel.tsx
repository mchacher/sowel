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

  if (failed || !data) return null;

  // FR6 — no declared array means the feature is silent. Rendering the waiting
  // card here promised clear hours that can never come: nothing is collected
  // without a declaration, and the card could never progress.
  if (!data.active) return null;

  // Nothing has qualified yet. Say what the detector is waiting for rather than
  // rendering an empty chart that looks broken.
  if (data.days.length === 0 || data.normal === null) {
    return (
      <div className="mb-6 bg-surface rounded-[10px] border border-border p-4">
        <Header t={t} />
        <p className="text-[13px] text-text-secondary">{t("equipments.pvHealth.waiting")}</p>
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
              // Relative to the normal, because the ratio's own scale means
              // nothing to a household. 100 % is "as usual".
              tickFormatter={(r: number) => `${Math.round((r / normal) * 100)} %`}
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
              stroke="var(--color-border)"
              width={48}
            />
            <Tooltip
              labelFormatter={(ts) => new Date(ts as number).toLocaleDateString(locale)}
              formatter={(v) => [
                `${Math.round(((v as number) / normal) * 100)} %`,
                t("equipments.pvHealth.ofNormal"),
              ]}
              contentStyle={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <ReferenceLine y={normal} stroke="var(--color-text-tertiary)" strokeDasharray="2 3" />
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

import { useEffect, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getPvHealth, type PvHealthResponse } from "../../api";
import { dateLocale } from "../../lib/locale";
import { dailyTicks } from "./pvForecastUtils";

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
export function PvHealthPanel({ equipmentId }: { equipmentId: string }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const [data, setData] = useState<PvHealthResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The async boundary is opened inside the effect, and the result is dropped
    // if the card went away while the request was in flight.
    let cancelled = false;
    void (async () => {
      try {
        const next = await getPvHealth(equipmentId);
        if (cancelled) return;
        setData(next);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [equipmentId]);

  if (failed || !data) return null;

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

  const chart = data.days.map((d) => ({ ts: Date.parse(d.day), ratio: d.ratio, hours: d.hours }));
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
              since: new Date(data.alert.since).toLocaleDateString(locale, {
                day: "numeric",
                month: "long",
              }),
            })}
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-text-secondary mb-3">
          {t("equipments.pvHealth.normal", {
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
              ticks={dailyTicks(chart.map((p) => p.ts))}
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
            inverter: Number.isFinite(data.detection.oneInverterDays)
              ? data.detection.oneInverterDays
              : "-",
            panel: Number.isFinite(data.detection.onePanelDays)
              ? data.detection.onePanelDays
              : "-",
          })}
        </p>
      )}
      <p className="mt-1 text-[11px] text-text-tertiary">{t("equipments.pvHealth.noPanelId")}</p>
    </div>
  );
}

function Header({ t }: { t: (k: string) => string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Activity size={16} strokeWidth={1.5} className="text-accent" />
      <h3 className="text-[14px] font-semibold text-text">{t("equipments.pvHealth.title")}</h3>
    </div>
  );
}

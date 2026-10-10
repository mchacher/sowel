import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CloudRain } from "lucide-react";
import type { EquipmentWithDetails, HistoryPoint } from "../../types";
import { getHistoryData } from "../../api";
import { dateLocale } from "../../lib/locale";
import { useTimezone } from "../../store/useTimezone";
import { getBatteryColor, getBatteryIcon } from "../equipments/sensorUtils";
import {
  formatMm,
  rainHeadline,
  rainHistoryFrom,
  readRainLive,
  summarizeRainHistory,
  RAIN_LOOKBACK_MONTHS,
  type RainDay,
  type RainSummary,
} from "../equipments/rain-summary";

// Spec 186 — tile body and detail sheet of a rain-only weather equipment.

/**
 * The pulsing dot shown while it rained during the last hour. It says so to
 * screen readers, unless the text next to it already does (`decorative`).
 */
export function RainingDot({ decorative = false }: { decorative?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex shrink-0">
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
      />
      {!decorative && <span className="sr-only">{t("weather.rainFalling")}</span>}
    </span>
  );
}

/**
 * Line under the headline, desktop tile and mobile card alike: the rolling
 * 24 h total when the headline is today's rain, else "Raining" while it rains.
 */
export function RainLine({
  equipment,
  className,
}: {
  equipment: EquipmentWithDetails;
  className: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const { live, hasToday, raining } = rainHeadline(equipment);
  const over24h = hasToday && live.last24h !== null;
  if (!over24h && !raining) return null;
  return (
    <span className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      {raining && <RainingDot decorative={!over24h} />}
      <span className="truncate">
        {over24h
          ? t("weather.rainOver24h", { value: formatMm(live.last24h, locale) })
          : t("weather.rainFalling")}
      </span>
    </span>
  );
}

/** Desktop tile content (the WidgetCard shell is the caller's). */
export function RainTileBody({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const { hasToday, value } = rainHeadline(equipment);
  return (
    <div className="flex flex-col items-center justify-center gap-1 flex-1 min-h-0">
      <span className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
        {hasToday ? t("weather.today") : t("weather.rain24hShort")}
      </span>
      <div className="flex items-baseline leading-none">
        <span className="font-mono font-bold text-[32px] sm:text-[36px] text-text tabular-nums leading-none">
          {formatMm(value, locale)}
        </span>
        <span className="text-text-tertiary font-medium text-[14px] sm:text-[16px] leading-none ml-1">
          mm
        </span>
      </div>
      <RainLine equipment={equipment} className="max-w-full text-[12px] text-text-secondary" />
    </div>
  );
}

/**
 * Mobile card headline, in its icon slot. The card scales that slot to 50%,
 * hence the doubled sizes.
 */
export function RainMobileHeadline({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const { hasToday, value } = rainHeadline(equipment);
  return (
    <div className="flex flex-col items-center gap-1 leading-none whitespace-nowrap">
      <span className="text-[18px] uppercase tracking-wide text-text-tertiary font-medium">
        {hasToday ? t("weather.todayShort") : t("weather.rain24hShort")}
      </span>
      <span className="font-mono font-bold text-[56px] text-text tabular-nums leading-none">
        {formatMm(value, locale)}
        <span className="text-text-tertiary font-medium text-[28px] ml-1">mm</span>
      </span>
    </div>
  );
}

type HistoryState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; points: HistoryPoint[] };

function useRainHistory(equipmentId: string, alias: string | null): HistoryState {
  const [state, setState] = useState<HistoryState>(() =>
    alias ? { status: "loading" } : { status: "none" },
  );
  useEffect(() => {
    if (!alias) {
      setState({ status: "none" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const now = new Date();
    getHistoryData(equipmentId, alias, {
      from: rainHistoryFrom(now).toISOString(),
      to: now.toISOString(),
      aggregation: "1d",
    })
      .then((res) => {
        if (!cancelled) setState({ status: "ready", points: res.points });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [equipmentId, alias]);
  return state;
}

function dayLabel(date: Date, daysAgo: number, locale: string, t: TFunction): string {
  if (daysAgo === 0) return t("weather.today");
  if (daysAgo === 1) return t("weather.rainYesterday");
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-[8px] bg-border-light/40 px-3 py-2">
      <div className="text-[12px] text-text-secondary">{label}</div>
      <div className="font-mono font-bold text-[20px] text-text tabular-nums leading-tight">
        {value}
        {value !== "—" && value !== "…" && (
          <span className="text-text-tertiary font-normal text-[12px] ml-1">mm</span>
        )}
      </div>
      {note && <div className="text-[11px] text-warning">{note}</div>}
    </div>
  );
}

function RainBars({ bars, locale, t }: { bars: RainDay[]; locale: string; t: TFunction }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.mm ?? 0));
  const last = bars.length - 1;
  const describe = (i: number) =>
    t("weather.rainDayValue", {
      day: dayLabel(bars[i].date, last - i, locale, t),
      value:
        bars[i].mm === null ? t("weather.rainNotMeasured") : `${formatMm(bars[i].mm, locale)} mm`,
    });
  return (
    <div>
      <div className="flex items-end gap-[2px] h-14 border-b border-border">
        {bars.map((b, i) => {
          const mm = b.mm;
          const height = mm ? Math.max(4, (mm / max) * 100) : 0;
          return (
            <button
              key={b.key}
              type="button"
              aria-label={describe(i)}
              onMouseEnter={() => setPicked(i)}
              onFocus={() => setPicked(i)}
              onClick={() => setPicked(i)}
              className="flex-1 h-full flex items-end cursor-pointer"
            >
              <span
                className={`w-full rounded-t-[2px] ${
                  mm === null
                    ? "border-b border-dashed border-border"
                    : mm === 0
                      ? "bg-border h-px"
                      : "bg-primary"
                } ${picked === i && mm !== null ? "outline outline-2 outline-primary" : ""}`}
                style={mm ? { height: `${height}%` } : undefined}
              />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-text-tertiary mt-1">
        <span>{dayLabel(bars[0].date, last, locale, t)}</span>
        <span>{t("weather.today")}</span>
      </div>
      <div className="text-[12px] text-text-secondary text-center min-h-[18px] mt-1">
        {picked !== null && describe(picked)}
      </div>
    </div>
  );
}

export function RainDetailContent({ equipment }: { equipment: EquipmentWithDetails }) {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const live = readRainLive(equipment);
  const history = useRainHistory(equipment.id, live.historyAlias);
  // Days are cut in the house's zone, like the server cuts them; the viewer's until it is known.
  const timeZone = useTimezone((s) => (s.loaded ? s.tz : undefined));
  // The live total is ahead of the hourly history (the current hour is not in
  // it yet): it takes today's slot, so every figure below agrees with "Today".
  const summary: RainSummary | null = useMemo(
    () =>
      history.status === "ready"
        ? summarizeRainHistory(history.points, new Date(), {
            liveToday: live.today,
            liveTodayAt: live.todayAt,
            timeZone,
          })
        : null,
    [history, live.today, live.todayAt, timeZone],
  );

  const pending = history.status === "loading" ? "…" : "—";
  const partial = (measured: number, days: number) =>
    summary && measured > 0 && measured < days
      ? t("weather.rainPartial", { count: measured })
      : null;
  // The summary has already weighed the live total against the history (stale, lower).
  const today = summary ? summary.today : live.today;

  let lastRainText: string;
  let lastRainValue = "—";
  if (!summary) {
    lastRainText = pending;
  } else if (!summary.lastRain) {
    lastRainText = summary.empty
      ? "—"
      : summary.since
        ? t("weather.rainNoneSince", {
            date: summary.since.toLocaleDateString(locale, { day: "numeric", month: "short" }),
          })
        : t("weather.rainNone", { months: RAIN_LOOKBACK_MONTHS });
  } else {
    const { date, daysAgo, mm } = summary.lastRain;
    lastRainText = dayLabel(date, daysAgo, locale, t);
    if (daysAgo >= 2) lastRainText += ` · ${t("weather.rainDaysAgo", { count: daysAgo })}`;
    lastRainValue = formatMm(mm, locale);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-center">
        <div className="w-12 h-12 rounded-[10px] flex items-center justify-center bg-primary-light text-primary">
          <CloudRain size={28} strokeWidth={1.5} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label={t("weather.today")}
          value={today !== null ? formatMm(today, locale) : pending}
        />
        <Stat label={t("weather.rainRolling24h")} value={formatMm(live.last24h, locale)} />
        <Stat
          label={t("weather.rain7d")}
          value={summary ? formatMm(summary.sum7, locale) : pending}
          note={summary && partial(summary.measured7, 7)}
        />
        <Stat
          label={t("weather.rain30d")}
          value={summary ? formatMm(summary.sum30, locale) : pending}
          note={summary && partial(summary.measured30, 30)}
        />
      </div>
      <div className="rounded-[8px] bg-primary-light px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] text-text-secondary">{t("weather.rainLast")}</div>
          <div className="text-[14px] font-semibold text-text truncate">{lastRainText}</div>
        </div>
        <div className="font-mono font-bold text-[20px] text-text tabular-nums whitespace-nowrap">
          {lastRainValue}
          {lastRainValue !== "—" && (
            <span className="text-text-tertiary font-normal text-[12px] ml-1">mm</span>
          )}
        </div>
      </div>
      {summary && <RainBars bars={summary.bars} locale={locale} t={t} />}
      {history.status === "error" && (
        <div className="text-[12px] text-text-tertiary text-center">
          {t("weather.rainHistoryError")}
        </div>
      )}
      {live.battery !== null && (
        <div
          className={`flex items-center justify-center gap-1 text-[12px] ${getBatteryColor(live.battery)}`}
        >
          {getBatteryIcon(live.battery, 13, 1.5)}
          <span className="tabular-nums">{live.battery}%</span>
        </div>
      )}
    </div>
  );
}

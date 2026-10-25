import { useTranslation } from "react-i18next";
import { useTimezone } from "../../store/useTimezone";
import { dateLocale } from "../../lib/locale";
import type { SharedAccessTimeWindow } from "../../types";
import { windowDays } from "../../lib/shared-access-period";

/**
 * Dates as the house reads them (`home.timezone`), in the viewer's language:
 * « 3 oct. 16:00 ». « Tout le temps » and « Toute la journée » show no date
 * and no hour at all (R3.10).
 */
export function useSaFormat() {
  const { t, i18n } = useTranslation();
  const tz = useTimezone((s) => s.tz);
  const locale = dateLocale(i18n.language);

  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      timeZone: tz,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

  const period = (from: string | null, until: string | null): string => {
    if (from && until) return t("sharedAccess.line.fromTo", { from: dateTime(from), until: dateTime(until) });
    if (from) return t("sharedAccess.line.fromOnly", { from: dateTime(from) });
    if (until) return t("sharedAccess.line.untilOnly", { until: dateTime(until) });
    return t("sharedAccess.validity.always");
  };

  // ISO weekday → its name; 1 January 2024 was a Monday.
  const dayName = (d: number, style: "long" | "short" | "narrow" = "long"): string =>
    new Intl.DateTimeFormat(locale, { weekday: style, timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, d)),
    );

  /** « ven. » · « lun.–ven. » · « lun., mer. » — empty when it is every day. */
  const shortDays = (w: SharedAccessTimeWindow): string => {
    const d = windowDays(w);
    if (d.length === 7 || d.length === 0) return "";
    const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return run
      ? `${dayName(d[0], "short")}–${dayName(d[d.length - 1], "short")} `
      : `${d.map((x) => dayName(x, "short")).join(", ")} `;
  };

  /** « Tous les vendredis » · « Du lundi au vendredi » · « Les lundis et jeudis ». */
  const daysSentence = (w: SharedAccessTimeWindow): string => {
    const d = windowDays(w);
    if (d.length === 7) return t("sharedAccess.validity.allDays");
    if (d.length === 0) return t("sharedAccess.check.noDayShort");
    if (d.length === 1) {
      return t("sharedAccess.validity.daysOne", { p: `${dayName(d[0])}s`, s: dayName(d[0]) });
    }
    if (d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) {
      return t("sharedAccess.validity.daysRange", {
        a: dayName(d[0]),
        b: dayName(d[d.length - 1]),
      });
    }
    const names = d.map((x) => `${dayName(x)}s`);
    const list = `${names.slice(0, -1).join(", ")} ${t("sharedAccess.validity.and")} ${names[names.length - 1]}`;
    return t("sharedAccess.validity.daysMany", { list });
  };

  const hours = (windows: SharedAccessTimeWindow[]): string =>
    windows.length === 0
      ? t("sharedAccess.validity.allDay")
      : windows.map((w) => `${shortDays(w)}${w.from}–${w.to}`).join(" · ");

  return { tz, dateTime, period, hours, dayName, daysSentence };
}

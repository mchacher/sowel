import { useTranslation } from "react-i18next";
import { useTimezone } from "../../store/useTimezone";
import { dateLocale } from "../../lib/locale";
import type { SharedAccessTimeWindow } from "../../types";

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

  const hours = (windows: SharedAccessTimeWindow[]): string =>
    windows.length === 0
      ? t("sharedAccess.validity.allDay")
      : windows.map((w) => `${w.from}–${w.to}`).join(", ");

  return { tz, dateTime, period, hours };
}

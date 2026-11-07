import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { useTimezone } from "../../store/useTimezone";
import { currentLocale } from "../../lib/format";

/** The browser's own time zone, or null when the runtime does not say. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * The home's time, shown only when the browser sits in another time zone
 * (spec 196, decision pr6-horloge). Otherwise the phone or the computer already
 * shows the right time and the top bar stays quiet. Automations run on home
 * time, so a traveller sees the clock they act on, with its zone.
 *
 * Minutes only, refreshed every 30 s.
 */
export function HomeTimeNote({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const tz = useTimezone((s) => s.tz);
  const loaded = useTimezone((s) => s.loaded);
  const differs = loaded && tz !== browserTimeZone();
  const [now, setNow] = useState<string>(() => formatHomeTime(tz));

  useEffect(() => {
    if (!differs) return;
    const tick = () => setNow(formatHomeTime(tz));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [tz, differs]);

  if (!differs) return null;

  const label = `${t("header.homeTime")} ${now}`;
  return (
    <div
      className="flex items-center gap-1 text-caption text-text-secondary tabular-nums whitespace-nowrap"
      title={`${label} (${tz})`}
    >
      <Clock size={14} strokeWidth={1.5} aria-hidden="true" />
      {compact ? (
        <>
          <span className="sr-only">{t("header.homeTime")}</span>
          <span>{now}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}

/** « 11:05 UTC+1 »: the home's time with its zone, so it is not mistaken for local time. */
function formatHomeTime(tz: string, date: Date = new Date()): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat(currentLocale(), { timeZone: tz, ...opts }).format(date);
  } catch {
    // Invalid TZ — fall back to the browser's own clock
    return new Intl.DateTimeFormat(currentLocale(), opts).format(date);
  }
}

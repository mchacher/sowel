import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useTimezone } from "../../store/useTimezone";

/**
 * Displays the current time in the **home** timezone (not the browser's local
 * timezone). Useful when you're accessing Sowel from a device in a different
 * timezone — the pill always shows home time to match the automation logic.
 *
 * Refreshes every 30 seconds. Falls back to browser local time if the home TZ
 * is not yet loaded or invalid.
 */
export function CurrentTimePill({ compact = false }: { compact?: boolean }) {
  const tz = useTimezone((s) => s.tz);
  const loaded = useTimezone((s) => s.loaded);
  const [now, setNow] = useState<string>(() => formatHomeTime(tz));

  useEffect(() => {
    const tick = () => setNow(formatHomeTime(tz));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [tz]);

  if (!loaded) return null;

  const size = compact ? 12 : 15;
  const textSize = compact ? "text-[11px]" : "text-[13px]";
  const padding = compact ? "" : "px-3 py-1.5 rounded-[8px] bg-primary/10";
  const textColor = compact ? "text-primary" : "text-primary";

  return (
    <div
      className={`flex items-center gap-1 font-medium tabular-nums ${textSize} ${padding} ${textColor}`}
    >
      <Clock size={size} strokeWidth={1.5} />
      <span>{now}</span>
    </div>
  );
}

function formatHomeTime(tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    // Invalid TZ — fall back to browser local
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }
}

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
export function CurrentTimePill({
  compact = false,
  withSeconds = true,
}: {
  compact?: boolean;
  withSeconds?: boolean;
}) {
  const tz = useTimezone((s) => s.tz);
  const loaded = useTimezone((s) => s.loaded);
  const [now, setNow] = useState<string>(() => formatHomeTime(tz, withSeconds));

  useEffect(() => {
    const tick = () => setNow(formatHomeTime(tz, withSeconds));
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [tz, withSeconds]);

  if (!loaded) return null;

  const size = compact ? 12 : 13;
  const textSize = compact ? "text-[11px]" : "text-[12px]";
  const padding = compact ? "" : "px-2.5 py-1 rounded-full bg-[var(--n-50)] border border-border-light";
  const textColor = compact ? "text-primary" : "text-text-secondary";

  return (
    <div
      className={`flex items-center gap-1 font-medium tabular-nums ${textSize} ${padding} ${textColor}`}
    >
      <Clock size={size} strokeWidth={1.5} />
      <span>{now}</span>
    </div>
  );
}

function formatHomeTime(tz: string, withSeconds = true): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date());
  } catch {
    // Invalid TZ — fall back to browser local
    return new Intl.DateTimeFormat(undefined, opts).format(new Date());
  }
}

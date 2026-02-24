import { useState, useEffect } from "react";
import { formatRelativeTime } from "../lib/format";

/**
 * Renders a live-updating relative timestamp ("< 5s ago", "2 min ago", etc.).
 * Re-renders automatically: every 5s when < 1 min, every 30s when < 1h, every 60s otherwise.
 */
export function RelativeTime({ iso }: { iso: string | null }) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!iso) return;

    const getInterval = () => {
      const diffMs = Date.now() - new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`).getTime();
      if (diffMs < 60_000) return 5_000;
      if (diffMs < 3_600_000) return 30_000;
      return 60_000;
    };

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        tick((n) => n + 1);
        schedule();
      }, getInterval());
    };
    schedule();

    return () => clearTimeout(timer);
  }, [iso]);

  return <>{formatRelativeTime(iso)}</>;
}

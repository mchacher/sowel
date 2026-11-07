import { useEffect, useState } from "react";
import { useTimezone } from "../store/useTimezone";
import { useWebSocket } from "../store/useWebSocket";
import { currentLocale } from "../lib/format";

/** How long the link must stay down before the indicator shows (spec 196, FR-6). */
export const DEGRADED_DELAY_MS = 3_000;

/**
 * A time zone in its canonical spelling, or null when the runtime rejects it
 * or does not say. Both sides go through it, so another spelling of the
 * browser's zone (Etc/UTC for UTC, US/Pacific for America/Los_Angeles,
 * europe/paris) is not taken for another place.
 */
function canonicalTimeZone(tz?: string): string | null {
  try {
    return (
      Intl.DateTimeFormat(currentLocale(), tz ? { timeZone: tz } : undefined).resolvedOptions()
        .timeZone ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Whether the top bar shows the home's time: only when the browser sits in
 * another time zone (spec 196, decision pr6-horloge). Nothing until the home
 * zone is known: the store starts on "UTC", which would otherwise flash a clock
 * before the real zone arrives. Shared by the note and by the bar, which makes
 * room for it on phones (#1133).
 */
export function useHomeTimeShown(): { shown: boolean; tz: string } {
  const tz = useTimezone((s) => s.tz);
  const loaded = useTimezone((s) => s.loaded);
  const home = loaded ? canonicalTimeZone(tz) : null;
  return { shown: home !== null && home !== canonicalTimeZone(), tz };
}

/**
 * Whether the link indicator shows (spec 196, FR-6): the link is not connected
 * and has stayed so for DEGRADED_DELAY_MS, so the routine disconnected →
 * connecting → connected cycle (and the first render, before the socket opens)
 * does not flash in the top bar. Shared by the indicator and by the bar (#1133).
 */
export function useLinkDegraded(): { shown: boolean; disconnected: boolean } {
  const status = useWebSocket((s) => s.status);
  const degraded = status !== "connected";
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!degraded) return;
    const id = setTimeout(() => setLate(true), DEGRADED_DELAY_MS);
    return () => {
      clearTimeout(id);
      setLate(false);
    };
  }, [degraded]);

  return { shown: degraded && late, disconnected: status === "disconnected" };
}

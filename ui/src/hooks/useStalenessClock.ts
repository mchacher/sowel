import { useEffect, useState } from "react";

/**
 * How often a surface re-checks reading ages against the wall clock (#744).
 *
 * Without it a reading only ages out when some unrelated equipment event
 * happens to re-render the surface. In a home whose only sources poll every
 * 300 s the recompute would land at the poll, with the reading 0 s old, so the
 * rule would silently never apply; in a home with a 1 Hz main meter it would
 * apply continuously. Same code, opposite behaviour, decided by unrelated
 * hardware.
 *
 * The case that matters most is the one where the events stop altogether: a
 * meter that goes silent produces no re-render at all, and a page deriving
 * staleness from `Date.now()` at render time would never notice (#854).
 */
export const STALENESS_TICK_MS = 30_000;

/**
 * A wall clock that advances on its own, for surfaces that compare reading
 * timestamps against "now".
 *
 * Each call site owns its interval, so two cards tick up to 30 s apart; what
 * is shared is the rate, and with it the rule for how late a surface may be to
 * notice. They watch disjoint equipment, so no two of them describe the same
 * reading at once.
 */
export function useStalenessClock(): number {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return clock;
}

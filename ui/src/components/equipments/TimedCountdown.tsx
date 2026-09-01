import { useEffect, useState } from "react";
import { elapsedFraction, formatRemaining, remainingMs } from "../../lib/timed-countdown";
import type { TimedAction } from "../../types";

/**
 * Spec 174 phase 2 — the one countdown.
 *
 * Phase 1 refused any UI on the grounds that five surfaces would each grow
 * their own copy of this, which is how #744 and #832 happened. This component
 * is the answer to that: the Dashboard tile and the compact card both render
 * it, and spec 149 inherits one implementation rather than two.
 *
 * It derives the remaining time from `expiresAt` on every tick rather than
 * counting down from a number captured at mount. A tab that slept for ten
 * minutes must come back showing what the engine still owes, not what a stale
 * local clock believes; the deadline belongs to the engine, and this only reads
 * it.
 */

interface TimedCountdownProps {
  action: TimedAction;
  /** Diameter of the ring in px. The digits sit beside it, not inside. */
  size?: number;
  /** Injected in tests so a window can be aged without touching the clock. */
  now?: number;
}

/**
 * A progress ring and the remaining time, side by side.
 *
 * The ring is the glanceable half (how much of the window is left) and the
 * digits are the precise one; a tile shows both, a dense row can pass a small
 * `size` and still read.
 */
export function TimedCountdown({ action, size = 18, now }: TimedCountdownProps) {
  const [tick, setTick] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) return; // frozen by the caller (tests)
    const id = setInterval(() => {
      const at = Date.now();
      setTick(at);
      // Nothing left to count: stop rather than tick on until the engine's
      // event unmounts us, which never comes if the socket is down.
      if (remainingMs(action.expiresAt, at) <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [now, action.expiresAt]);

  const at = now ?? tick;
  const left = remainingMs(action.expiresAt, at);
  const spent = elapsedFraction(action, at);
  const r = size / 2 - 1.5;
  const circumference = 2 * Math.PI * r;

  return (
    <span className="inline-flex items-center gap-1.5" aria-live="off">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="flex-shrink-0"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="2"
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-current"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * spent}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="font-mono tabular-nums">{formatRemaining(left)}</span>
    </span>
  );
}

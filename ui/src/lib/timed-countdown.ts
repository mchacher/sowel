// ============================================================
// Spec 174 phase 2 — reading a window's remaining time
// ============================================================
//
// Pure arithmetic, in its own module because `react-refresh/only-export-components`
// refuses non-component exports from a file of components — and it is right.
// `TimedCountdown` renders these; nothing else should re-derive them.

import type { TimedAction } from "../types";

/** Remaining milliseconds, floored at zero — a window never runs negative. */
export function remainingMs(expiresAt: string, now: number = Date.now()): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, at - now);
}

/** `m:ss` under an hour, `h:mm:ss` above it. Monospace digits do the aligning. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Fraction of the window already spent, clamped to [0, 1]. */
export function elapsedFraction(action: TimedAction, now: number = Date.now()): number {
  const start = Date.parse(action.armedAt);
  const end = Date.parse(action.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/**
 * Audit A1 — the house's grid import per 5-minute window, for the EV sessions.
 *
 * Pure. The main meter sends a live delta about once a minute, and each delta
 * measures the time since the previous one: it lands about a minute after the
 * energy it counts. Adding it to the window it arrives in moved the import of
 * a window's last minute into the next one, and `min(car, import)` turned the
 * gap into solar — "solar" at night at every charge start and end. Here a delta
 * is spread over the time it covers, from the previous delta to this one, so
 * each window gets its own import. A window is complete once a delta at or
 * after its end has arrived (`coveredUntilMs`).
 */

import { WINDOW_S } from "./window-accountant.js";

/** A first delta, or one after a long silence, covers this much. */
const DEFAULT_SPAN_MS = 60_000;
/** A gap longer than this is a silence, not one long reading. */
const MAX_SPAN_MS = 5 * 60_000;

export class HouseGridLedger {
  private readonly imports = new Map<number, number>();
  private lastAtMs: number | null = null;

  /** A live main-meter delta (Wh, positive = imported) received at `atMs`. */
  tick(atMs: number, signedWh: number): void {
    if (!Number.isFinite(signedWh)) return;
    const span =
      this.lastAtMs !== null && atMs > this.lastAtMs && atMs - this.lastAtMs <= MAX_SPAN_MS
        ? atMs - this.lastAtMs
        : DEFAULT_SPAN_MS;
    if (this.lastAtMs === null || atMs > this.lastAtMs) this.lastAtMs = atMs;
    const wh = Math.max(0, signedWh);
    const fromMs = atMs - span;
    const windowMs = WINDOW_S * 1000;
    for (let w = Math.floor(fromMs / windowMs) * windowMs; w < atMs; w += windowMs) {
      const overlap = Math.min(atMs, w + windowMs) - Math.max(fromMs, w);
      if (overlap <= 0) continue;
      const key = w / 1000;
      this.imports.set(key, (this.imports.get(key) ?? 0) + (wh * overlap) / span);
    }
  }

  /** The import of the window starting at `startS` (Wh); null when no delta touched it. */
  importFor(startS: number): number | null {
    return this.imports.get(startS) ?? null;
  }

  /** The time up to which the deltas received cover the house. */
  get coveredUntilMs(): number | null {
    return this.lastAtMs;
  }

  /** Forget the windows that started before `startS`. */
  prune(startS: number): void {
    for (const key of this.imports.keys()) if (key < startS) this.imports.delete(key);
  }
}

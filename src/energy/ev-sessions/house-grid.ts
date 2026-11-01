/**
 * Audit A1 — the house's grid import over time, for the EV sessions.
 *
 * Pure. The main meter sends a live delta about once a minute, and each delta
 * measures the time since the previous one: it lands about a minute after the
 * energy it counts. Adding it to the window it arrives in moved the import of
 * a window's last minute into the next one, and `min(car, import)` turned the
 * gap into solar — "solar" at night at every charge start and end. Here a delta
 * is spread over the time it covers, from the previous delta to this one, in
 * one-minute buckets, so the import of any span can be read back
 * (`importBetween`): a session's part of a window takes the import of its own
 * minutes, not the house's before the plug-in. A span is complete once a
 * delta at or after its end has arrived (`coveredUntilMs`).
 */

const BUCKET_MS = 60_000;
/** A first delta, or one after a long silence, covers this much. */
const DEFAULT_SPAN_MS = 60_000;
/** A gap longer than this is a silence, not one long reading. */
const MAX_SPAN_MS = 5 * 60_000;

export class HouseGridLedger {
  private readonly buckets = new Map<number, number>();
  /** How much of each bucket the deltas covered (ms): a silence leaves holes. */
  private readonly coveredMs = new Map<number, number>();
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
    for (let b = Math.floor(fromMs / BUCKET_MS) * BUCKET_MS; b < atMs; b += BUCKET_MS) {
      const overlap = Math.min(atMs, b + BUCKET_MS) - Math.max(fromMs, b);
      if (overlap <= 0) continue;
      this.buckets.set(b, (this.buckets.get(b) ?? 0) + (wh * overlap) / span);
      this.coveredMs.set(b, Math.min(BUCKET_MS, (this.coveredMs.get(b) ?? 0) + overlap));
    }
  }

  /**
   * The import over [fromMs, toMs) (Wh); null unless the deltas covered all of
   * it (a meter silence inside it must not read as solar).
   */
  importBetween(fromMs: number, toMs: number): number | null {
    let wh = 0;
    let covered = 0;
    for (let b = Math.floor(fromMs / BUCKET_MS) * BUCKET_MS; b < toMs; b += BUCKET_MS) {
      const overlap = Math.min(toMs, b + BUCKET_MS) - Math.max(fromMs, b);
      if (overlap <= 0) continue;
      wh += ((this.buckets.get(b) ?? 0) * overlap) / BUCKET_MS;
      covered += (overlap * (this.coveredMs.get(b) ?? 0)) / BUCKET_MS;
    }
    // A few seconds of jitter between deltas are no silence.
    return toMs > fromMs && covered >= (toMs - fromMs) * 0.97 ? wh : null;
  }

  /** The time up to which the deltas received cover the house. */
  get coveredUntilMs(): number | null {
    return this.lastAtMs;
  }

  /** Forget the import before `beforeMs`. */
  prune(beforeMs: number): void {
    for (const key of this.buckets.keys()) {
      if (key + BUCKET_MS > beforeMs) continue;
      this.buckets.delete(key);
      this.coveredMs.delete(key);
    }
  }

  /** Buckets held (tests: the ledger must not grow without sessions). */
  get size(): number {
    return this.buckets.size;
  }
}

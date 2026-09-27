// ============================================================
// Spec 181 — the anti-guessing budget (R6)
//
// Behind a reverse proxy the core sees the proxy's address, not the visitor's,
// so « N tries per IP » would be N tries for the whole internet — and one
// script exhausting it would lock every guest out. The budget is therefore
// GLOBAL, and it counts only failures: the code is looked up first, and a
// correct code is never slowed or refused (R6.24).
//
// A failure is answered late: the first ten in ten minutes at once, then 1 s,
// 2, 4, 8, up to 10 s. A guesser that sends in parallel is bounded by a cap on
// the answers held at once (R6.25): past it, a failure is answered at once with
// `too_many` — still no success, and no more sockets kept open.
// ============================================================

export interface GuessingOptions {
  freeFailures?: number;
  windowMs?: number;
  maxDelayMs?: number;
  /** The owner is alerted when the window holds more failures than this. */
  alertAbove?: number;
  maxHeld?: number;
  now?: () => number;
  onAlert?: (failures: number) => void;
  onAlertCleared?: () => void;
}

export type HeldOutcome = "held" | "too_many";

export class GuessingBudget {
  private readonly freeFailures: number;
  private readonly windowMs: number;
  private readonly maxDelayMs: number;
  private readonly alertAbove: number;
  private readonly maxHeld: number;
  private readonly now: () => number;
  private readonly onAlert: (failures: number) => void;
  private readonly onAlertCleared: () => void;

  private failures: number[] = [];
  private alerted = false;
  private readonly pending = new Map<NodeJS.Timeout, () => void>();

  constructor(opts: GuessingOptions = {}) {
    this.freeFailures = opts.freeFailures ?? 10;
    this.windowMs = opts.windowMs ?? 10 * 60_000;
    this.maxDelayMs = opts.maxDelayMs ?? 10_000;
    this.alertAbove = opts.alertAbove ?? 25;
    this.maxHeld = opts.maxHeld ?? 32;
    this.now = opts.now ?? Date.now;
    this.onAlert = opts.onAlert ?? (() => {});
    this.onAlertCleared = opts.onAlertCleared ?? (() => {});
  }

  /** Failures in the current window. */
  count(): number {
    this.prune();
    return this.failures.length;
  }

  /** Answers held right now. */
  held(): number {
    return this.pending.size;
  }

  /** How long the n-th failure of the window is held back. */
  delayFor(n: number): number {
    if (n <= this.freeFailures) return 0;
    return Math.min(this.maxDelayMs, 1000 * 2 ** (n - this.freeFailures - 1));
  }

  /**
   * Count one failure and hold its answer back as the budget says. Resolves
   * `too_many` at once when the cap on held answers is reached.
   */
  async fail(): Promise<HeldOutcome> {
    this.prune();
    this.failures.push(this.now());
    const n = this.failures.length;
    if (n > this.alertAbove && !this.alerted) {
      this.alerted = true;
      this.onAlert(n);
    }
    const delay = this.delayFor(n);
    if (delay === 0) return "held";
    if (this.pending.size >= this.maxHeld) return "too_many";
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(timer);
        resolve();
      }, delay);
      this.pending.set(timer, resolve);
    });
    return "held";
  }

  /** Shutdown: answer every held failure now. */
  releaseAll(): void {
    for (const [timer, resolve] of this.pending) {
      clearTimeout(timer);
      resolve();
    }
    this.pending.clear();
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.failures.length > 0 && this.failures[0] <= cutoff) this.failures.shift();
    if (this.failures.length === 0 && this.alerted) {
      this.alerted = false;
      this.onAlertCleared();
    }
  }
}

import type { Logger } from "../core/logger.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { ArbiterPublicState } from "../shared/types.js";
import { localDateStr } from "../shared/local-date.js";
import type { ArbiterGainRow, ArbiterGainStore } from "./arbiter-gain-store.js";
import type { TariffClassifier } from "./tariff-classifier.js";

// Spec 200 — what the arbiter earns: the solar energy used by the loads it
// switched on. Spec 202 — booked in Wh, peak and off-peak by the schedule of
// the minute, and priced when it is read, with the prices of its day.
//
// It reads the arbiter's public state, exactly like the UI, and never writes to
// it: arbitration cannot be disturbed by the measurement (same rule as the
// spec 158 metrics). The managed loads are served LAST by the sun, as EV
// sessions are (spec 191): the grid import is charged to them first, so the
// figure never claims solar the house itself used.

export const GAIN_SAMPLE_MS = 60_000;
export const GAIN_FLUSH_MS = 15 * 60_000;
/** A longer gap (a stalled process, a suspended VM) books only this much. */
export const GAIN_MAX_STEP_MS = 120_000;
export const GAIN_SINCE_KEY = "energy.arbiterGain.since";
/** The energy the tariff split is computed on (see sampleUnsafe). */
const SPLIT_NOMINAL_WH = 1_000_000;

export interface ArbiterGainMeterDeps {
  arbiter: { getPublicState(): ArbiterPublicState };
  tariff: Pick<TariffClassifier, "classify">;
  store: ArbiterGainStore;
  settings: Pick<SettingsManager, "get" | "set">;
  logger: Logger;
  now?: () => number;
}

export class ArbiterGainMeter {
  private deps: ArbiterGainMeterDeps;
  private logger: Logger;
  private now: () => number;
  private lastAt: number | null = null;
  /** Unflushed gain, keyed `${day}|${equipmentId}`. */
  private pendingRows = new Map<string, ArbiterGainRow>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ArbiterGainMeterDeps) {
    this.deps = deps;
    this.logger = deps.logger.child({ module: "arbiter-gain-meter" });
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.sampleTimer) return;
    this.sampleTimer = setInterval(() => this.sample(), GAIN_SAMPLE_MS);
    this.flushTimer = setInterval(() => this.flush(), GAIN_FLUSH_MS);
    this.logger.info("Arbiter gain meter started");
  }

  /** Stop the timers and persist what is pending. */
  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.sampleTimer = null;
    this.flushTimer = null;
    this.flush();
  }

  /** One sample. Public for tests. NEVER throws. */
  sample(): void {
    try {
      this.sampleUnsafe();
    } catch (err) {
      this.lastAt = null;
      this.logger.error({ err }, "Arbiter gain sample failed");
    }
  }

  private sampleUnsafe(): void {
    const now = this.now();
    const state = this.deps.arbiter.getPublicState();
    if (!state.enabled || state.availableSurplusW === null) {
      // The time without a fresh meter is not booked by the next sample either.
      this.lastAt = null;
      return;
    }
    this.markSince(now);
    const previous = this.lastAt;
    this.lastAt = now;
    if (previous === null || now <= previous) return;
    const dtMs = Math.min(now - previous, GAIN_MAX_STEP_MS);

    const granted = state.loads.filter((l) => l.state === "granted" && (l.watts ?? 0) > 0);
    const drawW = granted.reduce((s, l) => s + (l.watts ?? 0), 0);
    if (drawW <= 0) return;
    const importW = Math.max(0, -state.availableSurplusW);
    const solarW = Math.max(0, drawW - importW);
    if (solarW <= 0) return;

    const startMs = now - dtMs;
    const day = localDateStr(new Date(startMs));
    // The classifier rounds to whole Wh, far too coarse for a minute of a
    // load: ask it for the HP / HC proportions of the window on a large
    // nominal, then apply them.
    const split = this.deps.tariff.classify(SPLIT_NOMINAL_WH, startMs / 1000, dtMs / 1000);
    const splitTotal = split.hp + split.hc;
    const hpShare = splitTotal > 0 ? split.hp / splitTotal : 1;
    for (const load of granted) {
      const wh = (((solarW * (load.watts ?? 0)) / drawW) * dtMs) / 3_600_000;
      this.book(day, load.equipmentId, wh, hpShare);
    }
  }

  private book(day: string, equipmentId: string, wh: number, hpShare: number): void {
    const hpWh = wh * hpShare;
    const hcWh = wh - hpWh;
    const key = `${day}|${equipmentId}`;
    const row = this.pendingRows.get(key);
    if (row) {
      row.solarWh += wh;
      row.solarHpWh += hpWh;
      row.solarHcWh += hcWh;
    } else {
      this.pendingRows.set(key, {
        day,
        equipmentId,
        solarWh: wh,
        solarHpWh: hpWh,
        solarHcWh: hcWh,
        avoidedEur: 0,
      });
    }
  }

  /** The first local day the meter ran with the arbiter enabled, written once. */
  private markSince(now: number): void {
    if (this.deps.settings.get(GAIN_SINCE_KEY)) return;
    this.deps.settings.set(GAIN_SINCE_KEY, localDateStr(new Date(now)));
  }

  /** Persist the pending rows. On a failed write they stay pending. NEVER throws. */
  flush(): void {
    if (this.pendingRows.size === 0) return;
    try {
      const rows = [...this.pendingRows.values()];
      if (this.deps.store.add(rows)) this.pendingRows.clear();
    } catch (err) {
      this.logger.error({ err }, "Arbiter gain flush failed");
    }
  }

  /** The unflushed rows of the days in [fromDay, toDay], for a read. */
  pending(fromDay: string, toDay: string): ArbiterGainRow[] {
    return [...this.pendingRows.values()]
      .filter((r) => r.day >= fromDay && r.day <= toDay)
      .map((r) => ({ ...r }));
  }

  /** The value of `energy.arbiterGain.since`, null before the first run. */
  since(): string | null {
    return this.deps.settings.get(GAIN_SINCE_KEY) ?? null;
  }
}

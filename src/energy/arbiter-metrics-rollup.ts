/**
 * Spec 158 — scheduler and glue for the arbiter daily metrics.
 *
 * Reads the persisted decision journal and surplus series, resolves the load
 * profiles, calls the pure `rollupDay()`, and upserts the result.
 *
 * It never talks to `CapacityArbiter`. Everything it needs already lives
 * elsewhere: the decisions and samples are in their own stores, the profiles
 * are on the equipments, and the two config values are in the settings table.
 * That is what makes this pure instrumentation — the arbiter cannot be
 * destabilised by a change made here.
 */

import type { Logger } from "../core/logger.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import { localDateStr } from "../shared/local-date.js";
import type { ArbiterJournalStore } from "./arbiter-journal-store.js";
import type { ArbiterSurplusStore } from "./arbiter-surplus-store.js";
import { rollupDay, type RollupLoad } from "./arbiter-metrics.js";
import type { ArbiterMetricsStore, MetricsTick } from "./arbiter-metrics-store.js";

/**
 * Cap on decision rows read per day. A normal day is a few hundred; the cap
 * exists for the pathological case (an arbiter thrashing), which is exactly
 * the day this rollup is meant to characterise. Hitting it is logged, never
 * silent: a truncated rollup must not read as a complete one.
 */
export const ROLLUP_ROW_CAP = 20_000;

/**
 * How far back the entering-state lookback reaches. A load whose last decision
 * is older than this reads as idle entering the day, which is right for every
 * realistic case: grants are bounded by minOn/minOff and a restart journals a
 * `reset` that closes any open span.
 */
const LOOKBACK_MS = 48 * 3_600_000;

/**
 * How far past midnight a grant's revoke is still attributed to the day the
 * grant started on (short-cycle detection).
 */
const LOOKAHEAD_MS = 2 * 3_600_000;

const HOUR_MS = 3_600_000;

/** Local midnight of the day containing `at`. */
export function localMidnight(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export class ArbiterMetricsRollup {
  private logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly journalStore: ArbiterJournalStore,
    private readonly surplusStore: ArbiterSurplusStore,
    private readonly metricsStore: ArbiterMetricsStore,
    private readonly equipments: EquipmentManager,
    private readonly settings: SettingsManager,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "arbiter-metrics-rollup" });
  }

  /** Run once immediately, then on every hour boundary. */
  start(): void {
    this.stopped = false;
    this.runSafely();
    this.scheduleNextHour();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Hour-aligned rather than a plain 24 h interval: an interval drifts and a
   * restart resets it, so a day boundary eventually falls in a gap and a day
   * is never finalised. Same reasoning as the energy aggregator rollover
   * (#618).
   */
  private scheduleNextHour(): void {
    if (this.stopped) return;
    const now = Date.now();
    const delay = HOUR_MS - (now % HOUR_MS);
    this.timer = setTimeout(() => {
      this.runSafely();
      this.scheduleNextHour();
    }, delay);
    // Never hold the process open for a metrics tick.
    this.timer.unref?.();
  }

  private runSafely(): void {
    try {
      this.run();
    } catch (err) {
      // The timer must survive anything the rollup can do to itself.
      this.logger.error({ err }, "Arbiter metrics rollup failed");
    }
  }

  /**
   * Recompute today AND yesterday on every tick. Yesterday is what makes a
   * restart across midnight a non-event; today is partial by construction and
   * is completed by the first tick after midnight.
   */
  run(now: number = Date.now()): void {
    const todayStart = localMidnight(now);
    const yesterdayStart = localMidnight(todayStart - HOUR_MS); // DST-safe: 23:00 the day before
    const loads = this.resolveLoads();
    const releaseHoldS = this.numSetting("energy.arbiter.releaseHoldS", 600);

    const ticks: MetricsTick[] = [];
    for (const dayStart of [yesterdayStart, todayStart]) {
      const dayEndRaw = localMidnight(dayStart + 25 * HOUR_MS);
      // Clamp to now: a load granted right now must not be counted as granted
      // until tonight's midnight.
      const dayEnd = Math.min(dayEndRaw, now);
      if (dayEnd <= dayStart) continue;

      const decisions = this.journalStore.range(
        new Date(dayStart - LOOKBACK_MS).toISOString(),
        new Date(dayEnd + LOOKAHEAD_MS).toISOString(),
        ROLLUP_ROW_CAP,
      );
      if (decisions.length >= ROLLUP_ROW_CAP) {
        this.logger.warn(
          { day: localDateStr(new Date(dayStart)), cap: ROLLUP_ROW_CAP },
          "Arbiter decision read hit the rollup cap — metrics for this day are truncated",
        );
      }
      const surplus = this.surplusStore.range(dayStart, dayEnd);

      const result = rollupDay({
        dayStartMs: dayStart,
        dayEndMs: dayEnd,
        decisions,
        surplus,
        loads,
        releaseHoldS,
      });
      ticks.push({
        day: localDateStr(new Date(dayStart)),
        loads: result.loads,
        home: result.home,
      });
    }

    this.metricsStore.upsertTick(ticks);
    this.logger.debug({ days: ticks.map((t) => t.day) }, "Arbiter daily metrics rolled up");
  }

  /**
   * The declared flexible loads, with the surplus each is actually engaged
   * against. Profiles are read as they stand now, not as they were on the day
   * — which is why `idleClaimableExportWh` is documented as an estimate.
   */
  private resolveLoads(): RollupLoad[] {
    const engageMarginW = this.numSetting("energy.arbiter.engageMarginW", 100);
    const loads: RollupLoad[] = [];
    for (const equipment of this.equipments.getAll()) {
      const profile = equipment.energyProfile;
      if (!profile) continue;
      loads.push({
        equipmentId: equipment.id,
        minOnS: profile.minOnS,
        needW: profile.nominalPowerW + engageMarginW - (profile.toleratedImportW ?? 0),
      });
    }
    return loads;
  }

  private numSetting(key: string, fallback: number): number {
    const raw = this.settings.get(key);
    const n = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }
}

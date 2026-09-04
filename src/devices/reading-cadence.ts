// ============================================================
// How often does this device_data row actually report? (spec 175)
//
// The engine used to answer freshness questions from an equipment's type: a
// meter gets two minutes, everything else ten. A type says nothing about how
// often a device speaks, and `main_energy_meter` covers both a Shelly
// streaming at 1 Hz and a cloud integration polling every 300 s. One constant
// has to be wrong for one of them, which is what #881 and #883 are about.
//
// The arrival times are already there — every value write moves
// `device_data.last_updated`. This keeps the last few intervals between them
// in memory, per row, and hands back their median.
//
// In memory rather than persisted, on purpose: the alternative is a migration
// plus a write on the hottest path in the engine, to save a grace window that
// only matters in the minutes after a restart. See spec 175's architecture.
// ============================================================

import { BUDGET_CEILING_MS } from "../shared/reading-freshness.js";

/**
 * Silence after which a row's stored intervals no longer describe the source
 * that is now reporting, and the series starts again.
 *
 * Longer than any budget the engine will ever grant, so a source reporting on
 * ANY supported cadence never resets. Past that, two things it protects
 * against: a database restore, which replaces `device_data` rows through raw
 * SQL without passing the two call sites that call `forget()`, so an id reused
 * between the restored backup and the live process would otherwise splice two
 * unrelated histories into one median; and a device back from a long outage,
 * whose ten one-second samples from yesterday say nothing about what it is
 * doing now. Starting again costs three arrivals of the learning window, which
 * for a fast source is three seconds.
 */
const SERIES_RESET_MS = BUDGET_CEILING_MS;

/** Intervals kept per row. Ten is enough for a median to be stable, small enough to stay cheap. */
export const SAMPLE_COUNT = 10;

/**
 * Intervals required before the estimator answers at all.
 *
 * Two arrivals give one interval, and one interval is not a cadence: it is
 * equally the gap between a device's last two messages before it died. Three
 * is the smallest number a median can be taken of.
 */
export const MIN_SAMPLES = 3;

/**
 * The median of a device_data row's recent inter-arrival times.
 *
 * The median, not the mean, and irregularity is the reason. A source that
 * usually reports every second and occasionally takes half a minute
 * contributes one large interval; among ten samples that leaves the median at
 * one second, where a mean would drift toward the anomaly. Short irregularity
 * is absorbed rather than rejected by a rule.
 *
 * A silence longer than `SERIES_RESET_MS` is not irregularity, it is a
 * discontinuity, and the series starts again — see that constant.
 */
export class ReadingCadenceTracker {
  private readonly lastArrivalMs = new Map<string, number>();
  private readonly intervals = new Map<string, number[]>();

  /**
   * Record an arrival. Called on every device value write, so it stays a map
   * lookup, a push and at most a shift.
   *
   * A non-monotonic timestamp (clock step, replayed write) yields a negative
   * or zero interval, which says nothing about cadence and is dropped rather
   * than stored.
   */
  record(deviceDataId: string, atMs: number = Date.now()): void {
    // `atMs` is when the engine wrote the value, which is what the freshness
    // comparison is against too (`device_data.last_updated`). A plugin
    // replaying buffered readings in a burst would therefore report a cadence
    // faster than the device's own; the 120 s floor bounds the damage.
    const previous = this.lastArrivalMs.get(deviceDataId);
    this.lastArrivalMs.set(deviceDataId, atMs);
    if (previous === undefined) return;

    const interval = atMs - previous;
    if (interval <= 0) return;
    if (interval > SERIES_RESET_MS) {
      this.intervals.delete(deviceDataId);
      return;
    }

    let samples = this.intervals.get(deviceDataId);
    if (samples === undefined) {
      samples = [];
      this.intervals.set(deviceDataId, samples);
    }
    samples.push(interval);
    if (samples.length > SAMPLE_COUNT) samples.shift();
  }

  /**
   * The observed cadence, or null while fewer than `MIN_SAMPLES` intervals are
   * known. Null is "no information", never "fast" or "slow": the caller falls
   * back to what the integration declares, then to the learning window.
   */
  observedIntervalMs(deviceDataId: string): number | null {
    const samples = this.intervals.get(deviceDataId);
    if (samples === undefined || samples.length < MIN_SAMPLES) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  }

  /**
   * Drop a row's history. Called when a device_data row goes away: a device
   * deleted and rediscovered gets a new id anyway, and leaving the old series
   * behind would leak one entry per removed channel for the process's life.
   */
  forget(deviceDataId: string): void {
    this.lastArrivalMs.delete(deviceDataId);
    this.intervals.delete(deviceDataId);
  }

  /** Rows currently tracked. Exposed for diagnostics and tests, not for logic. */
  size(): number {
    return this.lastArrivalMs.size;
  }
}

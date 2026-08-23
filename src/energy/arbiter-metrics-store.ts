import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type { ArbiterDailyHomeMetrics, ArbiterDailyLoadMetrics } from "../shared/types.js";
import type { HomeMetricRow, LoadMetricRow } from "./arbiter-metrics.js";

// Spec 158 — persistence for the arbiter daily metrics. Same never-throw
// contract as ArbiterJournalStore (spec 147): a DB failure is logged and the
// caller carries on. Nothing here is on the arbitration path.

export const ARBITER_METRICS_RETENTION_DAYS = 400;

/** One tick's worth of rows: the days recomputed and their results. */
export interface MetricsTick {
  day: string; // local YYYY-MM-DD
  loads: LoadMetricRow[];
  home: HomeMetricRow;
}

interface LoadRow {
  day: string;
  equipment_id: string;
  grants: number;
  revokes: number;
  short_cycles: number;
  granted_s: number;
  pending_s: number;
  unmanaged_s: number;
  suspended_s: number;
}

interface HomeRow {
  day: string;
  export_wh: number;
  import_wh: number;
  waiting_export_wh: number;
  idle_claimable_export_wh: number;
  samples: number;
}

export class ArbiterMetricsStore {
  private logger: Logger;
  private upsertLoadStmt: Database.Statement;
  private upsertHomeStmt: Database.Statement;
  private readLoadsStmt: Database.Statement;
  private readHomeStmt: Database.Statement;
  private purgeLoadsStmt: Database.Statement;
  private purgeHomeStmt: Database.Statement;
  private writeTick: (ticks: MetricsTick[]) => void;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "arbiter-metrics-store" });

    this.upsertLoadStmt = db.prepare(
      `INSERT OR REPLACE INTO arbiter_daily_load_metrics
        (day, equipment_id, grants, revokes, short_cycles,
         granted_s, pending_s, unmanaged_s, suspended_s)
       VALUES (@day, @equipmentId, @grants, @revokes, @shortCycles,
               @grantedS, @pendingS, @unmanagedS, @suspendedS)`,
    );
    this.upsertHomeStmt = db.prepare(
      `INSERT OR REPLACE INTO arbiter_daily_home_metrics
        (day, export_wh, import_wh, waiting_export_wh, idle_claimable_export_wh, samples)
       VALUES (@day, @exportWh, @importWh, @waitingExportWh, @idleClaimableExportWh, @samples)`,
    );
    this.readLoadsStmt = db.prepare(
      "SELECT day, equipment_id, grants, revokes, short_cycles," +
        " granted_s, pending_s, unmanaged_s, suspended_s" +
        " FROM arbiter_daily_load_metrics WHERE day >= ? AND day <= ?" +
        " ORDER BY day ASC, equipment_id ASC",
    );
    this.readHomeStmt = db.prepare(
      "SELECT day, export_wh, import_wh, waiting_export_wh, idle_claimable_export_wh, samples" +
        " FROM arbiter_daily_home_metrics WHERE day >= ? AND day <= ? ORDER BY day ASC",
    );
    this.purgeLoadsStmt = db.prepare(
      "DELETE FROM arbiter_daily_load_metrics WHERE day < date('now', 'localtime', '-' || ? || ' days')",
    );
    this.purgeHomeStmt = db.prepare(
      "DELETE FROM arbiter_daily_home_metrics WHERE day < date('now', 'localtime', '-' || ? || ' days')",
    );

    // ONE transaction for the whole tick: one commit, one fsync per hour
    // instead of one per row. On a box booting from flash that is a five-fold
    // difference in write wear (spec 158, architecture 3.4), so this is a
    // requirement rather than a micro-optimisation.
    this.writeTick = db.transaction((ticks: MetricsTick[]) => {
      for (const tick of ticks) {
        for (const row of tick.loads) {
          this.upsertLoadStmt.run({ day: tick.day, ...row });
        }
        this.upsertHomeStmt.run({ day: tick.day, ...tick.home });
      }
    });
  }

  /** Persist every row of one rollup tick, atomically. NEVER throws. */
  upsertTick(ticks: MetricsTick[]): void {
    if (ticks.length === 0) return;
    try {
      this.writeTick(ticks);
    } catch (err) {
      this.logger.error(
        { err, days: ticks.map((t) => t.day) },
        "Failed to persist arbiter daily metrics",
      );
    }
  }

  /** Load rows in [from, to] (inclusive, YYYY-MM-DD). NEVER throws. */
  readLoads(from: string, to: string): Omit<ArbiterDailyLoadMetrics, "equipmentName">[] {
    try {
      const rows = this.readLoadsStmt.all(from, to) as LoadRow[];
      return rows.map((r) => ({
        day: r.day,
        equipmentId: r.equipment_id,
        grants: r.grants,
        revokes: r.revokes,
        shortCycles: r.short_cycles,
        grantedS: r.granted_s,
        pendingS: r.pending_s,
        unmanagedS: r.unmanaged_s,
        suspendedS: r.suspended_s,
      }));
    } catch (err) {
      this.logger.error({ err, from, to }, "Failed to read arbiter daily load metrics");
      return [];
    }
  }

  /** Home rows in [from, to] (inclusive, YYYY-MM-DD). NEVER throws. */
  readHome(from: string, to: string): ArbiterDailyHomeMetrics[] {
    try {
      const rows = this.readHomeStmt.all(from, to) as HomeRow[];
      return rows.map((r) => ({
        day: r.day,
        exportWh: r.export_wh,
        importWh: r.import_wh,
        waitingExportWh: r.waiting_export_wh,
        idleClaimableExportWh: r.idle_claimable_export_wh,
        samples: r.samples,
      }));
    } catch (err) {
      this.logger.error({ err, from, to }, "Failed to read arbiter daily home metrics");
      return [];
    }
  }

  /** Delete rows older than `days`. Returns the number of rows removed. */
  purgeOlderThan(days: number = ARBITER_METRICS_RETENTION_DAYS): number {
    try {
      const loads = this.purgeLoadsStmt.run(days).changes;
      const home = this.purgeHomeStmt.run(days).changes;
      return loads + home;
    } catch (err) {
      this.logger.error({ err }, "Failed to purge arbiter daily metrics");
      return 0;
    }
  }
}

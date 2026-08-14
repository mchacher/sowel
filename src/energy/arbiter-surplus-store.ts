import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";

// Spec 148 (Phase B) — persistence for the arbiter signed surplus/deficit series
// (spec 140 FR-10 timeline). Same never-throw pattern as ArbiterJournalStore
// (spec 147): a DB failure is logged and the in-memory ring keeps working.

export const ARBITER_SURPLUS_RETENTION_DAYS = 7;

export interface SurplusSample {
  at: number; // epoch ms
  availableW: number; // signed: >0 surplus, <0 déficit
}

interface SurplusRow {
  at: number;
  available_w: number;
}

export class ArbiterSurplusStore {
  private logger: Logger;
  private insertStmt: Database.Statement;
  private rangeStmt: Database.Statement;
  private recentStmt: Database.Statement;
  private purgeStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "arbiter-surplus-store" });
    // One row per 5-min sample; INSERT OR REPLACE keeps it idempotent per timestamp.
    this.insertStmt = db.prepare(
      "INSERT OR REPLACE INTO arbiter_surplus_log (at, available_w) VALUES (@at, @availableW)",
    );
    this.rangeStmt = db.prepare(
      "SELECT at, available_w FROM arbiter_surplus_log WHERE at >= ? AND at <= ? ORDER BY at ASC",
    );
    this.recentStmt = db.prepare(
      "SELECT at, available_w FROM arbiter_surplus_log WHERE at >= ? ORDER BY at ASC",
    );
    this.purgeStmt = db.prepare("DELETE FROM arbiter_surplus_log WHERE at < ?");
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM arbiter_surplus_log");
  }

  /** Persist one signed sample. NEVER throws. */
  insert(sample: SurplusSample): void {
    try {
      this.insertStmt.run({ at: sample.at, availableW: sample.availableW });
    } catch (err) {
      this.logger.error({ err }, "Failed to persist arbiter surplus sample");
    }
  }

  /** Samples in [fromMs, toMs], ascending. NEVER throws. */
  range(fromMs: number, toMs: number): SurplusSample[] {
    try {
      const rows = this.rangeStmt.all(fromMs, toMs) as SurplusRow[];
      return rows.map((r) => ({ at: r.at, availableW: r.available_w }));
    } catch (err) {
      this.logger.error({ err }, "Failed to read arbiter surplus range");
      return [];
    }
  }

  /** Samples since `sinceMs`, ascending — used to seed the in-memory ring on boot. */
  loadRecent(sinceMs: number): SurplusSample[] {
    try {
      const rows = this.recentStmt.all(sinceMs) as SurplusRow[];
      return rows.map((r) => ({ at: r.at, availableW: r.available_w }));
    } catch (err) {
      this.logger.error({ err }, "Failed to load recent arbiter surplus");
      return [];
    }
  }

  /** Delete samples older than `days`. Returns the number removed. NEVER throws. */
  purgeOlderThan(days: number = ARBITER_SURPLUS_RETENTION_DAYS): number {
    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const before = (this.countStmt.get() as { n: number }).n;
      this.purgeStmt.run(cutoff);
      const after = (this.countStmt.get() as { n: number }).n;
      return before - after;
    } catch (err) {
      this.logger.error({ err }, "Failed to purge arbiter surplus log");
      return 0;
    }
  }
}

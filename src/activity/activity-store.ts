import type Database from "better-sqlite3";
import type { Logger } from "../core/logger.js";
import type {
  ActivityItem,
  ActivityCategory,
  ActivityMessage,
  OrderSource,
} from "../shared/types.js";

// Spec 147 — persistence for the activity feed (spec 101).
//
// Mirrors AuditLogger (spec 113): persist-on-write, load-recent-on-boot,
// retention purged at boot. NEVER throws into the engine — a DB failure is
// logged via pino and the in-memory ring keeps working (pre-147 behaviour).

export const ACTIVITY_RETENTION_DAYS = 7;

interface ActivityRow {
  id: string;
  timestamp: number;
  category: string;
  zone_id: string | null;
  message: string;
  source: string | null;
}

export class ActivityStore {
  private logger: Logger;
  private insertStmt: Database.Statement;
  private loadRecentStmt: Database.Statement;
  private purgeStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "activity-store" });
    this.insertStmt = db.prepare(
      `INSERT INTO activity_log (id, timestamp, category, zone_id, message, source)
       VALUES (@id, @timestamp, @category, @zoneId, @message, @source)`,
    );
    this.loadRecentStmt = db.prepare(
      "SELECT id, timestamp, category, zone_id, message, source FROM activity_log" +
        // rowid (insertion order) is a stable tiebreak for same-ms timestamps.
        " ORDER BY timestamp DESC, rowid DESC LIMIT ?",
    );
    this.purgeStmt = db.prepare("DELETE FROM activity_log WHERE timestamp < ?");
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM activity_log");
  }

  /** Persist one activity item. NEVER throws. */
  insert(item: ActivityItem): void {
    try {
      this.insertStmt.run({
        id: item.id,
        timestamp: item.timestamp,
        category: item.category,
        zoneId: item.zoneId,
        message: JSON.stringify(item.message),
        source: item.source ? JSON.stringify(item.source) : null,
      });
    } catch (err) {
      this.logger.error({ err, category: item.category }, "Failed to persist activity item");
    }
  }

  /**
   * Load the most recent items (newest first), matching the in-memory ring's
   * order. NEVER throws — returns [] on failure so boot continues.
   */
  loadRecent(limit: number): ActivityItem[] {
    try {
      const rows = this.loadRecentStmt.all(limit) as ActivityRow[];
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        category: r.category as ActivityCategory,
        zoneId: r.zone_id,
        message: JSON.parse(r.message) as ActivityMessage,
        source: r.source ? (JSON.parse(r.source) as OrderSource) : undefined,
      }));
    } catch (err) {
      this.logger.error({ err }, "Failed to load recent activity items");
      return [];
    }
  }

  /** Delete items older than `days`. Returns the number of rows removed. */
  purgeOlderThan(days: number = ACTIVITY_RETENTION_DAYS): number {
    try {
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const before = (this.countStmt.get() as { n: number }).n;
      this.purgeStmt.run(cutoff);
      const after = (this.countStmt.get() as { n: number }).n;
      return before - after;
    } catch (err) {
      this.logger.error({ err }, "Failed to purge activity log");
      return 0;
    }
  }
}

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Logger } from "../core/logger.js";
import type { ArbiterDecision, ArbiterDecisionKind } from "../shared/types.js";

// Spec 147 — persistence for the energy arbiter decision journal (spec 140).
//
// Mirrors AuditLogger (spec 113): persist-on-write, load-recent-on-boot,
// retention purged at boot. NEVER throws into the arbiter — a DB failure is
// logged via pino and the in-memory journal ring keeps working. Only the
// decision journal is persisted, never the live control state (claims,
// suspensions, surplus), which the arbiter rebuilds from live events.

export const ARBITER_JOURNAL_RETENTION_DAYS = 7;

interface ArbiterDecisionRow {
  at_iso: string;
  kind: string;
  equipment_id: string | null;
  equipment_name: string | null;
  watts: number | null;
  reason: string | null;
  note: string | null;
}

export class ArbiterJournalStore {
  private logger: Logger;
  private insertStmt: Database.Statement;
  private loadRecentStmt: Database.Statement;
  private purgeStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "arbiter-journal-store" });
    this.insertStmt = db.prepare(
      `INSERT INTO arbiter_decision_log
        (id, at_iso, kind, equipment_id, equipment_name, watts, reason, note)
       VALUES (@id, @atIso, @kind, @equipmentId, @equipmentName, @watts, @reason, @note)`,
    );
    this.loadRecentStmt = db.prepare(
      "SELECT at_iso, kind, equipment_id, equipment_name, watts, reason, note" +
        // rowid (insertion order) is a stable tiebreak for same-ms timestamps.
        " FROM arbiter_decision_log ORDER BY at_iso DESC, rowid DESC LIMIT ?",
    );
    this.purgeStmt = db.prepare(
      "DELETE FROM arbiter_decision_log WHERE at_iso < datetime('now', '-' || ? || ' days')",
    );
    this.countStmt = db.prepare("SELECT COUNT(*) AS n FROM arbiter_decision_log");
  }

  /** Persist one arbiter decision. NEVER throws. */
  insert(d: ArbiterDecision): void {
    try {
      this.insertStmt.run({
        id: randomUUID(),
        atIso: d.atIso,
        kind: d.kind,
        equipmentId: d.equipmentId ?? null,
        equipmentName: d.equipmentName ?? null,
        watts: d.watts ?? null,
        reason: d.reason ?? null,
        note: d.note ?? null,
      });
    } catch (err) {
      this.logger.error({ err, kind: d.kind }, "Failed to persist arbiter decision");
    }
  }

  /**
   * Load the most recent decisions in ASCENDING (oldest-first) order, matching
   * the in-memory `journalEntries` ring (which appends and only reverses in
   * getPublicState). NEVER throws — returns [] on failure so boot continues.
   */
  loadRecent(limit: number): ArbiterDecision[] {
    try {
      const rows = this.loadRecentStmt.all(limit) as ArbiterDecisionRow[];
      // Query is DESC (most recent `limit`); reverse to ascending for the ring.
      return rows.reverse().map((r) => ({
        atIso: r.at_iso,
        kind: r.kind as ArbiterDecisionKind,
        equipmentId: r.equipment_id ?? undefined,
        equipmentName: r.equipment_name ?? undefined,
        watts: r.watts ?? undefined,
        reason: r.reason ?? undefined,
        note: r.note ?? undefined,
      }));
    } catch (err) {
      this.logger.error({ err }, "Failed to load recent arbiter decisions");
      return [];
    }
  }

  /** Delete decisions older than `days`. Returns the number of rows removed. */
  purgeOlderThan(days: number = ARBITER_JOURNAL_RETENTION_DAYS): number {
    try {
      const before = (this.countStmt.get() as { n: number }).n;
      this.purgeStmt.run(days);
      const after = (this.countStmt.get() as { n: number }).n;
      return before - after;
    } catch (err) {
      this.logger.error({ err }, "Failed to purge arbiter decision log");
      return 0;
    }
  }
}

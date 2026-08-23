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
  running: number | null; // 0/1, NULL = unknown (#535, legacy rows)
}

function toDecision(r: ArbiterDecisionRow): ArbiterDecision {
  return {
    atIso: r.at_iso,
    kind: r.kind as ArbiterDecisionKind,
    equipmentId: r.equipment_id ?? undefined,
    equipmentName: r.equipment_name ?? undefined,
    watts: r.watts ?? undefined,
    reason: r.reason ?? undefined,
    note: r.note ?? undefined,
    running: r.running === null ? undefined : r.running === 1,
  };
}

export class ArbiterJournalStore {
  private logger: Logger;
  private insertStmt: Database.Statement;
  private loadRecentStmt: Database.Statement;
  private purgeStmt: Database.Statement;
  private rangeStmt: Database.Statement;
  private rangeLatestStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(db: Database.Database, logger: Logger) {
    this.logger = logger.child({ module: "arbiter-journal-store" });
    this.insertStmt = db.prepare(
      `INSERT INTO arbiter_decision_log
        (id, at_iso, kind, equipment_id, equipment_name, watts, reason, note, running)
       VALUES (@id, @atIso, @kind, @equipmentId, @equipmentName, @watts, @reason, @note, @running)`,
    );
    this.loadRecentStmt = db.prepare(
      "SELECT at_iso, kind, equipment_id, equipment_name, watts, reason, note, running" +
        // rowid (insertion order) is a stable tiebreak for same-ms timestamps.
        " FROM arbiter_decision_log ORDER BY at_iso DESC, rowid DESC LIMIT ?",
    );
    this.purgeStmt = db.prepare(
      "DELETE FROM arbiter_decision_log WHERE at_iso < datetime('now', '-' || ? || ' days')",
    );
    this.rangeStmt = db.prepare(
      "SELECT at_iso, kind, equipment_id, equipment_name, watts, reason, note, running" +
        " FROM arbiter_decision_log WHERE at_iso >= ? AND at_iso <= ?" +
        " ORDER BY at_iso ASC, rowid ASC",
    );
    // Spec 158 — same window, but capped to the NEWEST rows. A plain
    // "ORDER BY ASC LIMIT n" would keep the oldest, which for the rollup means
    // keeping the lookback and dropping the very day being rolled up.
    this.rangeLatestStmt = db.prepare(
      "SELECT at_iso, kind, equipment_id, equipment_name, watts, reason, note, running" +
        " FROM arbiter_decision_log WHERE at_iso >= ? AND at_iso <= ?" +
        " ORDER BY at_iso DESC, rowid DESC LIMIT ?",
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
        running: d.running === undefined ? null : d.running ? 1 : 0,
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
        running: r.running === null ? undefined : r.running === 1,
      }));
    } catch (err) {
      this.logger.error({ err }, "Failed to load recent arbiter decisions");
      return [];
    }
  }

  /** Decisions in [fromIso, toIso], ascending (spec 148 — timeline window). */
  range(fromIso: string, toIso: string): ArbiterDecision[] {
    try {
      return (this.rangeStmt.all(fromIso, toIso) as ArbiterDecisionRow[]).map(toDecision);
    } catch (err) {
      this.logger.error({ err }, "Failed to read arbiter decision range");
      return [];
    }
  }

  /**
   * The most recent `limit` decisions in [fromIso, toIso], returned ascending
   * (spec 158 — the metrics rollup).
   *
   * A caller that cannot know how many decisions a window holds needs a bound:
   * a flapping arbiter can journal thousands in a day, and that is exactly the
   * day worth measuring. The cap keeps the NEWEST rows on purpose — the rollup
   * window is one day plus 48 h of lookback, and dropping the oldest costs
   * some entering-state context, whereas dropping the newest would silently
   * empty the very day being rolled up.
   *
   * Returns `{ decisions, truncated }` so the caller can report the loss
   * rather than persist a truncated day as if it were complete.
   */
  rangeLatest(
    fromIso: string,
    toIso: string,
    limit: number,
  ): { decisions: ArbiterDecision[]; truncated: boolean } {
    try {
      const rows = this.rangeLatestStmt.all(fromIso, toIso, limit) as ArbiterDecisionRow[];
      // Query is DESC (newest `limit`); reverse back to ascending.
      return { decisions: rows.reverse().map(toDecision), truncated: rows.length >= limit };
    } catch (err) {
      this.logger.error({ err }, "Failed to read capped arbiter decision range");
      return { decisions: [], truncated: false };
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

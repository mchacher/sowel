import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArbiterJournalStore } from "./arbiter-journal-store.js";
import type { Logger } from "../core/logger.js";
import type { ArbiterDecision } from "../shared/types.js";
import { applyMigrations } from "../test-helpers/migrations.js";

// Spec 147 — ArbiterJournalStore over an in-memory SQLite db seeded with the
// real migration set (arbiter_decision_log lives in migrations/019).

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeMockLogger(): MockLogger {
  const error = vi.fn();
  const self: MockLogger = { error, child: () => self };
  return self;
}

function decision(over: Partial<ArbiterDecision> = {}): ArbiterDecision {
  return {
    atIso: "2026-08-14T10:00:00.000Z",
    kind: "granted",
    equipmentId: "e1",
    equipmentName: "Pool pump",
    watts: 600,
    reason: "surplus available",
    note: undefined,
    ...over,
  };
}

describe("ArbiterJournalStore", () => {
  let db: Database.Database;
  let logger: MockLogger;
  let store: ArbiterJournalStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    logger = makeMockLogger();
    store = new ArbiterJournalStore(db, logger as unknown as Logger);
  });

  afterEach(() => db.close());

  it("round-trips a decision through insert + loadRecent", () => {
    const d = decision({ atIso: "2026-08-14T09:00:00.000Z" });
    store.insert(d);
    const rows = store.loadRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(d);
  });

  it("maps optional fields to undefined when absent", () => {
    store.insert(
      decision({
        atIso: "2026-08-14T09:00:00.000Z",
        kind: "released",
        equipmentId: undefined,
        equipmentName: undefined,
        watts: undefined,
        reason: undefined,
      }),
    );
    const [row] = store.loadRecent(10);
    expect(row.equipmentId).toBeUndefined();
    expect(row.watts).toBeUndefined();
    expect(row.reason).toBeUndefined();
  });

  it("round-trips the running flag (#535): true, false, and unknown", () => {
    store.insert(decision({ atIso: "2026-08-14T09:00:00.000Z", kind: "suspended", running: true }));
    store.insert(
      decision({ atIso: "2026-08-14T09:01:00.000Z", kind: "suspended", running: false }),
    );
    store.insert(decision({ atIso: "2026-08-14T09:02:00.000Z", kind: "resumed" }));
    const rows = store.loadRecent(10);
    expect(rows.map((r) => r.running)).toEqual([true, false, undefined]);
    const ranged = store.range("2026-08-14T09:00:00.000Z", "2026-08-14T09:02:00.000Z");
    expect(ranged.map((r) => r.running)).toEqual([true, false, undefined]);
  });

  it("loadRecent returns ascending (oldest-first), matching the ring order", () => {
    store.insert(decision({ atIso: "2026-08-14T08:00:00.000Z", reason: "older" }));
    store.insert(decision({ atIso: "2026-08-14T09:00:00.000Z", reason: "newer" }));
    expect(store.loadRecent(10).map((r) => r.reason)).toEqual(["older", "newer"]);
  });

  it("loadRecent(cap) returns the most recent `cap` rows, ascending", () => {
    store.insert(decision({ atIso: "2026-08-14T07:00:00.000Z", reason: "a" }));
    store.insert(decision({ atIso: "2026-08-14T08:00:00.000Z", reason: "b" }));
    store.insert(decision({ atIso: "2026-08-14T09:00:00.000Z", reason: "c" }));
    expect(store.loadRecent(2).map((r) => r.reason)).toEqual(["b", "c"]);
  });

  it("purgeOlderThan deletes decisions older than the window", () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    store.insert(decision({ atIso: stale, reason: "stale" }));
    store.insert(decision({ atIso: fresh, reason: "fresh" }));
    const removed = store.purgeOlderThan(7);
    expect(removed).toBe(1);
    expect(store.loadRecent(10).map((r) => r.reason)).toEqual(["fresh"]);
  });

  it("never throws when the underlying table is gone (logs instead)", () => {
    db.exec("DROP TABLE arbiter_decision_log");
    expect(() => store.insert(decision())).not.toThrow();
    expect(store.loadRecent(10)).toEqual([]);
    expect(store.purgeOlderThan(7)).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("ArbiterJournalStore.rangeLatest (spec 158)", () => {
  let db: Database.Database;
  let store: ArbiterJournalStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    store = new ArbiterJournalStore(db, makeMockLogger() as unknown as Logger);
    // 10 decisions, one per hour from 00:00 to 09:00.
    for (let h = 0; h < 10; h += 1) {
      store.insert(decision({ atIso: `2026-08-14T0${h}:00:00.000Z`, reason: `h${h}` }));
    }
  });

  afterEach(() => db.close());

  it("keeps the NEWEST rows when it truncates, not the oldest", () => {
    // This is the whole point: the rollup window is one day plus 48 h of
    // lookback, so dropping the oldest costs context while dropping the
    // newest would empty the very day being rolled up.
    const { decisions, truncated } = store.rangeLatest(
      "2026-08-14T00:00:00.000Z",
      "2026-08-14T23:59:59.999Z",
      3,
    );
    expect(truncated).toBe(true);
    expect(decisions.map((d) => d.reason)).toEqual(["h7", "h8", "h9"]);
  });

  it("returns rows ascending even though the query is descending", () => {
    const { decisions } = store.rangeLatest(
      "2026-08-14T00:00:00.000Z",
      "2026-08-14T23:59:59.999Z",
      100,
    );
    const times = decisions.map((d) => d.atIso);
    expect([...times].sort()).toEqual(times);
  });

  it("reports truncated=false when the window fits under the cap", () => {
    const { decisions, truncated } = store.rangeLatest(
      "2026-08-14T00:00:00.000Z",
      "2026-08-14T23:59:59.999Z",
      100,
    );
    expect(decisions).toHaveLength(10);
    expect(truncated).toBe(false);
  });

  it("leaves the uncapped range() untouched", () => {
    // Scope guard: spec 158 must not change what the spec 148 timeline reads.
    const all = store.range("2026-08-14T00:00:00.000Z", "2026-08-14T23:59:59.999Z");
    expect(all).toHaveLength(10);
    expect(all[0].reason).toBe("h0");
    expect(all[9].reason).toBe("h9");
  });

  it("never throws on a closed database", () => {
    db.close();
    expect(store.rangeLatest("2026-08-14T00:00:00.000Z", "2026-08-15T00:00:00.000Z", 10)).toEqual({
      decisions: [],
      truncated: false,
    });
  });
});

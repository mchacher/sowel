import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArbiterMetricsStore, type MetricsTick } from "./arbiter-metrics-store.js";
import type { Logger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";

// Spec 158 — ArbiterMetricsStore over an in-memory SQLite db seeded with the
// real migration set (the two tables live in migrations/025).

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeMockLogger(): MockLogger {
  const self: MockLogger = { error: vi.fn(), warn: vi.fn(), child: () => self };
  return self;
}

function tick(over: Partial<MetricsTick> = {}): MetricsTick {
  return {
    day: "2026-08-20",
    loads: [
      {
        equipmentId: "pump",
        grants: 2,
        revokes: 1,
        shortCycles: 1,
        grantedS: 3600,
        pendingS: 600,
        unmanagedS: 0,
        suspendedS: 0,
      },
    ],
    home: { exportWh: 1200, importWh: 300, idleClaimableExportWh: 400, samples: 288 },
    ...over,
  };
}

describe("ArbiterMetricsStore", () => {
  let db: Database.Database;
  let logger: MockLogger;
  let store: ArbiterMetricsStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    logger = makeMockLogger();
    store = new ArbiterMetricsStore(db, logger as unknown as Logger);
  });

  afterEach(() => db.close());

  it("round-trips a tick", () => {
    store.upsertTick([tick()]);

    const loads = store.readLoads("2026-08-01", "2026-08-31");
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      day: "2026-08-20",
      equipmentId: "pump",
      grants: 2,
      shortCycles: 1,
      grantedS: 3600,
    });

    const home = store.readHome("2026-08-01", "2026-08-31");
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ day: "2026-08-20", exportWh: 1200, samples: 288 });
  });

  it("overwrites rather than accumulates when a day is recomputed", () => {
    store.upsertTick([tick()]);
    store.upsertTick([
      tick({
        loads: [
          {
            equipmentId: "pump",
            grants: 5,
            revokes: 4,
            shortCycles: 3,
            grantedS: 7200,
            pendingS: 0,
            unmanagedS: 0,
            suspendedS: 0,
          },
        ],
      }),
    ]);

    const loads = store.readLoads("2026-08-20", "2026-08-20");
    expect(loads).toHaveLength(1);
    expect(loads[0].grants).toBe(5);
    expect(store.readHome("2026-08-20", "2026-08-20")).toHaveLength(1);
  });

  it("wraps the whole tick write in a db.transaction", () => {
    // Flash wear: one commit (one fsync) per tick, not one per row. Spec 158
    // makes this an acceptance criterion, so the wrapping is asserted rather
    // than trusted.
    const spy = vi.spyOn(Database.prototype, "transaction");
    try {
      const fresh = new ArbiterMetricsStore(db, logger as unknown as Logger);
      expect(spy).toHaveBeenCalledTimes(1);
      fresh.upsertTick([tick()]);
      expect(db.inTransaction).toBe(false); // committed, not left open
    } finally {
      spy.mockRestore();
    }
  });

  it("rolls back the ENTIRE tick when one row fails", () => {
    // The atomicity a single transaction buys. The first day is perfectly
    // valid; if the write were per-row it would survive the second day's
    // failure and leave a half-written tick behind.
    const good = tick({ day: "2026-08-19" });
    const bad = tick({
      day: "2026-08-20",
      loads: [
        {
          equipmentId: "pump",
          grants: 1,
          revokes: 0,
          shortCycles: 0,
          grantedS: 1,
          pendingS: 0,
          unmanagedS: 0,
          // A value SQLite cannot bind: the statement throws mid-transaction.
          suspendedS: {} as unknown as number,
        },
      ],
    });

    store.upsertTick([good, bad]);

    expect(store.readLoads("2026-08-19", "2026-08-20")).toHaveLength(0);
    expect(store.readHome("2026-08-19", "2026-08-20")).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns an empty array for a range with no data", () => {
    expect(store.readLoads("2020-01-01", "2020-12-31")).toEqual([]);
    expect(store.readHome("2020-01-01", "2020-12-31")).toEqual([]);
  });

  it("ignores an empty tick list", () => {
    store.upsertTick([]);
    expect(store.readLoads("2026-01-01", "2026-12-31")).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("purges rows older than the retention and keeps newer ones", () => {
    const old = new Date();
    old.setDate(old.getDate() - 500);
    const oldDay = old.toISOString().slice(0, 10);
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const recentDay = recent.toISOString().slice(0, 10);

    store.upsertTick([tick({ day: oldDay }), tick({ day: recentDay })]);
    const removed = store.purgeOlderThan(400);

    expect(removed).toBeGreaterThan(0);
    expect(store.readLoads(oldDay, oldDay)).toHaveLength(0);
    expect(store.readLoads(recentDay, recentDay)).toHaveLength(1);
  });

  it("never throws when the database is closed under it", () => {
    db.close();
    expect(() => store.upsertTick([tick()])).not.toThrow();
    expect(store.readLoads("2026-08-01", "2026-08-31")).toEqual([]);
    expect(store.readHome("2026-08-01", "2026-08-31")).toEqual([]);
    expect(store.purgeOlderThan()).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

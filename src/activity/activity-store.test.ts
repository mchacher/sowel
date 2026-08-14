import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityStore } from "./activity-store.js";
import type { Logger } from "../core/logger.js";
import type { ActivityItem } from "../shared/types.js";
import { applyMigrations } from "../test-helpers/migrations.js";

// Spec 147 — ActivityStore over an in-memory SQLite db seeded with the real
// migration set (activity_log lives in migrations/019).

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeMockLogger(): MockLogger {
  const error = vi.fn();
  const self: MockLogger = { error, child: () => self };
  return self;
}

let seq = 0;
function item(over: Partial<ActivityItem> = {}): ActivityItem {
  seq += 1;
  return {
    id: `a${seq}`,
    timestamp: 1_000_000 + seq,
    category: "order",
    zoneId: "z1",
    message: {
      template: "order.executed",
      params: { equipmentName: "Lamp", alias: "state", value: "ON" },
    },
    source: { kind: "manual", userId: "u1" },
    ...over,
  };
}

describe("ActivityStore", () => {
  let db: Database.Database;
  let logger: MockLogger;
  let store: ActivityStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    logger = makeMockLogger();
    store = new ActivityStore(db, logger as unknown as Logger);
  });

  afterEach(() => db.close());

  it("round-trips an item through insert + loadRecent", () => {
    const it = item({ id: "x1", timestamp: 5_000 });
    store.insert(it);
    const rows = store.loadRecent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(it);
  });

  it("loadRecent returns newest-first (matches the in-memory ring)", () => {
    const older = item({ id: "old", timestamp: 100 });
    const newer = item({ id: "new", timestamp: 200 });
    store.insert(older);
    store.insert(newer);
    expect(store.loadRecent(10).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("loadRecent honours the limit", () => {
    store.insert(item({ timestamp: 1 }));
    store.insert(item({ timestamp: 2 }));
    store.insert(item({ timestamp: 3 }));
    expect(store.loadRecent(2)).toHaveLength(2);
  });

  it("preserves a null zoneId and an undefined source", () => {
    store.insert(item({ id: "g", zoneId: null, source: undefined }));
    const [row] = store.loadRecent(10);
    expect(row.zoneId).toBeNull();
    expect(row.source).toBeUndefined();
  });

  it("purgeOlderThan deletes items older than the window and keeps recent ones", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    store.insert(item({ id: "stale", timestamp: eightDaysAgo }));
    store.insert(item({ id: "fresh", timestamp: now }));
    const removed = store.purgeOlderThan(7);
    expect(removed).toBe(1);
    expect(store.loadRecent(10).map((r) => r.id)).toEqual(["fresh"]);
  });

  it("never throws when the underlying table is gone (logs instead)", () => {
    db.exec("DROP TABLE activity_log");
    expect(() => store.insert(item())).not.toThrow();
    expect(store.loadRecent(10)).toEqual([]);
    expect(store.purgeOlderThan(7)).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

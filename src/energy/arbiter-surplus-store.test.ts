import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArbiterSurplusStore } from "./arbiter-surplus-store.js";
import type { Logger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}
function makeMockLogger(): MockLogger {
  const error = vi.fn();
  const self: MockLogger = { error, child: () => self };
  return self;
}

describe("ArbiterSurplusStore (spec 148)", () => {
  let db: Database.Database;
  let logger: MockLogger;
  let store: ArbiterSurplusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    logger = makeMockLogger();
    store = new ArbiterSurplusStore(db, logger as unknown as Logger);
  });
  afterEach(() => db.close());

  it("round-trips signed samples through insert + range (ascending)", () => {
    store.insert({ at: 200, availableW: -150 }); // déficit
    store.insert({ at: 100, availableW: 800 }); // surplus
    expect(store.range(0, 1000)).toEqual([
      { at: 100, availableW: 800 },
      { at: 200, availableW: -150 },
    ]);
  });

  it("range is inclusive and bounded", () => {
    [50, 100, 150, 200].forEach((at) => store.insert({ at, availableW: at }));
    expect(store.range(100, 150).map((s) => s.at)).toEqual([100, 150]);
  });

  it("insert is idempotent per timestamp (OR REPLACE)", () => {
    store.insert({ at: 100, availableW: 500 });
    store.insert({ at: 100, availableW: 700 });
    expect(store.range(0, 1000)).toEqual([{ at: 100, availableW: 700 }]);
  });

  it("purgeOlderThan deletes old samples and keeps recent", () => {
    store.insert({ at: Date.now() - 8 * 24 * 3600_000, availableW: 1 }); // 8 days
    store.insert({ at: Date.now(), availableW: 2 });
    expect(store.purgeOlderThan(7)).toBe(1);
    expect(store.range(0, Date.now() + 1000).map((s) => s.availableW)).toEqual([2]);
  });

  it("never throws when the table is gone", () => {
    db.exec("DROP TABLE arbiter_surplus_log");
    expect(() => store.insert({ at: 1, availableW: 1 })).not.toThrow();
    expect(store.range(0, 10)).toEqual([]);
    expect(store.loadRecent(0)).toEqual([]);
    expect(store.purgeOlderThan(7)).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

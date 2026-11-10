import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { PushSubscriptionManager } from "./push-subscription-manager.js";
import { createLogger } from "../core/logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

const logger = createLogger("silent").logger;

function insertUser(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)`,
  ).run(id, `user-${id}`, `User ${id}`, "x");
}

describe("PushSubscriptionManager", () => {
  let db: Database.Database;
  let manager: PushSubscriptionManager;

  beforeEach(() => {
    db = createTestDb();
    insertUser(db, "u1");
    insertUser(db, "u2");
    manager = new PushSubscriptionManager(db, logger);
  });

  afterEach(() => db.close());

  it("inserts a new subscription on first upsert", () => {
    const sub = manager.upsert("u1", {
      endpoint: "https://push.example/aaa",
      p256dh: "key-a",
      auth: "auth-a",
      userAgent: "Firefox",
    });
    expect(sub.id).toBeTruthy();
    expect(sub.userId).toBe("u1");
    expect(sub.endpoint).toBe("https://push.example/aaa");
    expect(sub.userAgent).toBe("Firefox");
    expect(manager.listAll()).toHaveLength(1);
  });

  it("upserts by endpoint (no duplicate row, updates keys + owner)", () => {
    const first = manager.upsert("u1", {
      endpoint: "https://push.example/aaa",
      p256dh: "key-a",
      auth: "auth-a",
    });
    const second = manager.upsert("u2", {
      endpoint: "https://push.example/aaa",
      p256dh: "key-b",
      auth: "auth-b",
    });
    expect(manager.listAll()).toHaveLength(1);
    expect(second.id).toBe(first.id); // same row reused
    expect(second.userId).toBe("u2");
    expect(second.p256dh).toBe("key-b");
    expect(second.auth).toBe("auth-b");
  });

  it("stores userAgent as undefined when omitted", () => {
    const sub = manager.upsert("u1", {
      endpoint: "https://push.example/bbb",
      p256dh: "k",
      auth: "a",
    });
    expect(sub.userAgent).toBeUndefined();
  });

  it("listByUser returns only the caller's subscriptions", () => {
    manager.upsert("u1", { endpoint: "https://push.example/1", p256dh: "k", auth: "a" });
    manager.upsert("u1", { endpoint: "https://push.example/2", p256dh: "k", auth: "a" });
    manager.upsert("u2", { endpoint: "https://push.example/3", p256dh: "k", auth: "a" });
    expect(manager.listByUser("u1")).toHaveLength(2);
    expect(manager.listByUser("u2")).toHaveLength(1);
    expect(manager.listByUser("nobody")).toHaveLength(0);
  });

  it("deleteByEndpoint without userId prunes regardless of owner", () => {
    manager.upsert("u1", { endpoint: "https://push.example/x", p256dh: "k", auth: "a" });
    manager.deleteByEndpoint("https://push.example/x");
    expect(manager.listAll()).toHaveLength(0);
  });

  it("deleteByEndpoint with userId only removes the caller's own subscription", () => {
    manager.upsert("u1", { endpoint: "https://push.example/x", p256dh: "k", auth: "a" });
    // u2 cannot delete u1's subscription
    manager.deleteByEndpoint("https://push.example/x", "u2");
    expect(manager.listAll()).toHaveLength(1);
    // owner can
    manager.deleteByEndpoint("https://push.example/x", "u1");
    expect(manager.listAll()).toHaveLength(0);
  });

  it("cascades subscriptions when the owning user is deleted", () => {
    manager.upsert("u1", { endpoint: "https://push.example/x", p256dh: "k", auth: "a" });
    db.prepare(`DELETE FROM users WHERE id = ?`).run("u1");
    expect(manager.listAll()).toHaveLength(0);
  });

  describe("devices: delivery result, name, delete by id (spec 199)", () => {
    function make(userId = "u1", endpoint = "https://push.example/d") {
      return manager.upsert(userId, { endpoint, p256dh: "k", auth: "a" });
    }
    const get = (id: string) => manager.listAll().find((s) => s.id === id);

    it("starts with no delivery and no failure", () => {
      const s = make();
      expect(s.consecutiveFailures).toBe(0);
      expect(s.lastSentAt).toBeUndefined();
      expect(s.lastSuccessAt).toBeUndefined();
      expect(s.lastError).toBeUndefined();
      expect(s.label).toBeUndefined();
    });

    it("counts failures in a row and a success resets them", () => {
      const s = make();
      expect(manager.recordFailure(s.id, "500 boom")).toBe(1);
      expect(manager.recordFailure(s.id, "500 boom again")).toBe(2);
      let row = get(s.id)!;
      expect(row.consecutiveFailures).toBe(2);
      expect(row.lastError).toBe("500 boom again");
      expect(row.lastSentAt).toMatch(/Z$/);
      expect(row.lastSuccessAt).toBeUndefined();

      manager.recordSuccess(s.id);
      row = get(s.id)!;
      expect(row.consecutiveFailures).toBe(0);
      expect(row.lastError).toBeUndefined();
      expect(row.lastSuccessAt).toMatch(/Z$/);
    });

    it("a failure that does not count records the error and keeps the run", () => {
      const s = make();
      manager.recordFailure(s.id, "403 x");
      expect(manager.recordFailure(s.id, "ENOTFOUND", false)).toBe(1);
      const row = get(s.id)!;
      expect(row.consecutiveFailures).toBe(1);
      expect(row.lastError).toBe("ENOTFOUND");
    });

    it("a new owner on the same endpoint starts unnamed, without the old history", () => {
      const s = make("u1");
      manager.rename(s.id, "u1", "Marc's iPhone");
      manager.recordSuccess(s.id);
      const taken = make("u2");
      expect(taken.userId).toBe("u2");
      expect(taken.label).toBeUndefined();
      expect(taken.lastSuccessAt).toBeUndefined();
      expect(taken.lastSentAt).toBeUndefined();
    });

    it("recordFailure on a gone row returns 0", () => {
      expect(manager.recordFailure("nope", "x")).toBe(0);
    });

    it("renames only the caller's own subscription, and blank clears it", () => {
      const s = make("u1");
      expect(manager.rename(s.id, "u2", "Hacked")).toBeNull();
      expect(get(s.id)!.label).toBeUndefined();
      expect(manager.rename(s.id, "u1", "  Marc's iPhone  ")!.label).toBe("Marc's iPhone");
      expect(manager.rename(s.id, "u1", "   ")!.label).toBeUndefined();
      expect(manager.rename(s.id, "u1", null)!.label).toBeUndefined();
    });

    it("re-subscribing the same endpoint keeps the name and resets the failures", () => {
      const s = make();
      manager.rename(s.id, "u1", "Kitchen tablet");
      manager.recordFailure(s.id, "500 boom");
      const again = make();
      expect(again.id).toBe(s.id);
      expect(again.label).toBe("Kitchen tablet");
      expect(again.consecutiveFailures).toBe(0);
      expect(again.lastError).toBeUndefined();
    });

    it("deletes by id only the caller's own subscription", () => {
      const s = make("u1");
      expect(manager.deleteById(s.id, "u2")).toBe(false);
      expect(manager.listAll()).toHaveLength(1);
      expect(manager.deleteById(s.id, "u1")).toBe(true);
      expect(manager.listAll()).toHaveLength(0);
    });

    it("deletes by id without a user (server-side prune)", () => {
      const s = make("u1");
      expect(manager.deleteById(s.id)).toBe(true);
      expect(manager.deleteById(s.id)).toBe(false);
    });
  });
});

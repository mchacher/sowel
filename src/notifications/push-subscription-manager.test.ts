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
});

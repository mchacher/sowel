import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuditLogger } from "./audit-logger.js";
import type { Logger } from "./logger.js";
import { applyMigrations } from "../test-helpers/migrations.js";

// Spec 113 — Unit tests on the AuditLogger over an in-memory SQLite
// database seeded with the real migration set (audit_log lives in
// migrations/010_audit_log.sql).

interface MockLogger {
  error: ReturnType<typeof vi.fn>;
  child: () => MockLogger;
}

function makeMockLogger(): MockLogger {
  const error = vi.fn();
  const self: MockLogger = { error, child: () => self };
  return self;
}

describe("AuditLogger", () => {
  let db: Database.Database;
  let logger: MockLogger;
  let auditLogger: AuditLogger;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db);
    logger = makeMockLogger();
    auditLogger = new AuditLogger(db, logger as unknown as Logger);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a row and reads it back through query()", () => {
    auditLogger.log({
      actorKind: "user",
      actorUserId: "u1",
      actorLabel: "alice",
      action: "auth.login.success",
      targetType: "user",
      targetId: "u1",
      ip: "192.0.2.1",
      meta: { browser: "chrome" },
    });

    const rows = auditLogger.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: "user",
      actorUserId: "u1",
      actorLabel: "alice",
      action: "auth.login.success",
      targetType: "user",
      targetId: "u1",
      ip: "192.0.2.1",
      meta: { browser: "chrome" },
    });
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never throws when the insert fails; logs via pino instead", () => {
    // Drop the table to force an insert failure
    db.exec("DROP TABLE audit_log");
    expect(() =>
      auditLogger.log({
        actorKind: "user",
        actorLabel: "alice",
        action: "auth.login.success",
      }),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login.success", actorLabel: "alice" }),
      expect.any(String),
    );
  });

  it("filters by actorUserId", () => {
    auditLogger.log({ actorKind: "user", actorUserId: "u1", actorLabel: "a", action: "x" });
    auditLogger.log({ actorKind: "user", actorUserId: "u2", actorLabel: "b", action: "x" });
    const rows = auditLogger.query({ actorUserId: "u1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorLabel).toBe("a");
  });

  it("filters by actionPrefix using LIKE", () => {
    auditLogger.log({ actorKind: "user", actorLabel: "a", action: "auth.login.success" });
    auditLogger.log({ actorKind: "user", actorLabel: "a", action: "auth.logout" });
    auditLogger.log({ actorKind: "user", actorLabel: "a", action: "user.create" });
    const rows = auditLogger.query({ actionPrefix: "auth." });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action.startsWith("auth."))).toBe(true);
  });

  it("filters by since and until (ISO 8601)", () => {
    // Insert raw rows with controlled timestamps to bypass the
    // logger's `new Date().toISOString()` and test the where clause.
    const insert = db.prepare(
      "INSERT INTO audit_log (id, timestamp, actor_kind, actor_label, action) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("a", "2026-01-01T00:00:00.000Z", "user", "x", "test");
    insert.run("b", "2026-06-01T00:00:00.000Z", "user", "x", "test");
    insert.run("c", "2026-12-01T00:00:00.000Z", "user", "x", "test");

    const rows = auditLogger.query({
      since: "2026-03-01T00:00:00.000Z",
      until: "2026-09-01T00:00:00.000Z",
    });
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("caps the limit at MAX_LIMIT (500)", () => {
    for (let i = 0; i < 20; i++) {
      auditLogger.log({ actorKind: "user", actorLabel: "a", action: "test" });
    }
    const rows = auditLogger.query({ limit: 9999 });
    expect(rows.length).toBeLessThanOrEqual(500);
    expect(rows.length).toBe(20); // we only inserted 20
  });

  it("paginates with offset, ordered DESC by timestamp", () => {
    // Force chronologically distinct timestamps by inserting raw.
    const insert = db.prepare(
      "INSERT INTO audit_log (id, timestamp, actor_kind, actor_label, action) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-19T10:00:0${i}.000Z`;
      insert.run(`id-${i}`, ts, "user", "a", "test");
    }

    const page1 = auditLogger.query({ limit: 2, offset: 0 });
    const page2 = auditLogger.query({ limit: 2, offset: 2 });
    expect(page1.map((r) => r.id)).toEqual(["id-4", "id-3"]);
    expect(page2.map((r) => r.id)).toEqual(["id-2", "id-1"]);
  });

  it("purgeOlderThan removes rows older than N days and keeps newer", () => {
    const insert = db.prepare(
      "INSERT INTO audit_log (id, timestamp, actor_kind, actor_label, action) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("old", "2024-01-01T00:00:00.000Z", "user", "a", "test");
    insert.run("recent", new Date().toISOString(), "user", "a", "test");

    const deleted = auditLogger.purgeOlderThan(30);
    expect(deleted).toBe(1);
    const rows = auditLogger.query({});
    expect(rows.map((r) => r.id)).toEqual(["recent"]);
  });

  it("redactSettingMeta redacts sensitive keys", () => {
    expect(
      AuditLogger.redactSettingMeta("integration.netatmo.refresh_token", "old", "new"),
    ).toEqual({ valueRedacted: true });

    expect(AuditLogger.redactSettingMeta("user.password", "x", "y")).toEqual({
      valueRedacted: true,
    });

    expect(AuditLogger.redactSettingMeta("config.api_key", "x", "y")).toEqual({
      valueRedacted: true,
    });
  });

  it("redactSettingMeta passes non-sensitive keys through", () => {
    expect(AuditLogger.redactSettingMeta("home.latitude", "48.8", "48.9")).toEqual({
      oldValue: "48.8",
      newValue: "48.9",
    });

    expect(AuditLogger.redactSettingMeta("home.latitude", undefined, "48.9")).toEqual({
      oldValue: null,
      newValue: "48.9",
    });
  });

  it("round-trips meta through insert and query without truncation", () => {
    const meta = {
      nested: { deep: { value: 42 } },
      array: [1, "two", { three: true }],
      unicode: "café 🔒",
    };
    auditLogger.log({
      actorKind: "user",
      actorLabel: "a",
      action: "test",
      meta,
    });
    const rows = auditLogger.query({});
    expect(rows[0]!.meta).toEqual(meta);
  });
});

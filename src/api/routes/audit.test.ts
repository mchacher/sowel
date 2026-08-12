import Database from "better-sqlite3";
import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { AuditLogger } from "../../core/audit-logger.js";
import { createLogger } from "../../core/logger.js";
import { applyMigrations } from "../../test-helpers/migrations.js";
import { registerAuditRoutes } from "./audit.js";

// Spec 113 — Integration test on GET /api/v1/audit via Fastify inject().
// Validates admin-only access, paginated response, action filtering.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authRole?: "admin" | "standard" | null;
  seed?: (auditLogger: AuditLogger) => void;
}

async function buildApp(opts: BuildOpts = {}): Promise<{
  app: ReturnType<typeof Fastify>;
  db: Database.Database;
  auditLogger: AuditLogger;
}> {
  const db = new Database(":memory:");
  applyMigrations(db);
  const auditLogger = new AuditLogger(db, logger);
  if (opts.seed) opts.seed(auditLogger);

  const app = Fastify({ logger: false });

  // Stub auth: pre-decorate request.auth based on the test scenario.
  if (opts.authRole !== null && opts.authRole !== undefined) {
    app.addHook("preHandler", async (request) => {
      request.auth = { userId: "u1", role: opts.authRole as "admin" | "standard" };
    });
  }

  registerAuditRoutes(app, { auditLogger, logger });
  await app.ready();
  return { app, db, auditLogger };
}

describe("GET /api/v1/audit", () => {
  let openApp: ReturnType<typeof Fastify> | null = null;
  let openDb: Database.Database | null = null;

  afterEach(async () => {
    if (openApp) await openApp.close();
    if (openDb) openDb.close();
    openApp = null;
    openDb = null;
  });

  it("returns paginated entries to admin in reverse chronological order", async () => {
    const { app, db } = await buildApp({
      authRole: "admin",
      seed: (auditLogger) => {
        auditLogger.log({
          actorKind: "user",
          actorUserId: "u1",
          actorLabel: "alice",
          action: "auth.login.success",
        });
        auditLogger.log({
          actorKind: "user",
          actorUserId: "u1",
          actorLabel: "alice",
          action: "settings.update",
          targetId: "home.latitude",
        });
      },
    });
    openApp = app;
    openDb = db;

    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: Array<{ action: string }> };
    expect(body.entries).toHaveLength(2);
    const actions = body.entries.map((e) => e.action);
    expect(actions).toContain("auth.login.success");
    expect(actions).toContain("settings.update");
  });

  it("filters by actionPrefix", async () => {
    const { app, db } = await buildApp({
      authRole: "admin",
      seed: (auditLogger) => {
        auditLogger.log({ actorKind: "user", actorLabel: "a", action: "auth.login.success" });
        auditLogger.log({ actorKind: "user", actorLabel: "a", action: "user.create" });
        auditLogger.log({ actorKind: "user", actorLabel: "a", action: "auth.logout" });
      },
    });
    openApp = app;
    openDb = db;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit?actionPrefix=auth.",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: Array<{ action: string }> };
    expect(body.entries).toHaveLength(2);
    expect(body.entries.every((e) => e.action.startsWith("auth."))).toBe(true);
  });

  it("returns 403 to non-admin", async () => {
    const { app, db } = await buildApp({ authRole: "standard" });
    openApp = app;
    openDb = db;

    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when unauthenticated", async () => {
    const { app, db } = await buildApp({ authRole: null });
    openApp = app;
    openDb = db;

    const res = await app.inject({ method: "GET", url: "/api/v1/audit" });
    expect(res.statusCode).toBe(403);
  });
});

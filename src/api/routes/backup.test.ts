import Fastify from "fastify";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerBackupRoutes } from "./backup.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";

// Characterization tests for the #482 schema-validation conversion of the backup
// routes: admin gating moved to an onRequest hook (403 before the 400), and the
// local-restore body validated by schema instead of the hand-rolled filename
// check. POST /api/v1/backup (multipart upload) is intentionally left as-is.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  role?: "admin" | "user" | "viewer";
}

async function buildApp(opts: BuildOpts = {}) {
  const app = Fastify({ logger: false, ajv: validationAjvOptions });
  installValidationErrorHandler(app);

  if (opts.authed) {
    app.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: opts.role ?? "admin" };
    });
  }

  const restored: string[] = [];
  registerBackupRoutes(app, {
    backupManager: {
      listLocalBackups: () => [{ filename: "b1.zip" }],
      restoreFromFile: async (filename: string) => {
        restored.push(filename);
        return { restored: true };
      },
    } as never,
    auditLogger: { log: () => {} } as never,
    userManager: { getById: () => ({ username: "admin" }) } as never,
    logger,
  });
  await app.ready();
  return { app, restored };
}

describe("backup routes (schema validation, #482)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>["app"] | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("403s a non-admin on GET /backup/local (admin gate)", async () => {
    const built = await buildApp({ authed: true, role: "user" });
    app = built.app;
    const res = await app.inject({ method: "GET", url: "/api/v1/backup/local" });
    expect(res.statusCode).toBe(403);
  });

  it("lists local backups for an admin", async () => {
    const built = await buildApp({ authed: true, role: "admin" });
    app = built.app;
    const res = await app.inject({ method: "GET", url: "/api/v1/backup/local" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ backups: [{ filename: "b1.zip" }] });
  });

  it("403s a non-admin BEFORE body validation on restore-local (precedence)", async () => {
    const built = await buildApp({ authed: true, role: "user" });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/backup/restore-local",
      payload: { filename: 123 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s an admin with a missing filename, in { error } shape", async () => {
    const built = await buildApp({ authed: true, role: "admin" });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/backup/restore-local",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
  });

  it("restores a named local backup for an admin", async () => {
    const built = await buildApp({ authed: true, role: "admin" });
    app = built.app;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/backup/restore-local",
      payload: { filename: "b1.zip" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ restored: true });
    expect(built.restored).toEqual(["b1.zip"]);
  });
});

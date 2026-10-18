import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import type { Archiver } from "archiver";
import { describe, it, expect, afterEach } from "vitest";
import { createLogger } from "../../core/logger.js";
import { registerBackupRoutes } from "./backup.js";
import { installValidationErrorHandler, validationAjvOptions } from "../error-handler.js";
import type { UserRole } from "../../shared/types.js";

// Characterization tests for the #482 schema-validation conversion of the backup
// routes: admin gating moved to an onRequest hook (403 before the 400), and the
// local-restore body validated by schema instead of the hand-rolled filename
// check. POST /api/v1/backup (multipart upload) is intentionally left as-is.

const logger = createLogger("silent").logger;

interface BuildOpts {
  authed?: boolean;
  role?: UserRole;
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
    const built = await buildApp({ authed: true, role: "standard" });
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
    const built = await buildApp({ authed: true, role: "standard" });
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

describe("GET /api/v1/backup — the download", () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  /** A real server: inject() does not show how a client sees a stream cut off. */
  async function serve(buildArchive: (archive: Archiver) => Promise<void>): Promise<string> {
    const server = Fastify({ logger: false });
    app = server;
    server.addHook("onRequest", async (request) => {
      request.auth = { userId: "u1", role: "admin" };
    });
    registerBackupRoutes(server, {
      backupManager: { buildArchive } as never,
      auditLogger: { log: () => {} } as never,
      userManager: { getById: () => ({ username: "admin" }) } as never,
      logger,
    });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = server.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/api/v1/backup`;
  }

  /** The end-of-central-directory record a complete ZIP ends with. */
  const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

  it("sends a complete archive", async () => {
    const url = await serve(async (archive) => {
      archive.append("x".repeat(100_000), { name: "sowel-backup.json" });
    });

    const res = await fetch(url);
    const body = Buffer.from(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(body.includes(EOCD)).toBe(true);
  });

  it("cuts the download off when the export fails, instead of ending a truncated ZIP", async () => {
    // A failed bucket spool (a full disk) used to end the archive cleanly: the
    // browser saved a ZIP with no central directory as a successful download.
    const url = await serve(async (archive) => {
      archive.append("x".repeat(100_000), { name: "sowel-backup.json" });
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));
      throw new Error("ENOSPC");
    });

    const res = await fetch(url);

    await expect(res.arrayBuffer()).rejects.toThrow();
  });
});

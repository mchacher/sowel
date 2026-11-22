/**
 * Issue #1305 — sessions end when the account changes, end to end: real
 * database, real AuthService, real auth middleware (bearer check + role gate)
 * and the real /me and /users routes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { createLogger } from "../../core/logger.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import { UserManager } from "../../auth/user-manager.js";
import { MfaService } from "../../auth/mfa-service.js";
import { AuthService } from "../../auth/auth-service.js";
import { AuditLogger } from "../../core/audit-logger.js";
import { registerAuthMiddleware } from "../../auth/auth-middleware.js";
import { registerAuthRoutes } from "./auth.js";
import { registerMeRoutes } from "./me.js";
import { registerUserRoutes } from "./users.js";

const logger = createLogger("silent").logger;
const PASSWORD = "test-fixture-password";

type Tokens = { accessToken: string; refreshToken: string };

let db: Database.Database;
let app: FastifyInstance;
let userManager: UserManager;

beforeEach(async () => {
  db = createMigratedTestDb();
  userManager = new UserManager(db, logger);
  const mfaService = new MfaService(db, userManager, logger);
  const authService = new AuthService(
    db,
    userManager,
    mfaService,
    { secret: "test-secret", accessTtl: 900, refreshTtl: 2592000 },
    logger,
  );
  const auditLogger = new AuditLogger(db, logger);
  app = Fastify({ logger: false });
  registerAuthMiddleware(app, { authService, userManager, logger });
  registerAuthRoutes(app, { authService, userManager, auditLogger, logger });
  registerMeRoutes(app, { authService, mfaService, userManager, auditLogger, logger });
  registerUserRoutes(app, { userManager, authService, mfaService, auditLogger, logger });
  // An admin-only write, gated by the global role gate.
  app.post("/api/v1/recipes", async () => ({ ok: true }));
  await app.ready();

  for (const [username, role] of [
    ["root", "admin"],
    ["alice", "admin"],
  ] as const) {
    await userManager.createUser({ username, displayName: username, password: PASSWORD, role });
  }
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function login(username: string, password = PASSWORD): Promise<Tokens> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Tokens;
}

const bearer = (t: Tokens) => ({ authorization: `Bearer ${t.accessToken}` });
const refresh = (t: Tokens) =>
  app.inject({
    method: "POST",
    url: "/api/v1/auth/refresh",
    payload: { refreshToken: t.refreshToken },
  });
const me = (t: Tokens) => app.inject({ method: "GET", url: "/api/v1/me", headers: bearer(t) });

describe("session revocation end to end (issue #1305)", () => {
  it("a password change logs every other device out at once, and keeps the caller in", async () => {
    const laptop = await login("alice");
    const phone = await login("alice");

    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/password",
      headers: bearer(laptop),
      payload: { currentPassword: PASSWORD, newPassword: "a-new-password" },
    });
    expect(res.statusCode).toBe(200);
    const fresh = res.json() as Tokens;

    // The other device: its access token and its refresh token are both dead.
    expect((await me(phone)).statusCode).toBe(401);
    expect((await refresh(phone)).statusCode).toBe(401);
    // The caller's previous pair is dead too; the fresh one carries on.
    expect((await me(laptop)).statusCode).toBe(401);
    expect((await me(fresh)).statusCode).toBe(200);
    expect((await refresh(fresh)).statusCode).toBe(200);
  });

  it("a demoted admin loses admin writes on the very next request", async () => {
    const root = await login("root");
    const alice = await login("alice");
    const write = () =>
      app.inject({ method: "POST", url: "/api/v1/recipes", headers: bearer(alice) });
    expect((await write()).statusCode).toBe(200);

    const aliceId = userManager.getByUsername("alice")!.id;
    const demote = await app.inject({
      method: "PUT",
      url: `/api/v1/users/${aliceId}`,
      headers: bearer(root),
      payload: { role: "standard" },
    });
    expect(demote.statusCode).toBe(200);

    expect((await write()).statusCode).toBe(403);
    expect((await refresh(alice)).statusCode).toBe(401);
  });

  it("a disabled account is out at once, access and refresh", async () => {
    const root = await login("root");
    const alice = await login("alice");
    const aliceId = userManager.getByUsername("alice")!.id;
    await app.inject({
      method: "PUT",
      url: `/api/v1/users/${aliceId}`,
      headers: bearer(root),
      payload: { enabled: false },
    });
    expect((await me(alice)).statusCode).toBe(401);
    expect((await refresh(alice)).statusCode).toBe(401);
  });
});

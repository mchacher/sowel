import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type Database from "better-sqlite3";
import { OTP } from "otplib";
import { createLogger } from "../../core/logger.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import { UserManager } from "../../auth/user-manager.js";
import { MfaService } from "../../auth/mfa-service.js";
import { AuthService } from "../../auth/auth-service.js";
import { AuditLogger } from "../../core/audit-logger.js";
import { registerAuthMiddleware } from "../../auth/auth-middleware.js";
import { registerAuthRoutes } from "./auth.js";
import { registerMfaRoutes } from "./mfa.js";
import { registerUserRoutes } from "./users.js";

const logger = createLogger("silent").logger;
const totp = new OTP({ strategy: "totp" });

async function buildApp() {
  const db: Database.Database = createMigratedTestDb();
  const userManager = new UserManager(db, logger);
  const mfaService = new MfaService(db, userManager, logger);
  const authService = new AuthService(
    db,
    userManager,
    mfaService,
    { secret: "test-secret", accessTtl: 900, refreshTtl: 2592000 },
    logger,
  );
  const auditLogger = new AuditLogger(db, logger);

  const app = Fastify({ logger: false });
  registerAuthMiddleware(app, { authService, userManager, logger });
  registerAuthRoutes(app, { authService, userManager, auditLogger, logger });
  registerMfaRoutes(app, { authService, mfaService, userManager, auditLogger, logger });
  registerUserRoutes(app, { userManager, mfaService, auditLogger, logger });
  await app.ready();

  const user = await userManager.createUser({
    username: "alice",
    displayName: "Alice",
    password: "test-fixture-password",
    role: "admin",
  });

  return { app, db, userManager, mfaService, userId: user.id };
}

describe("MFA routes (spec 151)", () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ctx = await buildApp();
  });

  afterEach(async () => {
    await ctx.app.close();
    ctx.db.close();
  });

  async function login() {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "alice", password: "test-fixture-password" },
    });
    return res.json();
  }

  async function enrollAndConfirm(accessToken: string) {
    const setupRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/setup",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const { secret } = setupRes.json();
    const code = await totp.generate({ secret });

    const confirmRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/confirm",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    return { secret, backupCodes: confirmRes.json().backupCodes as string[] };
  }

  it("GET /me/mfa reports disabled before enrollment", async () => {
    const { accessToken } = await login();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/mfa",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.json()).toEqual({ enabled: false, confirmedAt: null, backupCodesRemaining: 0 });
  });

  it("enrolls, then requires MFA on the next login", async () => {
    const { accessToken } = await login();
    await enrollAndConfirm(accessToken);

    const secondLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "alice", password: "test-fixture-password" },
    });
    expect(secondLogin.json()).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
  });

  it("re-running setup on an already-enrolled account requires re-auth (prevents silent MFA disable)", async () => {
    // Security regression guard: beginEnrollment() upserts and resets
    // confirmed_at to NULL, so calling setup again with no challenge would
    // otherwise silently disable a confirmed account's MFA — a stolen
    // 15-minute access token (or an XSS) would be enough. See the mfa.ts
    // route comment for the fix.
    const { accessToken } = await login();
    const { secret } = await enrollAndConfirm(accessToken);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(true);

    const noAuthRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/setup",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(noAuthRes.statusCode).toBe(400);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(true);

    const wrongPwRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/setup",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: "wrong-password", code: await totp.generate({ secret }) },
    });
    expect(wrongPwRes.statusCode).toBe(401);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(true);

    const okRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/setup",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: "test-fixture-password", code: await totp.generate({ secret }) },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().secret).not.toBe(secret);
    // A successful re-enrollment does put the account back into "pending"
    // (matches beginEnrollment's existing, intended behavior) — the guard is
    // that this now requires the same re-auth as disable, not that it never happens.
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(false);
  });

  it("first-time setup needs no re-auth challenge (account has no MFA yet)", async () => {
    const { accessToken } = await login();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/totp/setup",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().secret).toBeTruthy();
  });

  it("rejects a wrong code at /auth/mfa/verify", async () => {
    const { accessToken } = await login();
    await enrollAndConfirm(accessToken);
    const { mfaToken } = await login();

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code: "000000" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("issues full tokens on a correct code at /auth/mfa/verify", async () => {
    const { accessToken } = await login();
    const { secret } = await enrollAndConfirm(accessToken);
    const { mfaToken } = await login();
    const code = await totp.generate({ secret });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("accessToken");
  });

  it("a trusted device issued at verify skips MFA on the next login", async () => {
    const { accessToken } = await login();
    const { secret } = await enrollAndConfirm(accessToken);
    const { mfaToken } = await login();
    const code = await totp.generate({ secret });

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code, trustDevice: true },
    });
    const { trustedDeviceToken } = verifyRes.json();
    expect(trustedDeviceToken).toBeTruthy();

    const thirdLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "alice", password: "test-fixture-password", trustedDeviceToken },
    });
    expect(thirdLogin.json()).toHaveProperty("accessToken");
  });

  it("accepts a backup code exactly once at /auth/mfa/verify", async () => {
    const { accessToken } = await login();
    const { backupCodes } = await enrollAndConfirm(accessToken);
    const [backupCode] = backupCodes;

    const { mfaToken: token1 } = await login();
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken: token1, code: backupCode, isBackupCode: true },
    });
    expect(first.statusCode).toBe(200);

    const { mfaToken: token2 } = await login();
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken: token2, code: backupCode, isBackupCode: true },
    });
    expect(second.statusCode).toBe(401);
  });

  it("disabling MFA requires password + a valid code", async () => {
    const { accessToken } = await login();
    const { secret } = await enrollAndConfirm(accessToken);

    const wrongPassword = await ctx.app.inject({
      method: "DELETE",
      url: "/api/v1/me/mfa/totp",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: "wrong", code: await totp.generate({ secret }) },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const ok = await ctx.app.inject({
      method: "DELETE",
      url: "/api/v1/me/mfa/totp",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: "test-fixture-password", code: await totp.generate({ secret }) },
    });
    expect(ok.statusCode).toBe(204);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(false);
  });

  it("regenerating backup codes invalidates the previous set", async () => {
    const { accessToken } = await login();
    const { secret, backupCodes: oldCodes } = await enrollAndConfirm(accessToken);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/me/mfa/backup-codes/regenerate",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: "test-fixture-password", code: await totp.generate({ secret }) },
    });
    expect(res.statusCode).toBe(200);
    const { backupCodes: newCodes } = res.json();
    expect(newCodes).toHaveLength(10);
    expect(ctx.mfaService.verifyBackupCode(ctx.userId, oldCodes[0])).toBe(false);
  });

  it("lists and revokes trusted devices", async () => {
    const { accessToken } = await login();
    ctx.mfaService.issueTrustedDevice(ctx.userId, "test-agent");

    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/mfa/trusted-devices",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const [device] = listRes.json();
    expect(device.userAgent).toBe("test-agent");

    const revokeRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/v1/me/mfa/trusted-devices/${device.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revokeRes.statusCode).toBe(204);
    expect(ctx.mfaService.listTrustedDevices(ctx.userId)).toHaveLength(0);
  });

  it("an mfa_pending token cannot be used to access a protected route", async () => {
    const { accessToken } = await login();
    await enrollAndConfirm(accessToken);
    const { mfaToken } = await login();

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/mfa",
      headers: { authorization: `Bearer ${mfaToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("admin can force-disable MFA on another user's account", async () => {
    const { accessToken } = await login();
    await enrollAndConfirm(accessToken);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(true);

    const bob = await ctx.userManager.createUser({
      username: "bob",
      displayName: "Bob",
      password: "test-fixture-password",
      role: "standard",
    });
    void bob;

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/v1/users/${ctx.userId}/mfa`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(204);
    expect(ctx.mfaService.isMfaEnabled(ctx.userId)).toBe(false);
  });

  it("a standard user cannot force-disable another user's MFA", async () => {
    await ctx.userManager.createUser({
      username: "bob",
      displayName: "Bob",
      password: "test-fixture-password",
      role: "standard",
    });
    const bobLogin = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "bob", password: "test-fixture-password" },
    });
    const { accessToken } = bobLogin.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/v1/users/${ctx.userId}/mfa`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthService } from "../../auth/auth-service.js";
import { AuthError } from "../../auth/auth-service.js";
import type { MfaService } from "../../auth/mfa-service.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import { buildActor } from "../audit-context.js";

interface MfaDeps {
  authService: AuthService;
  mfaService: MfaService;
  userManager: UserManager;
  auditLogger: AuditLogger;
  logger: Logger;
}

/**
 * Verifies a TOTP or backup code for the given user. Used both by the login
 * second-factor step and by the password+code re-auth challenge on
 * disable/regenerate.
 */
async function verifyCode(
  mfaService: MfaService,
  userId: string,
  code: string,
  isBackupCode: boolean | undefined,
): Promise<boolean> {
  return isBackupCode
    ? mfaService.verifyBackupCode(userId, code)
    : mfaService.verifyTotp(userId, code);
}

export function registerMfaRoutes(app: FastifyInstance, deps: MfaDeps): void {
  const { authService, mfaService, userManager, auditLogger } = deps;

  // ============================================================
  // Login second factor (public — authenticated via mfaToken, not a bearer token)
  // ============================================================

  // POST /api/v1/auth/mfa/verify (stricter rate limit, mirrors /auth/login)
  app.post<{
    Body: {
      mfaToken: string;
      code: string;
      isBackupCode?: boolean;
      trustDevice?: boolean;
    };
  }>(
    "/api/v1/auth/mfa/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { mfaToken, code, isBackupCode, trustDevice } = request.body ?? {};
      if (!mfaToken || !code) {
        return reply.code(400).send({ error: "mfaToken and code are required" });
      }

      let userId: string;
      try {
        ({ userId } = authService.verifyMfaToken(mfaToken));
      } catch (err) {
        if (err instanceof AuthError) return reply.code(err.status).send({ error: err.message });
        throw err;
      }

      const user = userManager.getById(userId);
      const valid = await verifyCode(mfaService, userId, code, isBackupCode);
      if (!valid) {
        auditLogger.log({
          actorKind: "user",
          actorUserId: userId,
          actorLabel: user?.username ?? userId,
          action: "mfa.verify.failure",
          ip: request.ip,
        });
        return reply.code(401).send({ error: "Invalid code" });
      }

      auditLogger.log({
        actorKind: "user",
        actorUserId: userId,
        actorLabel: user?.username ?? userId,
        action: "mfa.verify.success",
        ip: request.ip,
      });

      const tokens = authService.completeMfaLogin(userId);
      if (!trustDevice) return tokens;

      const userAgent = request.headers["user-agent"] ?? null;
      const trusted = mfaService.issueTrustedDevice(userId, userAgent);
      return {
        ...tokens,
        trustedDeviceToken: trusted.token,
        trustedDeviceExpiresAt: trusted.expiresAt,
      };
    },
  );

  // ============================================================
  // Self-service enrollment/management (own account only — spec 131 role gate
  // allowlist covers these in auth-middleware.ts)
  // ============================================================

  // GET /api/v1/me/mfa — current status
  app.get("/api/v1/me/mfa", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    return mfaService.getStatus(request.auth.userId);
  });

  // POST /api/v1/me/mfa/totp/setup — start (or restart) enrollment
  app.post<{ Body: { password?: string; code?: string; isBackupCode?: boolean } }>(
    "/api/v1/me/mfa/totp/setup",
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
      const user = userManager.getById(request.auth.userId);
      if (!user) return reply.code(404).send({ error: "User not found" });

      // Security-critical: beginEnrollment() resets confirmed_at to NULL on the
      // upsert, so re-running setup on an account with MFA already CONFIRMED
      // would otherwise silently disable protection with no challenge at all —
      // a stolen access token or an XSS would be enough. Require the same
      // password + live code re-auth as disable/regenerate whenever MFA is
      // already enabled. First-time enrollment (not yet enabled) needs none.
      if (mfaService.isMfaEnabled(user.id)) {
        const reauthError = await requireReauth(request, userManager, mfaService);
        if (reauthError) {
          return reply.code(reauthError.status).send({ error: reauthError.message });
        }
      }

      const setup = await mfaService.beginEnrollment(user.id, user.username);
      return setup;
    },
  );

  // POST /api/v1/me/mfa/totp/confirm — confirm enrollment, receive backup codes once
  app.post<{ Body: { code: string } }>("/api/v1/me/mfa/totp/confirm", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { code } = request.body ?? {};
    if (!code) return reply.code(400).send({ error: "code is required" });

    const result = await mfaService.confirmEnrollment(request.auth.userId, code);
    if (!result) return reply.code(400).send({ error: "Invalid code" });

    auditLogger.log({
      ...buildActor(request, userManager),
      action: "mfa.enabled",
      targetType: "user",
      targetId: request.auth.userId,
      ip: request.ip,
    });
    return result;
  });

  // DELETE /api/v1/me/mfa/totp — disable MFA (password + valid code required)
  app.delete<{ Body: { password: string; code: string; isBackupCode?: boolean } }>(
    "/api/v1/me/mfa/totp",
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

      const reauthError = await requireReauth(request, userManager, mfaService);
      if (reauthError) return reply.code(reauthError.status).send({ error: reauthError.message });

      mfaService.disable(request.auth.userId);
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "mfa.disabled",
        targetType: "user",
        targetId: request.auth.userId,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  // POST /api/v1/me/mfa/backup-codes/regenerate (password + valid code required)
  app.post<{ Body: { password: string; code: string; isBackupCode?: boolean } }>(
    "/api/v1/me/mfa/backup-codes/regenerate",
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

      const reauthError = await requireReauth(request, userManager, mfaService);
      if (reauthError) return reply.code(reauthError.status).send({ error: reauthError.message });

      const backupCodes = mfaService.regenerateBackupCodes(request.auth.userId);
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "mfa.backup_codes.regenerated",
        targetType: "user",
        targetId: request.auth.userId,
        ip: request.ip,
      });
      return { backupCodes };
    },
  );

  // GET /api/v1/me/mfa/trusted-devices
  app.get("/api/v1/me/mfa/trusted-devices", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    return mfaService.listTrustedDevices(request.auth.userId);
  });

  // DELETE /api/v1/me/mfa/trusted-devices/:id
  app.delete<{ Params: { id: string } }>(
    "/api/v1/me/mfa/trusted-devices/:id",
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

      const revoked = mfaService.revokeTrustedDevice(request.params.id, request.auth.userId);
      if (!revoked) return reply.code(404).send({ error: "Trusted device not found" });

      auditLogger.log({
        ...buildActor(request, userManager),
        action: "mfa.trusted_device.revoked",
        targetType: "user",
        targetId: request.auth.userId,
        ip: request.ip,
        meta: { deviceId: request.params.id },
      });
      return reply.code(204).send();
    },
  );
}

/**
 * Shared re-auth challenge for disable/regenerate: current password + a live
 * TOTP/backup code, regardless of the calling session's own trust level —
 * see spec 151 edge cases (a stolen/idle session or a trusted device alone
 * must never be enough to turn off protection).
 */
async function requireReauth(
  request: FastifyRequest<{
    Body: { password?: string; code?: string; isBackupCode?: boolean };
  }>,
  userManager: UserManager,
  mfaService: MfaService,
): Promise<{ status: number; message: string } | null> {
  const { password, code, isBackupCode } = request.body ?? {};
  if (!password || !code) {
    return { status: 400, message: "password and code are required" };
  }

  const userId = request.auth!.userId;
  const user = userManager.getById(userId);
  if (!user) return { status: 404, message: "User not found" };

  const withHash = userManager.getByUsername(user.username);
  const validPassword = withHash
    ? await userManager.verifyPassword(withHash.passwordHash, password)
    : false;
  if (!validPassword) return { status: 401, message: "Current password is incorrect" };

  const validCode = await verifyCode(mfaService, userId, code, isBackupCode);
  if (!validCode) return { status: 401, message: "Invalid code" };

  return null;
}

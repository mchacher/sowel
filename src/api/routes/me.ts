import type { FastifyInstance } from "fastify";
import type { AuthService } from "../../auth/auth-service.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import type { UserPreferences } from "../../shared/types.js";
import { buildActor } from "../audit-context.js";
import { clampTrustedDeviceDays, type MfaService } from "../../auth/mfa-service.js";

interface MeDeps {
  authService: AuthService;
  mfaService: MfaService;
  userManager: UserManager;
  auditLogger: AuditLogger;
  logger: Logger;
}

// Body schemas for the #482 conversion. `minLength` (with coerceTypes:false,
// issue #452) reproduces the old `!field` empty-string rejections; the password
// `newPassword` min length matches the old `.length < 6` check. Authentication
// stays enforced by the global auth middleware (runs before schema validation);
// existence (404) / semantic (401 "wrong password") checks stay in the handler,
// after the body — exactly where the old code ran them.
const displayNameBodySchema = {
  type: "object",
  required: ["displayName"],
  properties: { displayName: { type: "string", minLength: 1 } },
} as const;

const preferencesBodySchema = {
  type: "object",
  required: ["preferences"],
  properties: { preferences: { type: "object" } },
} as const;

const passwordChangeBodySchema = {
  type: "object",
  required: ["currentPassword", "newPassword"],
  properties: {
    currentPassword: { type: "string", minLength: 1 },
    newPassword: { type: "string", minLength: 6 },
  },
} as const;

const createTokenBodySchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    expiresAt: { type: "string" },
  },
} as const;

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  const { authService, mfaService, userManager, auditLogger } = deps;

  // GET /api/v1/me — Current user profile
  app.get("/api/v1/me", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const user = userManager.getById(request.auth.userId);
    if (!user) return reply.code(404).send({ error: "User not found" });
    return user;
  });

  // PUT /api/v1/me — Update display name
  app.put<{
    Body: { displayName: string };
  }>("/api/v1/me", { schema: { body: displayNameBodySchema } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { displayName } = request.body;

    const user = userManager.getById(request.auth.userId);
    if (!user) return reply.code(404).send({ error: "User not found" });

    const updated = userManager.updateUser(user.id, {
      displayName,
      role: user.role,
      enabled: user.enabled,
    });
    return updated;
  });

  // PUT /api/v1/me/preferences — Update preferences
  app.put<{
    Body: { preferences: UserPreferences };
  }>(
    "/api/v1/me/preferences",
    { schema: { body: preferencesBodySchema } },
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

      const { preferences } = request.body;
      // Spec 151 — trusted-device duration is a stored preference, not a
      // per-request parameter: clamp here so a tampered/stale value can never
      // push a trusted-device expiry outside the allowed range.
      if (preferences.mfaTrustedDeviceDays !== undefined) {
        preferences.mfaTrustedDeviceDays = clampTrustedDeviceDays(preferences.mfaTrustedDeviceDays);
      }

      userManager.updatePreferences(request.auth.userId, preferences);
      const user = userManager.getById(request.auth.userId);
      return user;
    },
  );

  // PUT /api/v1/me/password — Change password
  app.put<{
    Body: { currentPassword: string; newPassword: string };
  }>(
    "/api/v1/me/password",
    { schema: { body: passwordChangeBodySchema } },
    async (request, reply) => {
      if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

      const { currentPassword, newPassword } = request.body;

      const user = userManager.getByUsername(userManager.getById(request.auth.userId)!.username);
      if (!user) return reply.code(404).send({ error: "User not found" });

      const valid = await userManager.verifyPassword(user.passwordHash, currentPassword);
      if (!valid) return reply.code(401).send({ error: "Current password is incorrect" });

      await userManager.updatePassword(request.auth.userId, newPassword);
      // Spec 151 — defense in depth: a new password invalidates any browser
      // previously trusted to skip the MFA step.
      mfaService.revokeAllTrustedDevices(request.auth.userId);
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "user.password_change",
        targetType: "user",
        targetId: request.auth.userId,
        ip: request.ip,
      });
      return { success: true };
    },
  );

  // GET /api/v1/me/tokens — List my API tokens
  app.get("/api/v1/me/tokens", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    return authService.getUserApiTokens(request.auth.userId);
  });

  // POST /api/v1/me/tokens — Create API token
  app.post<{
    Body: { name: string; expiresAt?: string };
  }>("/api/v1/me/tokens", { schema: { body: createTokenBodySchema } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { name, expiresAt } = request.body;

    const result = authService.createApiToken(request.auth.userId, name, expiresAt ?? null);
    auditLogger.log({
      ...buildActor(request, userManager),
      action: "auth.api_token.create",
      targetType: "api_token",
      targetId: result.id ?? null,
      ip: request.ip,
      meta: { name, expiresAt: expiresAt ?? null },
    });
    return reply.code(201).send(result);
  });

  // DELETE /api/v1/me/tokens/:id — Revoke API token
  app.delete<{
    Params: { id: string };
  }>("/api/v1/me/tokens/:id", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const deleted = authService.deleteApiToken(request.params.id, request.auth.userId);
    if (!deleted) return reply.code(404).send({ error: "Token not found" });
    auditLogger.log({
      ...buildActor(request, userManager),
      action: "auth.api_token.delete",
      targetType: "api_token",
      targetId: request.params.id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });
}

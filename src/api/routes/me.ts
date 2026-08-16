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
  }>("/api/v1/me", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { displayName } = request.body ?? {};
    if (!displayName) return reply.code(400).send({ error: "displayName is required" });

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
  }>("/api/v1/me/preferences", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { preferences } = request.body ?? {};
    if (!preferences || typeof preferences !== "object") {
      return reply.code(400).send({ error: "preferences object is required" });
    }
    // Spec 151 — trusted-device duration is a stored preference, not a
    // per-request parameter: clamp here so a tampered/stale value can never
    // push a trusted-device expiry outside the allowed range.
    if (preferences.mfaTrustedDeviceDays !== undefined) {
      preferences.mfaTrustedDeviceDays = clampTrustedDeviceDays(preferences.mfaTrustedDeviceDays);
    }

    userManager.updatePreferences(request.auth.userId, preferences);
    const user = userManager.getById(request.auth.userId);
    return user;
  });

  // PUT /api/v1/me/password — Change password
  app.put<{
    Body: { currentPassword: string; newPassword: string };
  }>("/api/v1/me/password", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { currentPassword, newPassword } = request.body ?? {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return reply.code(400).send({ error: "Password must be at least 6 characters" });
    }

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
  });

  // GET /api/v1/me/tokens — List my API tokens
  app.get("/api/v1/me/tokens", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });
    return authService.getUserApiTokens(request.auth.userId);
  });

  // POST /api/v1/me/tokens — Create API token
  app.post<{
    Body: { name: string; expiresAt?: string };
  }>("/api/v1/me/tokens", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const { name, expiresAt } = request.body ?? {};
    if (!name) return reply.code(400).send({ error: "name is required" });

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

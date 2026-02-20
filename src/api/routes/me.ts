import type { FastifyInstance } from "fastify";
import type { AuthService } from "../../auth/auth-service.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { UserPreferences } from "../../shared/types.js";

interface MeDeps {
  authService: AuthService;
  userManager: UserManager;
  logger: Logger;
}

export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  const { authService, userManager } = deps;

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

    const user = userManager.getByUsername(
      userManager.getById(request.auth.userId)!.username,
    );
    if (!user) return reply.code(404).send({ error: "User not found" });

    const valid = await userManager.verifyPassword(user.passwordHash, currentPassword);
    if (!valid) return reply.code(401).send({ error: "Current password is incorrect" });

    await userManager.updatePassword(request.auth.userId, newPassword);
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
    return reply.code(201).send(result);
  });

  // DELETE /api/v1/me/tokens/:id — Revoke API token
  app.delete<{
    Params: { id: string };
  }>("/api/v1/me/tokens/:id", async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: "Not authenticated" });

    const deleted = authService.deleteApiToken(request.params.id, request.auth.userId);
    if (!deleted) return reply.code(404).send({ error: "Token not found" });
    return reply.code(204).send();
  });
}

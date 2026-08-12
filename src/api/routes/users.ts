import type { FastifyInstance } from "fastify";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import type { UserRole } from "../../shared/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { buildActor } from "../audit-context.js";
import { nonEmptyString } from "../schemas.js";

// Input schema (issue #452) for POST /users. Old guards: `!username ||
// !password || !displayName` (bare, no trim), `password.length < 6`, and an
// optional-role enum check. nonEmptyString matches the truthiness guards;
// password gets minLength 6. `role` is optional and enum-checked. The 409
// unique-username check and admin gating (onRequest hook) stay as-is, both
// running in the same order as before (403 hook -> body 400 -> 409). PUT /users
// is left hand-rolled: it returns 404 for an unknown id BEFORE its body check,
// which a body schema would flip to a 400.
const createUserBodySchema = {
  type: "object",
  required: ["username", "password", "displayName"],
  properties: {
    username: nonEmptyString,
    password: { type: "string", minLength: 6 },
    displayName: nonEmptyString,
    role: { enum: ["admin", "standard"] },
  },
};

interface UsersDeps {
  userManager: UserManager;
  auditLogger: AuditLogger;
  logger: Logger;
}

export function registerUserRoutes(app: FastifyInstance, deps: UsersDeps): void {
  const { userManager, auditLogger } = deps;

  // All user management routes require admin role
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/v1/users")) {
      requireAdmin(request, reply);
    }
  });

  // GET /api/v1/users — List all users
  app.get("/api/v1/users", async () => {
    return userManager.getAll();
  });

  // POST /api/v1/users — Create user
  app.post<{
    Body: {
      username: string;
      password: string;
      displayName: string;
      role: UserRole;
    };
  }>("/api/v1/users", { schema: { body: createUserBodySchema } }, async (request, reply) => {
    const { username, password, displayName, role } = request.body;

    // Check unique username
    if (userManager.getByUsername(username)) {
      return reply.code(409).send({ error: "Username already exists" });
    }

    const user = await userManager.createUser({
      username,
      password,
      displayName,
      role: role ?? "standard",
    });

    auditLogger.log({
      ...buildActor(request, userManager),
      action: "user.create",
      targetType: "user",
      targetId: user.id,
      ip: request.ip,
      meta: { username, role: role ?? "standard" },
    });

    return reply.code(201).send(user);
  });

  // PUT /api/v1/users/:id — Update user
  app.put<{
    Params: { id: string };
    Body: { displayName?: string; role?: UserRole; enabled?: boolean };
  }>("/api/v1/users/:id", async (request, reply) => {
    const existing = userManager.getById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "User not found" });

    const { displayName, role, enabled } = request.body ?? {};

    if (role && role !== "admin" && role !== "standard") {
      return reply.code(400).send({ error: "role must be 'admin' or 'standard'" });
    }

    // Prevent removing last admin
    if (existing.role === "admin" && role === "standard") {
      const allUsers = userManager.getAll();
      const adminCount = allUsers.filter((u) => u.role === "admin" && u.enabled).length;
      if (adminCount <= 1) {
        return reply.code(400).send({ error: "Cannot remove the last admin" });
      }
    }

    const updated = userManager.updateUser(request.params.id, {
      displayName: displayName ?? existing.displayName,
      role: role ?? existing.role,
      enabled: enabled ?? existing.enabled,
    });

    auditLogger.log({
      ...buildActor(request, userManager),
      action: "user.update",
      targetType: "user",
      targetId: request.params.id,
      ip: request.ip,
      meta: {
        username: existing.username,
        roleChange: role && role !== existing.role ? { from: existing.role, to: role } : undefined,
        enabledChange:
          enabled !== undefined && enabled !== existing.enabled
            ? { from: existing.enabled, to: enabled }
            : undefined,
        displayNameChanged: displayName !== undefined && displayName !== existing.displayName,
      },
    });

    return updated;
  });

  // DELETE /api/v1/users/:id — Delete user
  app.delete<{
    Params: { id: string };
  }>("/api/v1/users/:id", async (request, reply) => {
    const existing = userManager.getById(request.params.id);
    if (!existing) return reply.code(404).send({ error: "User not found" });

    // Prevent self-delete
    if (request.auth?.userId === request.params.id) {
      return reply.code(400).send({ error: "Cannot delete your own account" });
    }

    // Prevent deleting last admin
    if (existing.role === "admin") {
      const allUsers = userManager.getAll();
      const adminCount = allUsers.filter((u) => u.role === "admin" && u.enabled).length;
      if (adminCount <= 1) {
        return reply.code(400).send({ error: "Cannot delete the last admin" });
      }
    }

    userManager.deleteUser(request.params.id);
    auditLogger.log({
      ...buildActor(request, userManager),
      action: "user.delete",
      targetType: "user",
      targetId: request.params.id,
      ip: request.ip,
      meta: { username: existing.username, role: existing.role },
    });
    return reply.code(204).send();
  });
}

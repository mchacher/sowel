import type { FastifyInstance } from "fastify";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { UserRole } from "../../shared/types.js";
import { requireAdmin } from "../../auth/auth-middleware.js";

interface UsersDeps {
  userManager: UserManager;
  logger: Logger;
}

export function registerUserRoutes(app: FastifyInstance, deps: UsersDeps): void {
  const { userManager } = deps;

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
  }>("/api/v1/users", async (request, reply) => {
    const { username, password, displayName, role } = request.body ?? {};

    if (!username || !password || !displayName) {
      return reply.code(400).send({ error: "username, password, and displayName are required" });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: "Password must be at least 6 characters" });
    }
    if (role && role !== "admin" && role !== "standard") {
      return reply.code(400).send({ error: "role must be 'admin' or 'standard'" });
    }

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
    return reply.code(204).send();
  });
}

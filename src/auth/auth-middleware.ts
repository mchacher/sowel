import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthService, JwtPayload } from "./auth-service.js";
import type { UserManager } from "./user-manager.js";
import type { Logger } from "../core/logger.js";

// ============================================================
// Augment Fastify request with auth info
// ============================================================

declare module "fastify" {
  interface FastifyRequest {
    auth?: JwtPayload;
  }
}

// ============================================================
// Public routes that don't require authentication
// ============================================================

const PUBLIC_ROUTES = new Set([
  "/api/v1/auth/status",
  "/api/v1/auth/setup",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/health",
]);

function isPublicRoute(url: string): boolean {
  // Strip query string
  const path = url.split("?")[0];
  return PUBLIC_ROUTES.has(path);
}

// ============================================================
// Register auth middleware
// ============================================================

export function registerAuthMiddleware(
  app: FastifyInstance,
  deps: {
    authService: AuthService;
    userManager: UserManager;
    logger: Logger;
  },
): void {
  const { authService, userManager } = deps;

  app.addHook("onRequest", async (request, reply) => {
    // Skip auth for public routes and WebSocket upgrade
    if (isPublicRoute(request.url)) return;
    if (request.url.startsWith("/ws")) return; // WS auth handled separately

    // Setup mode: if no users exist, only setup endpoint is allowed
    if (!userManager.hasUsers()) {
      if (request.url !== "/api/v1/auth/setup") {
        return reply.code(403).send({ error: "Setup required", setupRequired: true });
      }
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const token = authHeader.slice(7);

    try {
      let payload: JwtPayload;

      if (token.startsWith("swl_") || token.startsWith("wch_") || token.startsWith("cbl_")) {
        // API token (swl_ = current, wch_ and cbl_ = legacy)
        const result = authService.verifyApiToken(token);
        if (!result) {
          return reply.code(401).send({ error: "Invalid API token" });
        }
        payload = result;
      } else {
        // JWT
        payload = authService.verifyAccessToken(token);
      }

      request.auth = payload;
    } catch {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
  });
}

// ============================================================
// Role guard helper
// ============================================================

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): void {
  if (!request.auth || request.auth.role !== "admin") {
    reply.code(403).send({ error: "Admin access required" });
  }
}

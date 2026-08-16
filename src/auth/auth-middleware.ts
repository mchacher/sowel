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
    /** Spec 113: how the request was authenticated. Used by the audit logger. */
    tokenKind?: "jwt" | "api_token";
  }
}

// ============================================================
// Public routes that don't require authentication
// ============================================================

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  "/api/v1/auth/status",
  "/api/v1/auth/setup",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/health",
  // Spec 151 — authenticated via `mfaToken` in the body, not a bearer header.
  "/api/v1/auth/mfa/verify",
]);

export function isPublicRoute(url: string): boolean {
  // Strip query string
  const path = url.split("?")[0];
  if (PUBLIC_ROUTES.has(path)) return true;
  // OAuth callbacks from external providers (no auth header available)
  if (path.match(/^\/api\/v1\/plugins\/[^/]+\/oauth\/callback$/)) return true;
  return false;
}

// ============================================================
// Role gate (spec 131): config is admin-only, standard = usage
// ============================================================

const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * (method, path) templates a `standard` user is allowed to mutate. Everything
 * else that mutates is admin-only — the gate is fail-closed, so a new mutating
 * endpoint is admin-only until it is explicitly added here.
 */
const STANDARD_WRITE_ALLOWLIST: ReadonlyArray<{ method: string; re: RegExp }> = [
  // Usage: actuate an equipment / run a zone command
  { method: "POST", re: /^\/api\/v1\/equipments\/[^/]+\/orders\/[^/]+$/ },
  { method: "POST", re: /^\/api\/v1\/zones\/[^/]+\/orders\/[^/]+$/ },
  // Personal: own account, preferences, password, own API tokens
  { method: "PUT", re: /^\/api\/v1\/me$/ },
  { method: "PUT", re: /^\/api\/v1\/me\/preferences$/ },
  { method: "PUT", re: /^\/api\/v1\/me\/password$/ },
  { method: "POST", re: /^\/api\/v1\/me\/tokens$/ },
  { method: "DELETE", re: /^\/api\/v1\/me\/tokens\/[^/]+$/ },
  // Personal: own push-notification subscription
  { method: "POST", re: /^\/api\/v1\/push\/subscriptions$/ },
  { method: "DELETE", re: /^\/api\/v1\/push\/subscriptions$/ },
  // Personal: end own session
  { method: "POST", re: /^\/api\/v1\/auth\/logout$/ },
  // Personal: own MFA enrollment/management (spec 151)
  { method: "POST", re: /^\/api\/v1\/me\/mfa\/totp\/setup$/ },
  { method: "POST", re: /^\/api\/v1\/me\/mfa\/totp\/confirm$/ },
  { method: "DELETE", re: /^\/api\/v1\/me\/mfa\/totp$/ },
  { method: "POST", re: /^\/api\/v1\/me\/mfa\/backup-codes\/regenerate$/ },
  { method: "DELETE", re: /^\/api\/v1\/me\/mfa\/trusted-devices\/[^/]+$/ },
];

/** True if a non-admin (`standard`) may perform this mutating request. */
export function isStandardWriteAllowed(method: string, path: string): boolean {
  return STANDARD_WRITE_ALLOWLIST.some((e) => e.method === method && e.re.test(path));
}

/** Whether a request must pass the admin-only gate given its method + role. */
export function isMutationDeniedForStandard(
  method: string,
  path: string,
  role: string | undefined,
): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return false;
  if (role === "admin") return false;
  return !isStandardWriteAllowed(method.toUpperCase(), path);
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
    // Skip auth for static UI files, public routes and WebSocket upgrade
    if (!request.url.startsWith("/api/")) return;
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
        request.tokenKind = "api_token";
      } else {
        // JWT
        payload = authService.verifyAccessToken(token);
        request.tokenKind = "jwt";
      }

      request.auth = payload;
    } catch {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }

    // Role gate (spec 131): a non-admin may only run the allowlisted usage
    // mutations (actuate + own account); every other write is admin-only.
    if (
      isMutationDeniedForStandard(request.method, request.url.split("?")[0], request.auth?.role)
    ) {
      return reply.code(403).send({ error: "Admin access required" });
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

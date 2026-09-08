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
  // Issue #912 — spec 131 classified modes as configuration wholesale, which
  // conflated two things: what a mode DOES (its name, its zone impacts — still
  // admin-only, and nothing below touches that) and WHEN it is on. The second
  // is runtime state, changed several times a day, and a standard user was
  // already trusted with the comparable act one line above: a zone command
  // that turns every light in the house off.
  //
  // Read this before adding to the list: activating is NOT a pure actuation.
  // `ModeManager.executeImpact` also runs `recipe_toggle` and `recipe_params`
  // actions, which durably enable/disable a recipe instance and rewrite its
  // params — writes a standard user is refused directly, and that deactivating
  // the mode does not undo. What makes it acceptable is that an ADMIN authored
  // those impacts: the standard user chooses when the mode runs, never what it
  // does. The same delegation already existed unguarded through the calendar
  // (cron) and through a physical button bound to a mode, neither of which
  // carries a role at all. Gating recipe actions by the activator's role was
  // the alternative and it is worse: the same mode would half-apply depending
  // on who pressed it, which is exactly the inconsistency automation must not
  // have.
  { method: "POST", re: /^\/api\/v1\/modes\/[^/]+\/activate$/ },
  { method: "POST", re: /^\/api\/v1\/modes\/[^/]+\/deactivate$/ },
  // `applyModeToZone` runs one zone's impacts and does not touch the active
  // flag, so it is narrower than `activate` in reach while carrying the same
  // delegation. Allowing `activate` and refusing this would permit the wider
  // act and deny the narrower one.
  { method: "POST", re: /^\/api\/v1\/modes\/[^/]+\/apply-to-zone\/[^/]+$/ },
  // Spec 174 — a timed command is an ordinary actuation with a deadline on it,
  // and the surfaces that offer it (the Home row, the Dashboard tile) render
  // for every user. What a standard user may already do outright, they may do
  // for fifteen minutes. Configuring WHICH command stays admin-only: that is a
  // PUT on the equipment.
  { method: "POST", re: /^\/api\/v1\/equipments\/[^/]+\/timed-action$/ },
  { method: "DELETE", re: /^\/api\/v1\/equipments\/[^/]+\/timed-action$/ },
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

/**
 * The request path a route hook must compare against: query string removed and
 * percent-decoding applied ONCE, which is exactly what the router does.
 *
 * `request.url` is the raw request target. find-my-way decodes it before
 * matching, so `/api/v1/%62ackup` reaches the `/api/v1/backup` handler while a
 * hook comparing the raw string sees a path it does not recognise and lets the
 * request through ungated. Every admin gate bound to a URL prefix was written
 * against `request.url` and was bypassable that way.
 *
 * One decode, not a loop: the router decodes once too, so `/api/v1/%2562ackup`
 * decodes to `/api/v1/%62ackup` here and 404s at the router. Decoding until
 * stable would make this function see a path the router never will.
 *
 * A malformed sequence (`%zz`) throws; the raw path is then the honest answer,
 * and the router will not match it either.
 */
export function decodedPath(request: FastifyRequest): string {
  const raw = request.url.split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** True when the decoded path is exactly `path`. */
export function pathIs(request: FastifyRequest, path: string): boolean {
  return decodedPath(request) === path;
}

/** True when the decoded path is `base` or sits under `base/`. */
export function pathIsUnder(request: FastifyRequest, base: string): boolean {
  const path = decodedPath(request);
  return path === base || path.startsWith(base + "/");
}

import type { FastifyInstance } from "fastify";
import type { AuthService } from "../../auth/auth-service.js";
import { AuthError } from "../../auth/auth-service.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { Logger } from "../../core/logger.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import { nonEmptyString } from "../schemas.js";

// Input schemas (issue #452 / #482). login/refresh had bare `!x` guards (no
// trim), so nonEmptyString matches. /auth/setup is schema-validated too (#482):
// its "already completed" 403 precondition would be flipped to a 400 by a body
// schema, so that check runs in a preValidation hook (before schema validation).
// /auth/logout stays hand-rolled: it has no required field.
const loginBodySchema = {
  type: "object",
  required: ["username", "password"],
  properties: {
    username: nonEmptyString,
    password: nonEmptyString,
    // Spec 151 — opaque token proving this browser was previously trusted;
    // skips the MFA step when it matches a live mfa_trusted_devices row.
    trustedDeviceToken: { type: "string" },
  },
};

const refreshBodySchema = {
  type: "object",
  required: ["refreshToken"],
  properties: { refreshToken: nonEmptyString },
};

// First-run admin creation. `password` min length 6 reproduces the old
// `!password || password.length < 6`; username/displayName use nonEmptyString
// (old bare `!x`). `language` is an optional string (old took it verbatim,
// defaulting to "fr"); only a non-string language, which was never valid, is
// newly rejected.
const setupBodySchema = {
  type: "object",
  required: ["username", "password", "displayName"],
  properties: {
    username: nonEmptyString,
    password: { type: "string", minLength: 6 },
    displayName: nonEmptyString,
    language: { type: "string" },
  },
};

interface AuthDeps {
  authService: AuthService;
  userManager: UserManager;
  auditLogger: AuditLogger;
  logger: Logger;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const { authService, userManager, auditLogger } = deps;

  // GET /api/v1/auth/status — Check if setup is required
  app.get("/api/v1/auth/status", async () => {
    return { setupRequired: !userManager.hasUsers() };
  });

  // POST /api/v1/auth/setup — Create first admin user (first-run only)
  app.post<{
    Body: { username: string; password: string; displayName: string; language?: "fr" | "en" };
  }>(
    "/api/v1/auth/setup",
    {
      // The "already completed" 403 must beat the body 400, so it runs before
      // schema validation (issue #482).
      preValidation: async (_request, reply) => {
        if (userManager.hasUsers()) {
          reply.code(403).send({ error: "Setup already completed" });
        }
      },
      schema: { body: setupBodySchema },
    },
    async (request, reply) => {
      const { username, password, displayName, language } = request.body;

      await userManager.createUser({
        username,
        password,
        displayName,
        role: "admin",
        preferences: { language: language ?? "fr" },
      });

      // Auto-login after setup
      const tokens = await authService.login(username, password);
      return reply.code(201).send(tokens);
    },
  );

  // POST /api/v1/auth/login (stricter rate limit: 10 req/min)
  app.post<{
    Body: { username: string; password: string; trustedDeviceToken?: string };
  }>(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: loginBodySchema },
    },
    async (request, reply) => {
      const { username, password, trustedDeviceToken } = request.body;

      try {
        // Spec 151 — may return an MfaChallenge instead of full tokens when
        // the account has TOTP enabled and no valid trusted device is presented.
        const result = await authService.login(username, password, trustedDeviceToken);
        const user = userManager.getByUsername(username);
        auditLogger.log({
          actorKind: "user",
          actorUserId: user?.id ?? null,
          actorLabel: username,
          action: "auth.login.success",
          targetType: "user",
          targetId: user?.id ?? null,
          ip: request.ip,
        });
        return result;
      } catch (err) {
        auditLogger.log({
          actorKind: "user",
          actorLabel: username,
          action: "auth.login.failure",
          ip: request.ip,
          meta: { reason: err instanceof Error ? err.message : "unknown" },
        });
        if (err instanceof AuthError) {
          return reply.code(err.status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/auth/refresh
  app.post<{
    Body: { refreshToken: string };
  }>("/api/v1/auth/refresh", { schema: { body: refreshBodySchema } }, async (request, reply) => {
    const { refreshToken } = request.body;

    try {
      const tokens = await authService.refresh(refreshToken);
      return tokens;
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/auth/logout
  app.post<{
    Body: { refreshToken: string };
  }>("/api/v1/auth/logout", async (request, reply) => {
    const { refreshToken } = request.body ?? {};
    if (refreshToken) {
      authService.logout(refreshToken);
    }
    if (request.auth) {
      const user = userManager.getById(request.auth.userId);
      auditLogger.log({
        actorKind: request.tokenKind === "api_token" ? "api_token" : "user",
        actorUserId: request.auth.userId,
        actorLabel: user?.username ?? request.auth.userId,
        action: "auth.logout",
        ip: request.ip,
      });
    }
    return reply.code(204).send();
  });
}

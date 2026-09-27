import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import { pathIsUnder, requireAdmin } from "../../auth/auth-middleware.js";
import type { SharedAccessManager } from "../../shared-access/shared-access-manager.js";
import { SharedAccessError } from "../../shared-access/validity.js";
import {
  GUEST_CSS,
  GUEST_HTML,
  GUEST_ICON,
  GUEST_JS,
  GUEST_MANIFEST,
  GUEST_PAGE_CSP,
} from "../../shared-access/guest-page.js";

// ============================================================
// Spec 181 — the shared-access routes.
//
//   /api/v1/shared-access/*         the owner's, admin-only (R7, R8, R9)
//   /api/v1/shared-access/public/*  the phone's, no session (R5)
//   /access/                        the visitor's page, and `/access/api/*`, the
//                                   same public routes under the page, so an
//                                   alias host rewriting to `/access/` needs no
//                                   second rule
//
// While the setting is off, every one of them answers exactly what an unknown
// route answers (R1.2): the feature cannot be probed from outside.
// ============================================================

interface SharedAccessRouteDeps {
  sharedAccessManager: SharedAccessManager;
  userManager: UserManager;
  logger: Logger;
}

const ADMIN_BASE = "/api/v1/shared-access";
const PUBLIC_BASE = "/api/v1/shared-access/public";
const PAGE_BASE = "/access";
/** R5.17 — no per-IP limit on the public surface; R6 governs failures. */
const NO_RATE_LIMIT = { config: { rateLimit: false } } as const;

function actorOf(request: FastifyRequest, userManager: UserManager): string {
  if (!request.auth) return "system";
  return userManager.getById(request.auth.userId)?.username ?? request.auth.userId;
}

function sendError(reply: FastifyReply, err: unknown, logger: Logger): FastifyReply {
  if (err instanceof SharedAccessError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message });
  }
  logger.error({ err }, "Shared access route failed");
  return reply.code(500).send({ error: "internal_error" });
}

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  return header && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function registerSharedAccessRoutes(
  app: FastifyInstance,
  deps: SharedAccessRouteDeps,
): void {
  const { sharedAccessManager: manager, userManager } = deps;
  const logger = deps.logger.child({ module: "shared-access-routes" });

  // Off → the same answer as an unknown route, for all three surfaces. The
  // owner's routes are admin-only, reads included: the lines carry codes.
  app.addHook("onRequest", async (request, reply) => {
    const onAdmin = pathIsUnder(request, ADMIN_BASE);
    const onPage = pathIsUnder(request, PAGE_BASE);
    if (!onAdmin && !onPage) return;
    if (!manager.isEnabled()) {
      // An anonymous request on an unknown /api route meets the auth
      // middleware's 401; the public API must not answer differently, or the
      // build could be told apart from one without shared access.
      if (pathIsUnder(request, PUBLIC_BASE)) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      reply.callNotFound();
      return reply;
    }
    if (onAdmin && !pathIsUnder(request, PUBLIC_BASE)) requireAdmin(request, reply);
    if (onPage || pathIsUnder(request, PUBLIC_BASE)) {
      reply.header("Cache-Control", "no-store");
      reply.header("X-Robots-Tag", "noindex, nofollow");
    }
  });

  // ── Owner (admin) ────────────────────────────────────────────

  app.get(`${ADMIN_BASE}/state`, async () => manager.getState());

  app.get<{ Querystring: { accessId?: string; limit?: string } }>(
    `${ADMIN_BASE}/journal`,
    async (request) => ({
      entries: manager.listJournal(
        request.query.accessId ?? null,
        request.query.limit ? Number(request.query.limit) || 200 : 200,
      ),
    }),
  );

  app.post<{ Body: Record<string, unknown> }>(`${ADMIN_BASE}/accesses`, async (request, reply) => {
    try {
      return reply
        .code(201)
        .send(manager.createAccess(request.body ?? {}, actorOf(request, userManager)));
    } catch (err) {
      return sendError(reply, err, logger);
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${ADMIN_BASE}/accesses/:id`,
    async (request, reply) => {
      try {
        return manager.updateAccess(
          request.params.id,
          request.body ?? {},
          actorOf(request, userManager),
        );
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  for (const action of ["suspend", "resume", "revoke"] as const) {
    app.post<{ Params: { id: string } }>(
      `${ADMIN_BASE}/accesses/:id/${action}`,
      async (request, reply) => {
        try {
          return manager[action](request.params.id, actorOf(request, userManager));
        } catch (err) {
          return sendError(reply, err, logger);
        }
      },
    );
  }

  app.post<{ Params: { id: string }; Body: { cutPhones?: boolean } }>(
    `${ADMIN_BASE}/accesses/:id/code`,
    async (request, reply) => {
      try {
        return manager.changeCode(
          request.params.id,
          request.body?.cutPhones === true,
          actorOf(request, userManager),
        );
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(`${ADMIN_BASE}/accesses/:id`, async (request, reply) => {
    try {
      manager.deleteAccess(request.params.id, actorOf(request, userManager));
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, err, logger);
    }
  });

  app.get<{ Params: { id: string } }>(`${ADMIN_BASE}/equipment/:id`, async (request) =>
    manager.gatePanel(request.params.id),
  );

  app.put<{ Params: { id: string }; Body: { armed?: unknown } }>(
    `${ADMIN_BASE}/equipment/:id`,
    async (request, reply) => {
      if (typeof request.body?.armed !== "boolean") {
        return reply.code(400).send({ error: "armed_required" });
      }
      try {
        return manager.setArmed(
          request.params.id,
          request.body.armed,
          actorOf(request, userManager),
        );
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  app.get(`${ADMIN_BASE}/profiles`, async () => ({ profiles: manager.getState().profiles }));

  app.post<{ Body: Record<string, unknown> }>(`${ADMIN_BASE}/profiles`, async (request, reply) => {
    try {
      return reply.code(201).send(manager.createProfile(request.body ?? {}));
    } catch (err) {
      return sendError(reply, err, logger);
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    `${ADMIN_BASE}/profiles/:id`,
    async (request, reply) => {
      try {
        return manager.updateProfile(request.params.id, request.body ?? {});
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(`${ADMIN_BASE}/profiles/:id`, async (request, reply) => {
    try {
      manager.deleteProfile(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, err, logger);
    }
  });

  // ── The phone (public) ───────────────────────────────────────

  for (const base of [PUBLIC_BASE, `${PAGE_BASE}/api`]) {
    app.post<{ Body: { code?: unknown; link?: unknown } }>(
      `${base}/enrol`,
      NO_RATE_LIMIT,
      async (request, reply) => {
        try {
          const result = await manager.enrol(
            request.body ?? {},
            String(request.headers["user-agent"] ?? ""),
          );
          if (result.ok) return { token: result.token, session: result.session };
          const status =
            result.error === "too_many"
              ? 429
              : result.error === "ended"
                ? 410
                : result.error === "too_many_phones"
                  ? 409
                  : 401;
          return reply.code(status).send({ error: result.error });
        } catch (err) {
          return sendError(reply, err, logger);
        }
      },
    );

    app.get(`${base}/session`, NO_RATE_LIMIT, async (request, reply) => {
      try {
        const session = manager.session(bearer(request));
        if (!session) return reply.code(401).send({ error: "unknown_phone" });
        return session;
      } catch (err) {
        return sendError(reply, err, logger);
      }
    });

    app.post<{ Body: { gate?: unknown } }>(
      `${base}/open`,
      NO_RATE_LIMIT,
      async (request, reply) => {
        const gate = typeof request.body?.gate === "string" ? request.body.gate : "";
        try {
          const result = await manager.open(bearer(request), gate);
          if (!result) return reply.code(401).send({ error: "unknown_phone" });
          return result.ok ? result : reply.code(409).send(result);
        } catch (err) {
          return sendError(reply, err, logger);
        }
      },
    );
  }

  // ── The page (R5.17) ─────────────────────────────────────────

  const asset = (type: string, body: string) => async (_req: FastifyRequest, reply: FastifyReply) =>
    reply
      .type(type)
      .header("Content-Security-Policy", GUEST_PAGE_CSP)
      .header("X-Content-Type-Options", "nosniff")
      .send(body);

  app.get(PAGE_BASE, NO_RATE_LIMIT, async (_request, reply) => reply.redirect(`${PAGE_BASE}/`));
  app.get(`${PAGE_BASE}/`, NO_RATE_LIMIT, asset("text/html; charset=utf-8", GUEST_HTML));
  app.get(`${PAGE_BASE}/app.js`, NO_RATE_LIMIT, asset("text/javascript; charset=utf-8", GUEST_JS));
  app.get(`${PAGE_BASE}/style.css`, NO_RATE_LIMIT, asset("text/css; charset=utf-8", GUEST_CSS));
  app.get(
    `${PAGE_BASE}/manifest.webmanifest`,
    NO_RATE_LIMIT,
    asset("application/manifest+json; charset=utf-8", GUEST_MANIFEST),
  );
  app.get(`${PAGE_BASE}/icon.svg`, NO_RATE_LIMIT, asset("image/svg+xml", GUEST_ICON));
}

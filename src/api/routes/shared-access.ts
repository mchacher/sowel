import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import QRCode from "qrcode";
import type { Logger } from "../../core/logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import { pathIsUnder, requireAdmin, verifyBearerToken } from "../../auth/auth-middleware.js";
import type { AuthService } from "../../auth/auth-service.js";
import type { SharedAccessManager } from "../../shared-access/shared-access-manager.js";
import { SharedAccessError } from "../../shared-access/validity.js";
import {
  GUEST_CSS,
  GUEST_JS,
  GUEST_PAGE_CSP,
  guestHtml,
  guestManifest,
} from "../../shared-access/guest-page.js";
import type { AppBrandingInput } from "../../shared-access/app-branding.js";

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
  /** To answer, while off, exactly what the auth middleware answers (R1.2). */
  authService?: AuthService;
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
      // A request on an unknown /api route meets the auth middleware first;
      // the public API must answer what it would, bearer or not, or the build
      // could be told apart from one without shared access.
      if (pathIsUnder(request, PUBLIC_BASE)) {
        const header = request.headers.authorization;
        if (!header || !header.startsWith("Bearer ")) {
          return reply.code(401).send({ error: "Authentication required" });
        }
        const result = deps.authService
          ? verifyBearerToken(header.slice(7), deps.authService)
          : ({ ok: false, reason: "invalid_token" } as const);
        if (!result.ok) {
          const error =
            result.reason === "invalid_api_token"
              ? "Invalid API token"
              : "Invalid or expired token";
          return reply.code(401).send({ error });
        }
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

  app.get<{ Params: { id: string } }>(
    `${ADMIN_BASE}/accesses/:id/phones`,
    async (request, reply) => {
      try {
        return { phones: manager.listPhones(request.params.id) };
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  app.delete<{ Params: { id: string; phoneId: string } }>(
    `${ADMIN_BASE}/accesses/:id/phones/:phoneId`,
    async (request, reply) => {
      try {
        manager.cutPhone(request.params.id, request.params.phoneId, actorOf(request, userManager));
        return reply.code(204).send();
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

    // R5.22 — the link as a QR code, drawn here: the page stays free of any
    // library, and its CSP already admits a `data:` image.
    app.get(`${base}/share`, NO_RATE_LIMIT, async (request, reply) => {
      try {
        const share = manager.shareLink(bearer(request));
        if (!share) return reply.code(401).send({ error: "unknown_phone" });
        if ("error" in share) return reply.code(409).send(share);
        const svg = await QRCode.toString(share.url, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
        return reply.header("Cache-Control", "no-store").send({
          url: share.url,
          qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        });
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

  // ── The page as an app (R5.24) ───────────────────────────────

  app.get(`${ADMIN_BASE}/app`, async () => manager.branding.view());

  app.put<{ Body: AppBrandingInput }>(
    `${ADMIN_BASE}/app`,
    // Three PNGs in base64, 256 KiB each at most.
    { bodyLimit: 1024 * 1024 + 64 * 1024 },
    async (request, reply) => {
      try {
        const view = manager.branding.update(request.body ?? {});
        logger.info(
          { actor: actorOf(request, userManager), customIcon: view.customIcon },
          "Shared access app updated",
        );
        return view;
      } catch (err) {
        return sendError(reply, err, logger);
      }
    },
  );

  // ── The page (R5.17) ─────────────────────────────────────────

  const asset =
    (type: string, body: () => string | Buffer) =>
    async (_req: FastifyRequest, reply: FastifyReply) =>
      reply
        .type(type)
        .header("Content-Security-Policy", GUEST_PAGE_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .send(body());

  const branding = () => ({
    name: manager.branding.name(),
    version: manager.branding.version(),
  });

  app.get(PAGE_BASE, NO_RATE_LIMIT, async (_request, reply) => reply.redirect(`${PAGE_BASE}/`));
  app.get(
    `${PAGE_BASE}/`,
    NO_RATE_LIMIT,
    asset("text/html; charset=utf-8", () => guestHtml(branding())),
  );
  app.get(
    `${PAGE_BASE}/app.js`,
    NO_RATE_LIMIT,
    asset("text/javascript; charset=utf-8", () => GUEST_JS),
  );
  app.get(
    `${PAGE_BASE}/style.css`,
    NO_RATE_LIMIT,
    asset("text/css; charset=utf-8", () => GUEST_CSS),
  );
  app.get(
    `${PAGE_BASE}/manifest.webmanifest`,
    NO_RATE_LIMIT,
    asset("application/manifest+json; charset=utf-8", () => guestManifest(branding())),
  );
  // R5.24 — the home-screen icons: 180 px for iOS, 192 and 512 for Android.
  for (const [file, size] of [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const) {
    app.get(
      `${PAGE_BASE}/${file}`,
      NO_RATE_LIMIT,
      asset("image/png", () => manager.branding.icon(size)),
    );
  }
}

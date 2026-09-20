import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import type { PackageManager } from "../../packages/package-manager.js";
import type { PluginLoader } from "../../plugins/plugin-loader.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { PluginHttpRequest, PluginHttpResponse } from "../../shared/types.js";
import { publicTreeSettingKey } from "../../shared/constants.js";
import { buildActor } from "../audit-context.js";

// ============================================================
// Spec 180 — the two surfaces a plugin may serve
//
//   /api/v1/plugins/:id/page/*   admin-authenticated, for the plugin's own page
//   /plugin-ui/:id/*             the page's static assets
//   /p/:id/*                     anonymous, opt-in twice, rate-limited
//
// Everything here is plumbing on purpose. The core decides WHO may call and
// HOW MUCH they may say; what the call means is the plugin's business, and the
// core never parses it.
// ============================================================

interface PluginSurfaceDeps {
  pluginLoader: PluginLoader;
  packageManager: PackageManager;
  integrationRegistry: IntegrationRegistry;
  settingsManager: SettingsManager;
  auditLogger: AuditLogger;
  userManager: UserManager;
  logger: Logger;
}

/**
 * Response headers a plugin may set.
 *
 * `set-cookie` is deliberately absent. A cookie set here would live on Sowel's
 * own origin, be sent to every core route by the browser, and outlive the
 * plugin that set it. A plugin that needs to recognise a returning caller
 * hands out a token and reads it back from `authorization` — which costs it one
 * header and costs the core nothing to reason about.
 */
export const PLUGIN_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "cache-control",
  "content-disposition",
  "content-language",
  "content-security-policy",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "retry-after",
  "x-robots-tag",
]);

/**
 * Request headers a plugin is handed.
 *
 * An allowlist rather than a pass-through: the admin surface carries the
 * caller's bearer token, and a plugin has no business reading a credential the
 * core already verified. `authorization` reaches the PUBLIC surface only, where
 * it is the plugin's own token and nothing else exists to carry it.
 */
const PAGE_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "user-agent"];
const PUBLIC_REQUEST_HEADERS = [...PAGE_REQUEST_HEADERS, "authorization"];

/** How long a plugin may take. The public one is longer because a call there
 *  may legitimately wait on the house (an order dispatched to an equipment and
 *  its answer), which the admin page never does. */
const PAGE_TIMEOUT_MS = 15_000;
const PUBLIC_TIMEOUT_MS = 30_000;

/** Static file types the plugin-ui tree serves. Anything else is a 404: a
 *  plugin's page needs these and a list that grows on demand is a list someone
 *  reviews. */
const ASSET_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

class PluginCallTimeout extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PluginCallTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pickHeaders(request: FastifyRequest, allowed: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of allowed) {
    const value = request.headers[name];
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

/** The path under the plugin's own root, always starting with a slash. */
function subPath(params: Record<string, unknown>): string {
  const raw = typeof params["*"] === "string" ? params["*"] : "";
  return `/${raw.replace(/^\/+/, "")}`;
}

/**
 * Property names that must never be written from a query string.
 *
 * The keys here are whatever the caller typed after the `?`, and the plugin
 * receiving the map will read it by name. `__proto__` on a plain object is
 * swallowed by the setter rather than stored, and `constructor` / `prototype`
 * shadow what a plugin may legitimately expect to find — so the honest answer
 * is to drop all three rather than hand over a map that lies.
 */
const UNSAFE_QUERY_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function queryOf(request: FastifyRequest): Record<string, string> {
  // A null-prototype map, like the settings route does with a request body:
  // nothing inherited can be mistaken for something the caller sent.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  const query = (request.query ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(query)) {
    if (UNSAFE_QUERY_KEYS.has(key)) continue;
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
  }
  return out;
}

/**
 * Turn what the plugin answered into an HTTP response.
 *
 * `undefined` means the plugin threw: `wrapPluginMethods` (spec 111) already
 * logged it with the plugin's id and degraded the call, so what is left to do
 * here is answer 500 without echoing anything of it back to the caller.
 */
function sendPluginResponse(
  reply: FastifyReply,
  answer: PluginHttpResponse | undefined,
  logger: Logger,
  context: { pluginId: string; path: string },
): FastifyReply {
  if (!answer) {
    return reply.code(500).send({ error: "Plugin failed to answer" });
  }

  const status =
    typeof answer.status === "number" && answer.status >= 100 && answer.status <= 599
      ? Math.trunc(answer.status)
      : 200;

  for (const [name, value] of Object.entries(answer.headers ?? {})) {
    const lower = name.toLowerCase();
    if (!PLUGIN_RESPONSE_HEADERS.has(lower)) {
      logger.warn({ ...context, header: lower }, "Plugin response header refused");
      continue;
    }
    if (typeof value === "string") reply.header(lower, value);
  }

  if (answer.contentType) reply.header("content-type", answer.contentType);

  const body = answer.body;
  if (body === undefined || body === null) return reply.code(status).send();

  if (typeof body === "string" || Buffer.isBuffer(body)) {
    if (!answer.contentType && !reply.getHeader("content-type")) {
      reply.header("content-type", "text/plain; charset=utf-8");
    }
    return reply.code(status).send(body);
  }

  return reply.code(status).send(body);
}

export function registerPluginSurfaceRoutes(app: FastifyInstance, deps: PluginSurfaceDeps): void {
  const {
    pluginLoader,
    packageManager,
    integrationRegistry,
    settingsManager,
    auditLogger,
    userManager,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "plugin-surface" });

  const adminOnly = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.auth || request.auth.role !== "admin") {
      await reply.code(403).send({ error: "Admin access required" });
    }
  };

  // ── The plugin's own page ────────────────────────────────────────────

  // GET /api/v1/plugins/pages — what the sidebar offers
  app.get("/api/v1/plugins/pages", { preValidation: adminOnly }, async () =>
    pluginLoader.getPages(),
  );

  // ALL /api/v1/plugins/:pluginId/page/* — the page's API, admin only
  app.route<{ Params: { pluginId: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/v1/plugins/:pluginId/page/*",
    preValidation: adminOnly,
    handler: async (request, reply) => {
      const { pluginId } = request.params;
      const plugin = integrationRegistry.getById(pluginId);
      if (!plugin?.handlePageRequest) {
        return reply.code(404).send({ error: "Plugin serves no page" });
      }

      const user = request.auth
        ? {
            id: request.auth.userId,
            username: userManager.getById(request.auth.userId)?.username ?? request.auth.userId,
            role: request.auth.role,
          }
        : undefined;

      const call: PluginHttpRequest = {
        method: request.method,
        path: subPath(request.params as unknown as Record<string, unknown>),
        query: queryOf(request),
        headers: pickHeaders(request, PAGE_REQUEST_HEADERS),
        body: request.body ?? null,
        ip: request.ip,
        user,
      };

      try {
        const answer = await withTimeout(plugin.handlePageRequest(call), PAGE_TIMEOUT_MS);
        return sendPluginResponse(reply, answer, logger, { pluginId, path: call.path });
      } catch (err) {
        if (err instanceof PluginCallTimeout) {
          logger.error({ pluginId, path: call.path }, "Plugin page call timed out");
          return reply.code(504).send({ error: "Plugin did not answer in time" });
        }
        logger.error({ err, pluginId, path: call.path }, "Plugin page call failed");
        return reply.code(500).send({ error: "Plugin failed to answer" });
      }
    },
  });

  // GET /plugin-ui/:pluginId/* — the page's static assets.
  //
  // Unauthenticated, and that is the right call: these are the plugin's own
  // JavaScript and stylesheets, the same bytes anyone can read in its public
  // repository. What they display is behind the admin API above.
  app.get<{ Params: { pluginId: string; "*": string } }>(
    "/plugin-ui/:pluginId/*",
    async (request, reply) => {
      const { pluginId } = request.params;

      let pkgDir: string;
      try {
        pkgDir = packageManager.getPackageDir(pluginId);
      } catch {
        return reply.code(404).send({ error: "Not found" });
      }

      const pkg = packageManager.getById(pluginId);
      const entry = pkg?.manifest.ui?.entry;
      if (!pkg?.enabled || !entry) return reply.code(404).send({ error: "Not found" });

      // Only the directory the entry lives in is served. The rest of the
      // package — its manifest, its `dist/`, whatever a release happens to
      // ship — is not part of the page.
      const uiRoot = resolve(pkgDir, dirname(entry.replace(/^\/+/, "")));
      if (uiRoot !== pkgDir && !uiRoot.startsWith(pkgDir + sep)) {
        return reply.code(404).send({ error: "Not found" });
      }

      const rel = (typeof request.params["*"] === "string" ? request.params["*"] : "").replace(
        /^\/+/,
        "",
      );
      const file = resolve(uiRoot, rel);
      if (!file.startsWith(uiRoot + sep)) return reply.code(404).send({ error: "Not found" });

      const contentType = ASSET_CONTENT_TYPES[extname(file).toLowerCase()];
      if (!contentType) return reply.code(404).send({ error: "Not found" });
      if (!existsSync(file) || !statSync(file).isFile()) {
        return reply.code(404).send({ error: "Not found" });
      }

      // No caching: a plugin update rewrites these files in place under the
      // same URL, and a cached panel from the previous version would call an
      // API that has moved on.
      reply.header("cache-control", "no-store");
      reply.header("content-type", contentType);
      return reply.send(createReadStream(file));
    },
  );

  // ── The anonymous door ───────────────────────────────────────────────

  // PUT /api/v1/plugins/:pluginId/public — open or shut it
  app.put<{ Params: { pluginId: string }; Body: { enabled: boolean } }>(
    "/api/v1/plugins/:pluginId/public",
    {
      preValidation: adminOnly,
      schema: {
        body: {
          type: "object",
          required: ["enabled"],
          properties: { enabled: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const { pluginId } = request.params;
      const pkg = packageManager.getById(pluginId);
      if (!pkg) return reply.code(404).send({ error: "Plugin not installed" });
      if (!pkg.manifest.publicTree) {
        return reply.code(400).send({ error: "This plugin declares no public tree" });
      }

      const enabled = request.body.enabled === true;
      settingsManager.set(publicTreeSettingKey(pluginId), enabled ? "true" : "false");
      logger.warn(
        { pluginId, enabled },
        enabled ? "Plugin public tree opened" : "Plugin public tree closed",
      );
      auditLogger.log({
        ...buildActor(request, userManager),
        action: enabled ? "plugin.public.enable" : "plugin.public.disable",
        targetType: "plugin",
        targetId: pluginId,
        ip: request.ip,
      });
      return { pluginId, enabled };
    },
  );

  // ALL /p/:pluginId(/*) — anonymous callers
  const publicHandler = async (
    request: FastifyRequest<{ Params: { pluginId: string; "*"?: string } }>,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const { pluginId } = request.params;

    const pkg = packageManager.getById(pluginId);
    if (!pkg?.enabled || !pkg.manifest.publicTree) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (settingsManager.get(publicTreeSettingKey(pluginId)) !== "true") {
      return reply.code(404).send({ error: "Not found" });
    }

    const plugin = integrationRegistry.getById(pluginId);
    if (!plugin?.handlePublicRequest) return reply.code(404).send({ error: "Not found" });

    const call: PluginHttpRequest = {
      method: request.method,
      path: subPath(request.params as unknown as Record<string, unknown>),
      query: queryOf(request),
      headers: pickHeaders(request, PUBLIC_REQUEST_HEADERS),
      body: request.body ?? null,
      ip: request.ip,
    };

    // An anonymous page of a home automation server has no business in a
    // search index, whatever the plugin forgets to say.
    reply.header("x-robots-tag", "noindex, nofollow");

    try {
      const answer = await withTimeout(plugin.handlePublicRequest(call), PUBLIC_TIMEOUT_MS);
      return sendPluginResponse(reply, answer, logger, { pluginId, path: call.path });
    } catch (err) {
      if (err instanceof PluginCallTimeout) {
        logger.error({ pluginId, path: call.path }, "Plugin public call timed out");
        return reply.code(504).send({ error: "Timeout" });
      }
      logger.error({ err, pluginId, path: call.path }, "Plugin public call failed");
      return reply.code(500).send({ error: "Error" });
    }
  };

  // 60 per minute per IP rather than the global 300: this is the one tree an
  // unauthenticated caller can reach, and the plugin behind it may be doing
  // real work on every call.
  const publicRouteOptions = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  app.route<{ Params: { pluginId: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/p/:pluginId/*",
    ...publicRouteOptions,
    handler: publicHandler,
  });
  app.route<{ Params: { pluginId: string; "*"?: string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/p/:pluginId",
    ...publicRouteOptions,
    handler: publicHandler,
  });
}

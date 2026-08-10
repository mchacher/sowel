import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { PackageManager } from "../../packages/package-manager.js";
import { PersonalPluginConfirmationRequiredError } from "../../packages/registry-types.js";
import { PersonalSourceManager } from "../../packages/personal-sources.js";
import type { PluginLoader } from "../../plugins/plugin-loader.js";
import type { RecipeLoader } from "../../recipes/recipe-loader.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { AuditLogger } from "../../core/audit-logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import { buildActor } from "../audit-context.js";

interface PluginsDeps {
  packageManager: PackageManager;
  pluginLoader: PluginLoader;
  recipeLoader: RecipeLoader;
  integrationRegistry: IntegrationRegistry;
  auditLogger: AuditLogger;
  userManager: UserManager;
  logger: Logger;
}

export function registerPluginRoutes(app: FastifyInstance, deps: PluginsDeps): void {
  const {
    packageManager,
    pluginLoader,
    recipeLoader,
    integrationRegistry,
    auditLogger,
    userManager,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "plugin-routes" });

  // GET /api/v1/plugins — list installed
  app.get("/api/v1/plugins", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      // Integration packages (enriched with runtime status + device counts)
      const integrations = pluginLoader.getInstalled();

      // Recipe packages (no runtime status — just manifest + enabled + latest version)
      const recipes = packageManager.getInstalledByType("recipe").map((pkg) => {
        // Spec 136: source-aware — personal packages check their source repo.
        const update = packageManager.getAvailableUpdateFor(pkg);
        // Spec 137: resolve the display category (manifest → registry → "other")
        // at listing time — no re-release of recipe packages needed.
        const category = packageManager.resolvePackageCategory(pkg.manifest);
        return {
          manifest: { ...pkg.manifest, ...(category ? { category } : {}) },
          enabled: pkg.enabled,
          installedAt: pkg.installedAt,
          status: "connected" as const,
          deviceCount: 0,
          offlineDeviceCount: 0,
          source: pkg.source,
          ...(update ? { latestVersion: update } : {}),
        };
      });

      return [...integrations, ...recipes];
    } catch (err) {
      logger.error({ err }, "Failed to list plugins");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to list plugins",
      });
    }
  });

  // GET /api/v1/plugins/store — list available from registry
  app.get("/api/v1/plugins/store", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      return packageManager.getStore();
    } catch (err) {
      logger.error({ err }, "Failed to list plugin store");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to list plugin store",
      });
    }
  });

  // POST /api/v1/plugins/store/refresh — bypass CDN cache, re-fetch registry
  app.post("/api/v1/plugins/store/refresh", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }
    try {
      const result = await packageManager.refreshRegistryNow();
      return result;
    } catch (err) {
      logger.error({ err }, "Failed to refresh plugin registry");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to refresh plugin registry",
      });
    }
  });

  // GET /api/v1/plugins/sources — list personal sources (spec 136)
  app.get("/api/v1/plugins/sources", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }
    try {
      return packageManager.listPersonalSources();
    } catch (err) {
      logger.error({ err }, "Failed to list personal sources");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to list personal sources",
      });
    }
  });

  // POST /api/v1/plugins/sources — add a personal source (spec 136)
  // Body: { repo: string } ("owner/repo", public GitHub repo)
  app.post<{ Body: { repo: string } }>("/api/v1/plugins/sources", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const repo = (request.body?.repo ?? "").trim();
    if (!repo || !PersonalSourceManager.isValidRepo(repo)) {
      return reply.code(400).send({ error: "Invalid 'repo' field (expected owner/repo)" });
    }

    try {
      const source = await packageManager.addPersonalSource(repo);
      logger.info({ repo }, "Personal source added via API");
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "plugin.source.add",
        targetType: "plugin",
        targetId: repo,
        ip: request.ip,
        meta: { repo, latestVersion: source.latestVersion ?? null },
      });
      return reply.code(201).send(source);
    } catch (err) {
      logger.warn({ err, repo }, "Failed to add personal source");
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Failed to add personal source",
      });
    }
  });

  // POST /api/v1/plugins/sources/remove — remove a personal source (spec 136)
  // Body: { repo: string }. POST rather than DELETE because the repo id
  // contains a slash and DELETE bodies are unreliable through proxies.
  // Installed packages from the source are left untouched.
  app.post<{ Body: { repo: string } }>("/api/v1/plugins/sources/remove", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const repo = (request.body?.repo ?? "").trim();
    if (!repo) {
      return reply.code(400).send({ error: "Missing 'repo' field" });
    }

    try {
      packageManager.removePersonalSource(repo);
      logger.info({ repo }, "Personal source removed via API");
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "plugin.source.remove",
        targetType: "plugin",
        targetId: repo,
        ip: request.ip,
        meta: { repo },
      });
      return { success: true };
    } catch (err) {
      logger.warn({ err, repo }, "Failed to remove personal source");
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Failed to remove personal source",
      });
    }
  });

  // POST /api/v1/plugins/install — install from GitHub
  // Body: { repo: string, confirmed?: boolean, expectedSha256?: string }
  // Returns 409 CommunityPluginConfirmationRequired when owner is not in
  // OFFICIAL_OWNERS and `confirmed` is not true (spec 089 C1).
  // Returns 409 PersonalPluginConfirmationRequired (with version + sha256)
  // for the TOFU confirmation step of personal sources (spec 136).
  app.post<{ Body: { repo: string; confirmed?: boolean; expectedSha256?: string } }>(
    "/api/v1/plugins/install",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const { repo, confirmed, expectedSha256 } = request.body ?? {};
      if (!repo || typeof repo !== "string") {
        return reply.code(400).send({ error: "Missing 'repo' field (e.g. owner/repo)" });
      }

      try {
        // Peek at the registry to determine package type + compatibility
        const entry = packageManager.getStore().find((m) => m.repo === repo);
        const registryType = entry?.type ?? "integration";

        if (entry && !entry.compatible) {
          return reply.code(400).send({
            error:
              entry.compatReason ??
              `Incompatible with current Sowel version (${packageManager.getCurrentVersion()})`,
          });
        }

        // Spec 136: personal source — the real type is only known after
        // extraction, so install through PackageManager first and dispatch
        // to the matching loader afterwards. The sources.has() fallback
        // covers a store entry not yet synthesized (release cache cold).
        if (entry?.tier === "personal" || (!entry && packageManager.sources.has(repo))) {
          const manifest = await packageManager.installFromGitHub(repo, {
            confirmed,
            expectedSha256,
          });
          if ((manifest.type ?? "integration") === "recipe") {
            await recipeLoader.loadNewlyInstalled(manifest.id);
          } else {
            await pluginLoader.loadNewlyInstalled(manifest.id);
          }
          logger.info({ pluginId: manifest.id, repo }, "Personal plugin installed via API");
          auditLogger.log({
            ...buildActor(request, userManager),
            action: "plugin.install",
            targetType: "plugin",
            targetId: manifest.id,
            ip: request.ip,
            meta: {
              repo,
              type: manifest.type ?? "integration",
              version: manifest.version,
              tier: "personal",
              sha256: expectedSha256 ?? null,
            },
          });
          return { success: true, manifest };
        }

        if (registryType === "recipe") {
          await recipeLoader.install(repo, { confirmed });
          logger.info({ repo, type: "recipe" }, "Recipe installed via API");
          auditLogger.log({
            ...buildActor(request, userManager),
            action: "plugin.install",
            targetType: "plugin",
            targetId: repo,
            ip: request.ip,
            meta: { repo, type: "recipe", isOfficial: entry?.isOfficial ?? null },
          });
          return { success: true };
        } else {
          const manifest = await pluginLoader.install(repo, { confirmed });
          logger.info({ pluginId: manifest.id, repo }, "Plugin installed via API");
          auditLogger.log({
            ...buildActor(request, userManager),
            action: "plugin.install",
            targetType: "plugin",
            targetId: manifest.id,
            ip: request.ip,
            meta: {
              repo,
              type: "integration",
              version: manifest.version,
              isOfficial: entry?.isOfficial ?? null,
            },
          });
          return { success: true, manifest };
        }
      } catch (err) {
        // Spec 089 C1: community plugin requires explicit confirmation.
        if (err instanceof Error && err.name === "CommunityPluginConfirmationRequiredError") {
          const owner = (err as Error & { owner?: string }).owner;
          logger.info({ repo, owner }, "Community plugin install requires confirmation");
          return reply.code(409).send({
            error: "CommunityPluginConfirmationRequired",
            owner,
            message: err.message,
          });
        }
        // Spec 136: personal plugin TOFU confirmation step.
        if (err instanceof PersonalPluginConfirmationRequiredError) {
          logger.info(
            { repo, owner: err.owner, version: err.version },
            "Personal plugin install requires confirmation",
          );
          return reply.code(409).send({
            error: "PersonalPluginConfirmationRequired",
            repo: err.repo,
            owner: err.owner,
            version: err.version,
            sha256: err.sha256,
            message: err.message,
          });
        }
        // Spec 089 C1: tarball SHA256 mismatch.
        if (err instanceof Error && err.name === "ChecksumMismatchError") {
          logger.warn({ repo, err }, "Plugin tarball SHA256 mismatch — install refused");
          return reply.code(400).send({
            error: "ChecksumMismatch",
            message: err.message,
          });
        }
        logger.error({ err, repo }, "Failed to install package");
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Install failed",
        });
      }
    },
  );

  // POST /api/v1/plugins/:id/uninstall
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/uninstall", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      await pluginLoader.uninstall(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin uninstalled via API");
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "plugin.uninstall",
        targetType: "plugin",
        targetId: request.params.id,
        ip: request.ip,
      });
      return { success: true };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to uninstall plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Uninstall failed",
      });
    }
  });

  // POST /api/v1/plugins/:id/update
  // Body (optional): { confirmed?: boolean, expectedSha256?: string } —
  // TOFU re-confirmation for personal packages (spec 136).
  app.post<{ Params: { id: string }; Body?: { confirmed?: boolean; expectedSha256?: string } }>(
    "/api/v1/plugins/:id/update",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const { confirmed, expectedSha256 } = request.body ?? {};
      const opts = { confirmed, expectedSha256 };

      try {
        const pkg = packageManager.getById(request.params.id);
        const pkgType = pkg?.type ?? "integration";

        const fromVersion = pkg?.manifest.version;

        if (pkgType === "recipe") {
          await recipeLoader.update(request.params.id, opts);
          logger.info({ pluginId: request.params.id, type: "recipe" }, "Recipe updated via API");
          const after = packageManager.getById(request.params.id);
          auditLogger.log({
            ...buildActor(request, userManager),
            action: "plugin.update",
            targetType: "plugin",
            targetId: request.params.id,
            ip: request.ip,
            meta: {
              type: "recipe",
              from: fromVersion ?? null,
              to: after?.manifest.version ?? null,
              ...(pkg?.source === "personal" ? { tier: "personal" } : {}),
            },
          });
          return { success: true };
        } else {
          const manifest = await pluginLoader.update(request.params.id, opts);
          logger.info(
            { pluginId: request.params.id, version: manifest.version },
            "Plugin updated via API",
          );
          auditLogger.log({
            ...buildActor(request, userManager),
            action: "plugin.update",
            targetType: "plugin",
            targetId: request.params.id,
            ip: request.ip,
            meta: {
              type: "integration",
              from: fromVersion ?? null,
              to: manifest.version,
              ...(pkg?.source === "personal" ? { tier: "personal" } : {}),
            },
          });
          return { success: true, manifest };
        }
      } catch (err) {
        // Spec 136: personal plugin TOFU re-confirmation step.
        if (err instanceof PersonalPluginConfirmationRequiredError) {
          logger.info(
            { pluginId: request.params.id, version: err.version },
            "Personal plugin update requires confirmation",
          );
          return reply.code(409).send({
            error: "PersonalPluginConfirmationRequired",
            repo: err.repo,
            owner: err.owner,
            version: err.version,
            sha256: err.sha256,
            message: err.message,
          });
        }
        if (err instanceof Error && err.name === "ChecksumMismatchError") {
          logger.warn({ pluginId: request.params.id, err }, "Tarball SHA256 mismatch on update");
          return reply.code(400).send({
            error: "ChecksumMismatch",
            message: err.message,
          });
        }
        logger.error({ err, pluginId: request.params.id }, "Failed to update package");
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Update failed",
        });
      }
    },
  );

  // POST /api/v1/plugins/:id/enable
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/enable", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      await pluginLoader.enable(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin enabled via API");
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "plugin.enable",
        targetType: "plugin",
        targetId: request.params.id,
        ip: request.ip,
      });
      return { success: true };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to enable plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Enable failed",
      });
    }
  });

  // POST /api/v1/plugins/:id/disable
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/disable", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      await pluginLoader.disable(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin disabled via API");
      auditLogger.log({
        ...buildActor(request, userManager),
        action: "plugin.disable",
        targetType: "plugin",
        targetId: request.params.id,
        ip: request.ip,
      });
      return { success: true };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to disable plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Disable failed",
      });
    }
  });

  // GET /api/v1/plugins/:id/oauth/url — get OAuth authorization URL
  app.get<{ Params: { id: string } }>("/api/v1/plugins/:id/oauth/url", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const plugin = integrationRegistry.getById(request.params.id);
    if (!plugin) {
      return reply.code(404).send({ error: "Integration not found" });
    }
    if (!plugin.getOAuthUrl) {
      return reply.code(400).send({ error: "Integration does not support OAuth" });
    }
    const url = plugin.getOAuthUrl();
    if (!url) {
      return reply
        .code(400)
        .send({ error: "OAuth not configured (missing client_id or redirect_uri)" });
    }
    return { url };
  });

  // GET /api/v1/plugins/:id/oauth/callback — receive OAuth code
  // No auth required — called by provider's redirect after user authorization
  app.get<{ Params: { id: string }; Querystring: { code?: string; error?: string } }>(
    "/api/v1/plugins/:id/oauth/callback",
    async (request, reply) => {
      const { code, error } = request.query;

      if (error) {
        logger.warn({ pluginId: request.params.id, error }, "OAuth callback received error");
        return reply.redirect("/settings/integrations?oauth_error=" + encodeURIComponent(error));
      }

      if (!code) {
        return reply.redirect("/settings/integrations?oauth_error=missing_code");
      }

      const plugin = integrationRegistry.getById(request.params.id);
      if (!plugin || !plugin.handleOAuthCallback) {
        return reply.redirect("/settings/integrations?oauth_error=plugin_not_found");
      }

      try {
        await plugin.handleOAuthCallback(code);
        logger.info({ pluginId: request.params.id }, "OAuth callback handled successfully");
        return reply.redirect("/settings/integrations?oauth_success=1");
      } catch (err) {
        logger.error({ err, pluginId: request.params.id }, "OAuth callback failed");
        const msg = err instanceof Error ? err.message : "OAuth failed";
        return reply.redirect("/settings/integrations?oauth_error=" + encodeURIComponent(msg));
      }
    },
  );
}

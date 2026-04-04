import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { PackageManager } from "../../packages/package-manager.js";
import type { PluginLoader } from "../../plugins/plugin-loader.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";

interface PluginsDeps {
  packageManager: PackageManager;
  pluginLoader: PluginLoader;
  integrationRegistry: IntegrationRegistry;
  logger: Logger;
}

export function registerPluginRoutes(app: FastifyInstance, deps: PluginsDeps): void {
  const { packageManager, pluginLoader, integrationRegistry, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "plugin-routes" });

  // GET /api/v1/plugins — list installed
  app.get("/api/v1/plugins", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      // Integration packages (enriched with runtime status + device counts)
      const integrations = pluginLoader.getInstalled();

      // Recipe packages (no runtime status — just manifest + enabled)
      const recipes = packageManager.getInstalledByType("recipe").map((pkg) => ({
        manifest: pkg.manifest,
        enabled: pkg.enabled,
        installedAt: pkg.installedAt,
        status: "connected" as const,
        deviceCount: 0,
        offlineDeviceCount: 0,
      }));

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

  // POST /api/v1/plugins/install — install from GitHub
  app.post<{ Body: { repo: string } }>("/api/v1/plugins/install", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const { repo } = request.body ?? {};
    if (!repo || typeof repo !== "string") {
      return reply.code(400).send({ error: "Missing 'repo' field (e.g. owner/repo)" });
    }

    try {
      const manifest = await pluginLoader.install(repo);
      logger.info({ pluginId: manifest.id, repo }, "Plugin installed via API");
      return { success: true, manifest };
    } catch (err) {
      logger.error({ err, repo }, "Failed to install plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Install failed",
      });
    }
  });

  // POST /api/v1/plugins/:id/uninstall
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/uninstall", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      await pluginLoader.uninstall(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin uninstalled via API");
      return { success: true };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to uninstall plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Uninstall failed",
      });
    }
  });

  // POST /api/v1/plugins/:id/update
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/update", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      const manifest = await pluginLoader.update(request.params.id);
      logger.info(
        { pluginId: request.params.id, version: manifest.version },
        "Plugin updated via API",
      );
      return { success: true, manifest };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to update plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Update failed",
      });
    }
  });

  // POST /api/v1/plugins/:id/enable
  app.post<{ Params: { id: string } }>("/api/v1/plugins/:id/enable", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      await pluginLoader.enable(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin enabled via API");
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

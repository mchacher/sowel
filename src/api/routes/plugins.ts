import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { PluginManager } from "../../plugins/plugin-manager.js";

interface PluginsDeps {
  pluginManager: PluginManager;
  logger: Logger;
}

export function registerPluginRoutes(app: FastifyInstance, deps: PluginsDeps): void {
  const { pluginManager, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "plugin-routes" });

  // GET /api/v1/plugins — list installed
  app.get("/api/v1/plugins", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    try {
      return pluginManager.getInstalled();
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
      return pluginManager.getStore();
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
      const manifest = await pluginManager.installFromGitHub(repo);
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
      await pluginManager.uninstall(request.params.id);
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
      const manifest = await pluginManager.update(request.params.id);
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
      await pluginManager.enable(request.params.id);
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
      await pluginManager.disable(request.params.id);
      logger.info({ pluginId: request.params.id }, "Plugin disabled via API");
      return { success: true };
    } catch (err) {
      logger.error({ err, pluginId: request.params.id }, "Failed to disable plugin");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Disable failed",
      });
    }
  });
}

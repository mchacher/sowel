import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { PluginManager } from "../../plugins/plugin-manager.js";

interface IntegrationsDeps {
  integrationRegistry: IntegrationRegistry;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginManager?: PluginManager;
  logger: Logger;
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: IntegrationsDeps): void {
  const {
    integrationRegistry,
    settingsManager,
    deviceManager,
    pluginManager,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "integration-routes" });

  // GET /api/v1/integrations — List all integrations with status
  app.get("/api/v1/integrations", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const integrations = integrationRegistry.getAllInfo();
    const allDevices = deviceManager.getAll();

    // Build plugin version map
    const pluginVersions = new Map<string, string>();
    if (pluginManager) {
      for (const p of pluginManager.getInstalled()) {
        pluginVersions.set(p.manifest.id, p.manifest.version);
      }
    }

    // Enrich with current setting values and device counts
    return integrations.map((info) => ({
      ...info,
      settingValues: Object.fromEntries(
        info.settings.map((s) => {
          const fullKey = `integration.${info.id}.${s.key}`;
          const value = settingsManager.get(fullKey);
          // Don't expose password values
          return [s.key, s.type === "password" && value ? "••••••••" : (value ?? "")];
        }),
      ),
      deviceCount: allDevices.filter((d) => d.integrationId === info.id).length,
      offlineDeviceCount: allDevices.filter(
        (d) => d.integrationId === info.id && d.status === "offline",
      ).length,
      ...(pluginVersions.has(info.id) ? { pluginVersion: pluginVersions.get(info.id) } : {}),
    }));
  });

  // POST /api/v1/integrations/:id/start — Start an integration
  app.post<{ Params: { id: string } }>("/api/v1/integrations/:id/start", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const integration = integrationRegistry.getById(request.params.id);
    if (!integration) {
      return reply.code(404).send({ error: "Integration not found" });
    }

    try {
      await integration.start();
      logger.info({ integrationId: integration.id }, "Integration started via API");
      return { success: true, status: integration.getStatus() };
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, "Failed to start integration");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Start failed",
      });
    }
  });

  // POST /api/v1/integrations/:id/refresh — Force a data refresh
  app.post<{ Params: { id: string } }>(
    "/api/v1/integrations/:id/refresh",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const integration = integrationRegistry.getById(request.params.id);
      if (!integration) {
        return reply.code(404).send({ error: "Integration not found" });
      }

      if (!integration.refresh) {
        return reply.code(400).send({ error: "Integration does not support refresh" });
      }

      if (integration.getStatus() !== "connected") {
        return reply.code(400).send({ error: "Integration not connected" });
      }

      try {
        await integration.refresh();
        logger.info({ integrationId: integration.id }, "Integration refreshed via API");
        return { success: true };
      } catch (err) {
        logger.error({ err, integrationId: integration.id }, "Failed to refresh integration");
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Refresh failed",
        });
      }
    },
  );

  // POST /api/v1/integrations/:id/restart — Restart an integration (stop + start)
  app.post<{ Params: { id: string } }>(
    "/api/v1/integrations/:id/restart",
    async (request, reply) => {
      if (!request.auth || request.auth.role !== "admin") {
        return reply.code(403).send({ error: "Admin access required" });
      }

      const integration = integrationRegistry.getById(request.params.id);
      if (!integration) {
        return reply.code(404).send({ error: "Integration not found" });
      }

      try {
        await integration.stop();
        await integration.start();
        logger.info({ integrationId: integration.id }, "Integration restarted via API");
        return { success: true, status: integration.getStatus() };
      } catch (err) {
        logger.error({ err, integrationId: integration.id }, "Failed to restart integration");
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Restart failed",
        });
      }
    },
  );

  // POST /api/v1/integrations/:id/stop — Stop an integration
  app.post<{ Params: { id: string } }>("/api/v1/integrations/:id/stop", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const integration = integrationRegistry.getById(request.params.id);
    if (!integration) {
      return reply.code(404).send({ error: "Integration not found" });
    }

    try {
      await integration.stop();
      logger.info({ integrationId: integration.id }, "Integration stopped via API");
      return { success: true, status: integration.getStatus() };
    } catch (err) {
      logger.error({ err, integrationId: integration.id }, "Failed to stop integration");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Stop failed",
      });
    }
  });
}

import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { PluginLoader } from "../../plugins/plugin-loader.js";
import type { IntegrationSettingDef, IntegrationStatus } from "../../shared/types.js";

interface IntegrationsDeps {
  integrationRegistry: IntegrationRegistry;
  settingsManager: SettingsManager;
  deviceManager: DeviceManager;
  pluginLoader?: PluginLoader;
  logger: Logger;
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: IntegrationsDeps): void {
  const {
    integrationRegistry,
    settingsManager,
    deviceManager,
    pluginLoader,
    logger: parentLogger,
  } = deps;
  const logger = parentLogger.child({ module: "integration-routes" });

  // GET /api/v1/integrations — List all integrations with status
  app.get("/api/v1/integrations", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const allDevices = deviceManager.getAll();
    const loadedById = new Map(integrationRegistry.getAllInfo().map((i) => [i.id, i]));

    // List sources:
    //   - integrationRegistry.getAllInfo() returns only ENABLED, currently
    //     loaded plugins (with their full IntegrationPlugin runtime API).
    //   - pluginLoader.getInstalled() returns every installed integration
    //     plugin, including disabled ones (read from the plugins SQLite
    //     table via PackageManager).
    //
    // We list every installed integration so a disabled MCZ Maestro stays
    // visible on the Integrations page (with an "Activer" action), instead
    // of disappearing into the admin-only Plugins page.
    const installed = pluginLoader
      ? pluginLoader.getInstalled().filter((p) => p.manifest.type === "integration")
      : [];

    const enrichSettingValues = (settings: IntegrationSettingDef[], id: string) =>
      Object.fromEntries(
        settings.map((s) => {
          const fullKey = `integration.${id}.${s.key}`;
          const value = settingsManager.get(fullKey);
          return [s.key, s.type === "password" && value ? "••••••••" : (value ?? "")];
        }),
      );

    return installed.map((pkg) => {
      const id = pkg.manifest.id;
      const loaded = loadedById.get(id);
      const settings = (loaded?.settings ?? pkg.manifest.settings ?? []) as IntegrationSettingDef[];
      const settingValues = enrichSettingValues(settings, id);
      const configured =
        loaded?.configured ?? settings.filter((s) => s.required).every((s) => settingValues[s.key]);
      const status: IntegrationStatus = loaded?.status ?? "disconnected";

      return {
        id,
        name: loaded?.name ?? pkg.manifest.name,
        description: loaded?.description ?? pkg.manifest.description ?? "",
        icon: loaded?.icon ?? pkg.manifest.icon ?? "Plug",
        status,
        configured,
        settings,
        settingValues,
        ...(loaded?.polling ? { polling: loaded.polling } : {}),
        deviceCount: allDevices.filter((d) => d.integrationId === id).length,
        offlineDeviceCount: allDevices.filter(
          (d) => d.integrationId === id && d.status === "offline",
        ).length,
        ...(loaded?.supportsOAuth !== undefined ? { supportsOAuth: loaded.supportsOAuth } : {}),
        pluginVersion: pkg.manifest.version,
        enabled: pkg.enabled,
      };
    });
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

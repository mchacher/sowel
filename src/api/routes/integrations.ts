import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { SettingsManager } from "../../core/settings-manager.js";

interface IntegrationsDeps {
  integrationRegistry: IntegrationRegistry;
  settingsManager: SettingsManager;
  logger: Logger;
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: IntegrationsDeps): void {
  const { integrationRegistry, settingsManager, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "integration-routes" });

  // GET /api/v1/integrations — List all integrations with status
  app.get("/api/v1/integrations", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const integrations = integrationRegistry.getAllInfo();

    // Enrich with current setting values
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

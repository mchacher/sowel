import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { createLogger } from "../../core/logger.js";
import { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { IntegrationPlugin } from "../../integrations/integration-registry.js";
import { registerIntegrationRoutes } from "./integrations.js";

const logger = createLogger("silent").logger;

function plugin(over: Partial<IntegrationPlugin> = {}): IntegrationPlugin {
  return {
    id: "zigbee2mqtt",
    name: "Zigbee2MQTT",
    description: "Zigbee devices",
    icon: "Radio",
    getStatus: () => "disconnected",
    isConfigured: () => true,
    getSettingsSchema: () => [],
    start: async () => {},
    stop: async () => {},
    executeOrder: async () => {},
    ...over,
  };
}

async function list(p: IntegrationPlugin) {
  const registry = new IntegrationRegistry(logger);
  registry.register(p);
  const app = Fastify({ logger: false });
  app.addHook("onRequest", async (request) => {
    request.auth = { userId: "u1", role: "admin" };
  });
  registerIntegrationRoutes(app, {
    integrationRegistry: registry,
    settingsManager: { get: () => undefined },
    deviceManager: { getAll: () => [] },
    pluginLoader: {
      getInstalled: () => [
        {
          manifest: { id: p.id, name: p.name, type: "integration", version: "1.0.0" },
          enabled: true,
        },
      ],
    },
    logger,
  } as unknown as Parameters<typeof registerIntegrationRoutes>[1]);
  apps.push(app);
  const res = await app.inject({ method: "GET", url: "/api/v1/integrations" });
  expect(res.statusCode).toBe(200);
  return res.json()[0];
}

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

describe("GET /api/v1/integrations statusDetail (spec 216)", () => {
  it("relays the plugin's reason", async () => {
    const body = await list(plugin({ getStatusDetail: () => "Connection refused on host:1883." }));
    expect(body.statusDetail).toBe("Connection refused on host:1883.");
  });

  it("leaves the field out when the plugin has none", async () => {
    expect("statusDetail" in (await list(plugin()))).toBe(false);
  });
});

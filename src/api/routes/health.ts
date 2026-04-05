import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { Logger } from "../../core/logger.js";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname ?? ".", "../../../package.json"), "utf-8"),
) as { version: string };

interface HealthDeps {
  deviceManager: DeviceManager;
  integrationRegistry: IntegrationRegistry;
  logger: Logger;
}

const startTime = Date.now();

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  const { deviceManager, integrationRegistry } = deps;

  app.get("/api/v1/health", async () => {
    const statusCounts = deviceManager.getStatusCounts();
    const totalDevices = deviceManager.getDeviceCount();
    const uptimeMs = Date.now() - startTime;

    const integrations: Record<string, { status: string }> = {};
    for (const info of integrationRegistry.getAllInfo()) {
      integrations[info.id] = { status: info.status };
    }

    return {
      status: "ok",
      uptime: {
        ms: uptimeMs,
        human: formatUptime(uptimeMs),
      },
      integrations,
      devices: {
        total: totalDevices,
        online: statusCounts.online ?? 0,
        offline: statusCounts.offline ?? 0,
        unknown: statusCounts.unknown ?? 0,
      },
      version: pkg.version,
    };
  });
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

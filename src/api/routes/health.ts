import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { DeviceManager } from "../../devices/device-manager.js";
import type { IntegrationRegistry } from "../../integrations/integration-registry.js";
import type { AuthService } from "../../auth/auth-service.js";
import { optionalAuth } from "../../auth/auth-middleware.js";
import type { Logger } from "../../core/logger.js";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname ?? ".", "../../../package.json"), "utf-8"),
) as { version: string };

interface HealthDeps {
  deviceManager: DeviceManager;
  integrationRegistry: IntegrationRegistry;
  authService: AuthService;
  logger: Logger;
}

const startTime = Date.now();

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  const { deviceManager, integrationRegistry, authService } = deps;

  // The route stays in PUBLIC_ROUTES: `scripts/install.sh` polls it to decide
  // when a fresh stack is ready, and uptime monitors need it to answer without
  // credentials. What varies is the payload, not the access (issue #926).
  //
  // Anonymously it reports liveness and nothing else. The engine version, the
  // installed plugin list and the device counts are reconnaissance material —
  // the version pins the instance to an exact release, the plugin ids reveal
  // which protocols and vendor clouds are in play — so they are served only to
  // a caller that proves it is already inside.
  app.get("/api/v1/health", async (request) => {
    const uptimeMs = Date.now() - startTime;
    const liveness = {
      status: "ok",
      uptime: {
        ms: uptimeMs,
        human: formatUptime(uptimeMs),
      },
    };

    // Never rejects: an absent, malformed or expired token yields the anonymous
    // payload rather than a 401, so a monitor is not broken by a stale token.
    if (!optionalAuth(request, authService)) return liveness;

    const statusCounts = deviceManager.getStatusCounts();
    const integrations: Record<string, { status: string }> = {};
    for (const info of integrationRegistry.getAllInfo()) {
      integrations[info.id] = { status: info.status };
    }

    return {
      ...liveness,
      integrations,
      devices: {
        total: deviceManager.getDeviceCount(),
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

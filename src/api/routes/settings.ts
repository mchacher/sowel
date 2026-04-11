import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";

interface SettingsDeps {
  settingsManager: SettingsManager;
  eventBus: EventBus;
  logger: Logger;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsDeps): void {
  const { settingsManager, eventBus, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "settings-routes" });

  // GET /api/v1/settings — Get all settings (admin only)
  app.get("/api/v1/settings", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    return settingsManager.getAll();
  });

  // PUT /api/v1/settings — Update settings (admin only)
  app.put<{ Body: Record<string, string> }>("/api/v1/settings", async (request, reply) => {
    if (!request.auth || request.auth.role !== "admin") {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const entries = request.body;
    if (!entries || typeof entries !== "object") {
      return reply.code(400).send({ error: "Body must be a key-value object" });
    }

    // Validate all values are strings
    for (const [key, value] of Object.entries(entries)) {
      if (typeof key !== "string" || typeof value !== "string") {
        return reply.code(400).send({ error: `Invalid entry: ${key}` });
      }
    }

    settingsManager.setMany(entries);
    const keys = Object.keys(entries);
    logger.info({ keys }, "Settings updated");
    eventBus.emit({ type: "settings.changed", keys });

    // Home location changed → timezone may need to be re-derived via restart
    if (keys.includes("home.latitude") || keys.includes("home.longitude")) {
      logger.warn("Home location changed. Restart Sowel for timezone changes to apply.");
      eventBus.emit({
        type: "system.restart_required",
        reason: "home_location_changed",
      });
    }

    return { success: true };
  });
}

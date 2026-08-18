import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { EventBus } from "../../core/event-bus.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import { AuditLogger } from "../../core/audit-logger.js";
import type { UserManager } from "../../auth/user-manager.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { buildActor } from "../audit-context.js";

interface SettingsDeps {
  settingsManager: SettingsManager;
  eventBus: EventBus;
  auditLogger: AuditLogger;
  userManager: UserManager;
  logger: Logger;
}

// A settings write is a flat key -> string map. `additionalProperties` typed as
// string (with coerceTypes:false, issue #452) rejects non-string values exactly
// like the old per-entry `typeof value !== "string"` check did. Admin gating is
// an onRequest hook (runs before schema validation, so 403 precedes 400).
const settingsBodySchema = {
  type: "object",
  additionalProperties: { type: "string" },
} as const;

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsDeps): void {
  const { settingsManager, eventBus, auditLogger, userManager, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "settings-routes" });

  // Both settings routes are admin-only. The hook runs before body-schema
  // validation, preserving the original 403-before-400 ordering. Matched on the
  // exact path (not a prefix) so it never reaches foreign routes that borrow the
  // namespace, e.g. GET/PUT /api/v1/settings/energy/tariff which self-guard.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.split("?")[0] === "/api/v1/settings") requireAdmin(request, reply);
  });

  // GET /api/v1/settings — Get all settings (admin only)
  app.get("/api/v1/settings", async () => {
    return settingsManager.getAll();
  });

  // PUT /api/v1/settings — Update settings (admin only)
  app.put<{ Body: Record<string, string> }>(
    "/api/v1/settings",
    { schema: { body: settingsBodySchema } },
    async (request) => {
      const entries = request.body;

      // Capture old values BEFORE the write for the audit meta
      const oldValues: Record<string, string | undefined> = {};
      for (const k of Object.keys(entries)) oldValues[k] = settingsManager.get(k);

      settingsManager.setMany(entries);
      const keys = Object.keys(entries);
      logger.info({ keys }, "Settings updated");
      eventBus.emit({ type: "settings.changed", keys });

      // Audit one entry per changed key (spec 113).
      const actor = buildActor(request, userManager);
      for (const [key, newValue] of Object.entries(entries)) {
        auditLogger.log({
          ...actor,
          action: "settings.update",
          targetType: "settings",
          targetId: key,
          ip: request.ip,
          meta: AuditLogger.redactSettingMeta(key, oldValues[key], newValue),
        });
      }

      // Home location changed → timezone may need to be re-derived via restart
      if (keys.includes("home.latitude") || keys.includes("home.longitude")) {
        logger.warn("Home location changed. Restart Sowel for timezone changes to apply.");
        eventBus.emit({
          type: "system.restart_required",
          reason: "home_location_changed",
        });
      }

      return { success: true };
    },
  );
}

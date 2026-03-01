import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import { HistoryWriter } from "../../history/history-writer.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { EventBus } from "../../core/event-bus.js";
import type { DataCategory } from "../../shared/types.js";

export function registerHistoryRoutes(
  app: FastifyInstance,
  deps: {
    historyWriter: HistoryWriter;
    equipmentManager: EquipmentManager;
    settingsManager: SettingsManager;
    eventBus: EventBus;
    logger: Logger;
  },
) {
  const { historyWriter, equipmentManager, settingsManager, eventBus, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "history-routes" });

  // ============================================================
  // GET /api/v1/history/status
  // ============================================================

  app.get("/api/v1/history/status", async () => {
    const influx = historyWriter.getInfluxClient();
    const configured =
      !!settingsManager.get("history.influx.url") &&
      !!settingsManager.get("history.influx.token") &&
      !!settingsManager.get("history.influx.org") &&
      !!settingsManager.get("history.influx.bucket");

    return {
      configured,
      connected: influx.isConnected(),
      enabled: settingsManager.get("history.enabled") === "true",
      historizedBindings: historyWriter.getHistorizedCount(),
      stats: influx.getStats(),
    };
  });

  // ============================================================
  // POST /api/v1/history/test-connection
  // ============================================================

  app.post("/api/v1/history/test-connection", async (_req, reply) => {
    const influx = historyWriter.getInfluxClient();
    if (!influx.isConnected()) {
      return reply.status(400).send({ error: "InfluxDB not configured or not connected" });
    }

    const ok = await influx.ping();
    if (ok) {
      return { success: true, message: "InfluxDB connection successful" };
    } else {
      return reply.status(503).send({ error: "InfluxDB ping failed" });
    }
  });

  // ============================================================
  // GET /api/v1/history/bindings/:equipmentId
  // ============================================================

  app.get<{ Params: { equipmentId: string } }>(
    "/api/v1/history/bindings/:equipmentId",
    async (req, reply) => {
      const { equipmentId } = req.params;
      const equipment = equipmentManager.getById(equipmentId);
      if (!equipment) {
        return reply.status(404).send({ error: "Equipment not found" });
      }

      const bindings = equipmentManager.getDataBindingsWithValues(equipmentId);
      const result = bindings
        .filter((b) => !b.id.startsWith("virtual:"))
        .map((b) => ({
          bindingId: b.id,
          alias: b.alias,
          category: b.category,
          historize: b.historize ?? null,
          effectiveOn: HistoryWriter.resolveHistorize(
            b.historize ?? null,
            b.alias,
            b.category as DataCategory,
          ),
        }));

      return result;
    },
  );

  // ============================================================
  // PUT /api/v1/history/bindings/:equipmentId/:bindingId
  // ============================================================

  app.put<{
    Params: { equipmentId: string; bindingId: string };
    Body: { historize: number | null };
  }>("/api/v1/history/bindings/:equipmentId/:bindingId", async (req, reply) => {
    const { equipmentId, bindingId } = req.params;
    const { historize } = req.body as { historize: number | null };

    const equipment = equipmentManager.getById(equipmentId);
    if (!equipment) {
      return reply.status(404).send({ error: "Equipment not found" });
    }

    // Validate historize value
    if (historize !== null && historize !== 0 && historize !== 1) {
      return reply.status(400).send({ error: "historize must be null, 0, or 1" });
    }

    try {
      equipmentManager.setHistorize(bindingId, historize);
    } catch (err) {
      logger.error({ err, bindingId }, "Failed to update historize flag");
      return reply.status(500).send({ error: "Failed to update historize flag" });
    }

    // Notify system so history writer refreshes its cache
    eventBus.emit({ type: "equipment.updated", equipment });

    return { success: true };
  });

  logger.debug("History routes registered");
}

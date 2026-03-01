import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import { HistoryWriter } from "../../history/history-writer.js";
import {
  queryHistory,
  queryHistorizedAliases,
  querySparkline,
  queryZoneSparkline,
} from "../../history/history-query.js";
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

  // ============================================================
  // GET /api/v1/history/sparkline/zone/:zoneId/:category — zone-level 24h sparkline
  // ============================================================

  app.get<{ Params: { zoneId: string; category: string } }>(
    "/api/v1/history/sparkline/zone/:zoneId/:category",
    async (req) => {
      const { zoneId, category } = req.params;

      const influx = historyWriter.getInfluxClient();
      if (!influx.isConnected()) {
        return { values: [] };
      }

      const values = await queryZoneSparkline(influx, { zoneId, category }, logger);
      return { values };
    },
  );

  // ============================================================
  // GET /api/v1/history/sparkline/:equipmentId/:alias — lightweight 24h sparkline data
  // ============================================================

  app.get<{ Params: { equipmentId: string; alias: string } }>(
    "/api/v1/history/sparkline/:equipmentId/:alias",
    async (req, reply) => {
      const { equipmentId, alias } = req.params;

      const equipment = equipmentManager.getById(equipmentId);
      if (!equipment) {
        return reply.status(404).send({ error: "Equipment not found" });
      }

      const influx = historyWriter.getInfluxClient();
      if (!influx.isConnected()) {
        return { values: [] };
      }

      const values = await querySparkline(influx, { equipmentId, alias }, logger);
      return { values };
    },
  );

  // ============================================================
  // GET /api/v1/history/:equipmentId — list historized aliases
  // ============================================================

  app.get<{ Params: { equipmentId: string } }>(
    "/api/v1/history/:equipmentId",
    async (req, reply) => {
      const { equipmentId } = req.params;
      const equipment = equipmentManager.getById(equipmentId);
      if (!equipment) {
        return reply.status(404).send({ error: "Equipment not found" });
      }

      const influx = historyWriter.getInfluxClient();
      if (!influx.isConnected()) {
        return { aliases: [] };
      }

      const aliases = await queryHistorizedAliases(influx, equipmentId, logger);
      return { aliases };
    },
  );

  // ============================================================
  // GET /api/v1/history/:equipmentId/:alias — query time-series data
  // ============================================================

  app.get<{
    Params: { equipmentId: string; alias: string };
    Querystring: { from?: string; to?: string; aggregation?: string };
  }>("/api/v1/history/:equipmentId/:alias", async (req, reply) => {
    const { equipmentId, alias } = req.params;
    const { from, to, aggregation } = req.query;

    const equipment = equipmentManager.getById(equipmentId);
    if (!equipment) {
      return reply.status(404).send({ error: "Equipment not found" });
    }

    const influx = historyWriter.getInfluxClient();
    if (!influx.isConnected()) {
      return { points: [], resolution: "raw" };
    }

    // Validate aggregation parameter
    const validAggregations = ["raw", "1h", "1d", "auto"];
    if (aggregation && !validAggregations.includes(aggregation)) {
      return reply
        .status(400)
        .send({ error: "Invalid aggregation. Must be: raw, 1h, 1d, or auto" });
    }

    const result = await queryHistory(
      influx,
      {
        equipmentId,
        alias,
        from: from ?? "-24h",
        to,
        aggregation: (aggregation as "raw" | "1h" | "1d" | "auto") ?? "auto",
      },
      logger,
    );

    return result;
  });

  logger.debug("History routes registered");
}

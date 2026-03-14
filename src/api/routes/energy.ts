import type { FastifyInstance } from "fastify";
import type { Logger } from "../../core/logger.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { InfluxClient } from "../../history/influx-client.js";
import type {
  EnergyPoint,
  EnergyTotals,
  EnergyHistoryResponse,
  EnergyStatus,
} from "../../shared/types.js";

interface EnergyDeps {
  equipmentManager: EquipmentManager;
  influxClient: InfluxClient;
  logger: Logger;
}

export function registerEnergyRoutes(app: FastifyInstance, deps: EnergyDeps): void {
  const { equipmentManager, influxClient, logger: parentLogger } = deps;
  const logger = parentLogger.child({ module: "energy-api" });

  // ============================================================
  // GET /api/v1/energy/status
  // ============================================================
  app.get("/api/v1/energy/status", async (): Promise<EnergyStatus> => {
    const eqId = findEnergyEquipmentId(equipmentManager);
    return {
      available: eqId !== null,
      sources: eqId ? ["legrand"] : [],
      lastDataAt: null, // TODO: query InfluxDB for latest point
    };
  });

  // ============================================================
  // GET /api/v1/energy/history
  // ============================================================
  app.get<{
    Querystring: { period?: string; date?: string };
  }>("/api/v1/energy/history", async (request, reply) => {
    const period = request.query.period ?? "day";
    const dateStr = request.query.date ?? new Date().toISOString().slice(0, 10);

    if (!["day", "week", "month", "year"].includes(period)) {
      return reply.status(400).send({ error: "Invalid period. Use: day, week, month, year" });
    }

    const equipmentId = findEnergyEquipmentId(equipmentManager);
    if (!equipmentId) {
      return reply.status(404).send({ error: "No energy equipment configured" });
    }

    const config = influxClient.getConfig();
    const client = influxClient.getClient();
    if (!config || !client) {
      return reply.status(503).send({ error: "InfluxDB not configured" });
    }

    const { from, to, resolution, bucket } = computeRange(period, dateStr, config.bucket);

    try {
      let points = await queryEnergyPoints(
        client,
        config.org,
        bucket,
        equipmentId,
        from,
        to,
        resolution,
      );

      // For day view reading from raw bucket: if no data found (e.g. raw expired
      // but hourly exists from backfill), fall back to hourly bucket
      if (points.length === 0 && period === "day" && !bucket.includes("-energy-")) {
        points = await queryEnergyPoints(
          client,
          config.org,
          `${config.bucket}-energy-hourly`,
          equipmentId,
          from,
          to,
          resolution,
        );
      }

      const totals = computeTotals(points);

      const response: EnergyHistoryResponse = {
        period,
        from: from.toISOString(),
        to: to.toISOString(),
        resolution,
        points,
        totals,
      };

      return response;
    } catch (err) {
      logger.error({ err, period, dateStr }, "Energy history query failed");
      return reply.status(500).send({ error: "Failed to query energy data" });
    }
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Find the Equipment ID for the main energy meter.
 */
function findEnergyEquipmentId(equipmentManager: EquipmentManager): string | null {
  const equipments = equipmentManager.getAll();
  const meter = equipments.find((eq) => eq.type === "main_energy_meter");
  return meter?.id ?? null;
}

/**
 * Compute time range and resolution based on period.
 *
 * Day/week views read from the energy-hourly bucket (populated by InfluxDB task).
 * Month/year views read from the energy-daily bucket.
 */
function computeRange(
  period: string,
  dateStr: string,
  baseBucket: string,
): { from: Date; to: Date; resolution: "5min" | "1h" | "1d"; bucket: string } {
  const date = new Date(dateStr + "T00:00:00");

  switch (period) {
    case "day": {
      const from = new Date(date);
      const to = new Date(date);
      to.setDate(to.getDate() + 1);
      // Raw bucket has 7-day retention; use it for recent days (real-time data),
      // fall back to hourly bucket for older days
      const ageMs = Date.now() - from.getTime();
      const isRecent = ageMs < 6 * 24 * 60 * 60 * 1000; // < 6 days (safe margin)
      return {
        from,
        to,
        resolution: "1h",
        bucket: isRecent ? baseBucket : `${baseBucket}-energy-hourly`,
      };
    }
    case "week": {
      const from = new Date(date);
      const dayOfWeek = from.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      from.setDate(from.getDate() + mondayOffset);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from, to, resolution: "1h", bucket: `${baseBucket}-energy-hourly` };
    }
    case "month": {
      const from = new Date(date.getFullYear(), date.getMonth(), 1);
      const to = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-daily` };
    }
    case "year": {
      const from = new Date(date.getFullYear(), 0, 1);
      const to = new Date(date.getFullYear() + 1, 0, 1);
      return { from, to, resolution: "1d", bucket: `${baseBucket}-energy-daily` };
    }
    default: {
      const from = new Date(date);
      const to = new Date(date);
      to.setDate(to.getDate() + 1);
      return { from, to, resolution: "5min", bucket: baseBucket };
    }
  }
}

/**
 * Query energy points from InfluxDB.
 */
async function queryEnergyPoints(
  client: import("@influxdata/influxdb-client").InfluxDB,
  org: string,
  bucket: string,
  equipmentId: string,
  from: Date,
  to: Date,
  _resolution: "5min" | "1h" | "1d",
): Promise<EnergyPoint[]> {
  const queryApi = client.getQueryApi(org);

  const field = "value_number";

  // When reading raw 30-min data for day/week views, aggregate to hourly in the query
  const needsAggregation = _resolution === "1h" && !bucket.includes("-energy-");

  const flux = needsAggregation
    ? `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "${field}")
  |> aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`
    : `from(bucket: "${bucket}")
  |> range(start: ${from.toISOString()}, stop: ${to.toISOString()})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "energy")
  |> filter(fn: (r) => r.category == "energy")
  |> filter(fn: (r) => r._field == "${field}")
  |> sort(columns: ["_time"])`;

  const points: EnergyPoint[] = [];

  const rows = queryApi.iterateRows(flux);
  for await (const { values, tableMeta } of rows) {
    const row = tableMeta.toObject(values) as { _time: string; _value: number };
    if (row._value != null && row._value > 0) {
      points.push({
        time: row._time,
        consumption: row._value,
      });
    }
  }

  return points;
}

/**
 * Compute totals from energy points.
 */
function computeTotals(points: EnergyPoint[]): EnergyTotals {
  let totalConsumption = 0;
  for (const p of points) {
    totalConsumption += p.consumption;
  }
  return { total_consumption: totalConsumption };
}

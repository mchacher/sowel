import type { Logger } from "../core/logger.js";
import type { InfluxClient } from "./influx-client.js";
import type { HistoryPoint, HistoryQueryResult } from "../shared/types.js";

type Resolution = "raw" | "1h" | "1d";

/**
 * Auto-select resolution based on time range.
 * ≤6h → raw, ≤7d → 1h, >7d → 1d
 */
function autoResolution(fromMs: number, toMs: number): Resolution {
  const rangeMs = toMs - fromMs;
  const hours = rangeMs / 3_600_000;
  if (hours <= 6) return "raw";
  if (hours <= 168) return "1h"; // 7 days
  return "1d";
}

/**
 * Parse a "from" string into a Date.
 * Accepts ISO 8601 or relative like "-24h", "-7d", "-30d".
 */
function parseFrom(from: string): Date {
  if (from.startsWith("-")) {
    const match = from.match(/^-(\d+)([hdm])$/);
    if (match) {
      const amount = parseInt(match[1], 10);
      const unit = match[2];
      const now = Date.now();
      const ms =
        unit === "h" ? amount * 3_600_000 : unit === "d" ? amount * 86_400_000 : amount * 60_000;
      return new Date(now - ms);
    }
  }
  return new Date(from);
}

/**
 * Build a Flux query for time-series data.
 */
function buildFluxQuery(params: {
  bucket: string;
  equipmentId: string;
  alias: string;
  from: Date;
  to: Date;
  resolution: Resolution;
}): string {
  const { bucket, equipmentId, alias, from, to, resolution } = params;

  const fromStr = from.toISOString();
  const toStr = to.toISOString();

  // Base query: filter by measurement, equipmentId, alias
  let query = `from(bucket: "${bucket}")
  |> range(start: ${fromStr}, stop: ${toStr})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "${alias}")
  |> filter(fn: (r) => r._field == "value_number")`;

  if (resolution === "raw") {
    // Raw data — just sort and limit
    query += `
  |> sort(columns: ["_time"])
  |> limit(n: 500)`;
  } else {
    // Aggregated data — window + mean/min/max
    const every = resolution === "1h" ? "1h" : "1d";
    query += `
  |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
  |> limit(n: 500)`;
  }

  return query;
}

/**
 * Build a Flux query that returns min/max alongside mean for aggregated data.
 */
function buildAggregatedFluxQuery(params: {
  bucket: string;
  equipmentId: string;
  alias: string;
  from: Date;
  to: Date;
  resolution: "1h" | "1d";
}): string {
  const { bucket, equipmentId, alias, from, to, resolution } = params;
  const fromStr = from.toISOString();
  const toStr = to.toISOString();
  const every = resolution === "1h" ? "1h" : "1d";

  // Query mean, min, max in a single request using pivot
  return `import "experimental"

data = from(bucket: "${bucket}")
  |> range(start: ${fromStr}, stop: ${toStr})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "${alias}")
  |> filter(fn: (r) => r._field == "value_number")

mean = data |> aggregateWindow(every: ${every}, fn: mean, createEmpty: false) |> set(key: "_field", value: "mean")
min = data |> aggregateWindow(every: ${every}, fn: min, createEmpty: false) |> set(key: "_field", value: "min")
max = data |> aggregateWindow(every: ${every}, fn: max, createEmpty: false) |> set(key: "_field", value: "max")

union(tables: [mean, min, max])
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
  |> limit(n: 500)`;
}

/**
 * Query historical data for an equipment binding.
 */
export async function queryHistory(
  influxClient: InfluxClient,
  params: {
    equipmentId: string;
    alias: string;
    from: string;
    to?: string;
    aggregation?: "raw" | "1h" | "1d" | "auto";
  },
  logger: Logger,
): Promise<HistoryQueryResult> {
  const config = influxClient.getConfig();
  const client = influxClient.getClient();
  if (!config || !client) {
    return { points: [], resolution: "raw" };
  }

  const fromDate = parseFrom(params.from);
  const toDate = params.to ? new Date(params.to) : new Date();
  const resolution =
    params.aggregation === "auto" || !params.aggregation
      ? autoResolution(fromDate.getTime(), toDate.getTime())
      : params.aggregation;

  const queryApi = client.getQueryApi(config.org);
  const points: HistoryPoint[] = [];

  try {
    if (resolution === "raw") {
      // Simple raw query
      const flux = buildFluxQuery({
        bucket: config.bucket,
        equipmentId: params.equipmentId,
        alias: params.alias,
        from: fromDate,
        to: toDate,
        resolution: "raw",
      });

      for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
        const o = tableMeta.toObject(values);
        const time = o._time as string | undefined;
        const value = o._value as number | undefined;
        if (time && typeof value === "number") {
          points.push({ time, value });
        }
      }
    } else {
      // Aggregated query with min/max
      const flux = buildAggregatedFluxQuery({
        bucket: config.bucket,
        equipmentId: params.equipmentId,
        alias: params.alias,
        from: fromDate,
        to: toDate,
        resolution,
      });

      for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
        const o = tableMeta.toObject(values);
        const time = o._time as string | undefined;
        const mean = o.mean as number | undefined;
        const min = o.min as number | undefined;
        const max = o.max as number | undefined;
        if (time && typeof mean === "number") {
          points.push({
            time,
            value: mean,
            min: typeof min === "number" ? min : undefined,
            max: typeof max === "number" ? max : undefined,
          });
        }
      }
    }
  } catch (err) {
    logger.error(
      { err, equipmentId: params.equipmentId, alias: params.alias },
      "InfluxDB query failed",
    );
  }

  return { points, resolution };
}

/**
 * List historized aliases for an equipment.
 * Returns aliases that have data in InfluxDB.
 */
export async function queryHistorizedAliases(
  influxClient: InfluxClient,
  equipmentId: string,
  logger: Logger,
): Promise<string[]> {
  const config = influxClient.getConfig();
  const client = influxClient.getClient();
  if (!config || !client) return [];

  const queryApi = client.getQueryApi(config.org);
  const aliases: string[] = [];

  try {
    const flux = `from(bucket: "${config.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> keep(columns: ["alias"])
  |> distinct(column: "alias")`;

    for await (const { values, tableMeta } of queryApi.iterateRows(flux)) {
      const o = tableMeta.toObject(values);
      const alias = o._value;
      if (typeof alias === "string") {
        aliases.push(alias);
      }
    }
  } catch (err) {
    logger.error({ err, equipmentId }, "Failed to query historized aliases");
  }

  return aliases;
}

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
 * Resolve the bucket name based on resolution.
 * - raw → base bucket (e.g. "sowel")
 * - 1h  → base bucket + "-hourly" (e.g. "sowel-hourly")
 * - 1d  → base bucket + "-daily" (e.g. "sowel-daily")
 */
function resolveBucket(baseBucket: string, resolution: Resolution): string {
  if (resolution === "1h") return `${baseBucket}-hourly`;
  if (resolution === "1d") return `${baseBucket}-daily`;
  return baseBucket;
}

/**
 * Build a Flux query for time-series data.
 * For raw resolution: queries the raw bucket with value_number field.
 * For 1h/1d: queries the pre-aggregated downsampled bucket (mean field).
 * Falls back to on-the-fly aggregation if downsampled bucket has no data.
 */
function buildFluxQuery(params: {
  bucket: string;
  equipmentId: string;
  alias: string;
  from: Date;
  to: Date;
  resolution: Resolution;
  isDiscrete?: boolean;
}): string {
  const { bucket, equipmentId, alias, from, to, resolution, isDiscrete } = params;

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
    // Raw data — higher limit for discrete state data over long ranges
    const limit = isDiscrete ? 2000 : 500;
    query += `
  |> sort(columns: ["_time"])
  |> limit(n: ${limit})`;
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
 * When querying a downsampled bucket (hourly/daily), reads pre-computed mean/min/max fields.
 * When querying the raw bucket (fallback), computes aggregation on the fly.
 */
function buildAggregatedFluxQuery(params: {
  bucket: string;
  baseBucket: string;
  equipmentId: string;
  alias: string;
  from: Date;
  to: Date;
  resolution: "1h" | "1d";
}): string {
  const { bucket, baseBucket, equipmentId, alias, from, to, resolution } = params;
  const fromStr = from.toISOString();
  const toStr = to.toISOString();
  const every = resolution === "1h" ? "1h" : "1d";

  const isDownsampled = bucket !== baseBucket;

  if (isDownsampled) {
    // Query pre-aggregated downsampled bucket — fields are already mean, min, max
    return `from(bucket: "${bucket}")
  |> range(start: ${fromStr}, stop: ${toStr})
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${equipmentId}")
  |> filter(fn: (r) => r.alias == "${alias}")
  |> filter(fn: (r) => r._field == "mean" or r._field == "min" or r._field == "max")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
  |> limit(n: 500)`;
  }

  // Fallback: compute aggregation on the fly from raw data
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
    dataType?: string;
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
  const isDiscrete = params.dataType === "boolean" || params.dataType === "enum";

  // Boolean/enum types always use raw resolution — mean aggregation is meaningless for state data
  const resolution = isDiscrete
    ? ("raw" as Resolution)
    : params.aggregation === "auto" || !params.aggregation
      ? autoResolution(fromDate.getTime(), toDate.getTime())
      : params.aggregation;

  const queryApi = client.getQueryApi(config.org);
  const points: HistoryPoint[] = [];

  // Resolve target bucket based on resolution (raw, hourly, or daily)
  const targetBucket = resolveBucket(config.bucket, resolution);

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
        isDiscrete,
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
      // Aggregated query — try downsampled bucket first, fallback to raw
      const flux = buildAggregatedFluxQuery({
        bucket: targetBucket,
        baseBucket: config.bucket,
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

      // Fallback: if downsampled bucket returned no data, try raw bucket with on-the-fly aggregation
      if (points.length === 0 && targetBucket !== config.bucket) {
        logger.debug(
          { bucket: targetBucket, equipmentId: params.equipmentId, alias: params.alias },
          "No data in downsampled bucket, falling back to raw",
        );
        const fallbackFlux = buildAggregatedFluxQuery({
          bucket: config.bucket,
          baseBucket: config.bucket,
          equipmentId: params.equipmentId,
          alias: params.alias,
          from: fromDate,
          to: toDate,
          resolution,
        });

        for await (const { values, tableMeta } of queryApi.iterateRows(fallbackFlux)) {
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
 * Query sparkline data — last 24h aggregated to ~48 points (30min windows).
 * Returns only values (no timestamps, no min/max) for lightweight inline rendering.
 */
export async function querySparkline(
  influxClient: InfluxClient,
  params: { equipmentId: string; alias: string },
  logger: Logger,
): Promise<number[]> {
  const config = influxClient.getConfig();
  const client = influxClient.getClient();
  if (!config || !client) return [];

  const queryApi = client.getQueryApi(config.org);
  const values: number[] = [];

  try {
    const flux = `from(bucket: "${config.bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${params.equipmentId}")
  |> filter(fn: (r) => r.alias == "${params.alias}")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 30m, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
  |> limit(n: 48)`;

    for await (const { values: rowValues, tableMeta } of queryApi.iterateRows(flux)) {
      const o = tableMeta.toObject(rowValues);
      const v = o._value as number | undefined;
      if (typeof v === "number") {
        values.push(v);
      }
    }
  } catch (err) {
    logger.error(
      { err, equipmentId: params.equipmentId, alias: params.alias },
      "Sparkline query failed",
    );
  }

  return values;
}

/**
 * Query zone-level sparkline — last 24h, all equipments in the zone for a given
 * category, averaged into ~48 points (30min windows).
 */
export async function queryZoneSparkline(
  influxClient: InfluxClient,
  params: { zoneId: string; category: string },
  logger: Logger,
): Promise<number[]> {
  const config = influxClient.getConfig();
  const client = influxClient.getClient();
  if (!config || !client) return [];

  const queryApi = client.getQueryApi(config.org);
  const values: number[] = [];

  try {
    const flux = `from(bucket: "${config.bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.zoneId == "${params.zoneId}")
  |> filter(fn: (r) => r.category == "${params.category}")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 30m, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
  |> limit(n: 48)`;

    for await (const { values: rowValues, tableMeta } of queryApi.iterateRows(flux)) {
      const o = tableMeta.toObject(rowValues);
      const v = o._value as number | undefined;
      if (typeof v === "number") {
        values.push(v);
      }
    }
  } catch (err) {
    logger.error(
      { err, zoneId: params.zoneId, category: params.category },
      "Zone sparkline query failed",
    );
  }

  return values;
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

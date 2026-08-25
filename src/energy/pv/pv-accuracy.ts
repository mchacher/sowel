/**
 * Forecast against actual (spec 160, FR6).
 *
 * A forecast nobody can check is a number to take on faith. This reads back what
 * was promised, lines it up with what the meter recorded, and states the error.
 * It is also the data any later automation would need to justify trusting the
 * curve at all.
 */

import type { InfluxClient } from "../../core/influx-client.js";
import type { Logger } from "../../core/logger.js";

/** Measurement the forecaster writes its curve to. */
export const FORECAST_MEASUREMENT = "pv_forecast";

/** Lead bucket compared by default: what was said the day before. */
export const DEFAULT_LEAD_BUCKET = "6-24h";

export interface AccuracyPoint {
  /** Hour, UTC ISO. */
  at: string;
  forecastW: number;
  actualW: number;
}

export interface PvAccuracy {
  /** Hours compared. Zero means nothing to say, not a perfect score. */
  samples: number;
  /** Mean absolute error in watts over those hours, null when there are none. */
  maeW: number | null;
  /** The paired series, newest last, for the chart. */
  points: AccuracyPoint[];
}

const EMPTY: PvAccuracy = { samples: 0, maeW: null, points: [] };

/**
 * Pair the forecast with the production for the same hours.
 *
 * Both sides are aggregated to the hour before pairing: the forecast is written
 * per hour already, the meter reports instantaneous power, and comparing a
 * spot reading with an hourly expectation would report noise as error.
 *
 * `leadBucket` matters as much as the window. "How wrong was yesterday's
 * forecast for today" and "how wrong was the one from four days ago" are
 * different questions, and averaging them together answers neither.
 */
export async function queryPvAccuracy(
  influxClient: InfluxClient,
  params: { equipmentId: string; alias: string; days?: number; leadBucket?: string },
  logger: Logger,
): Promise<PvAccuracy> {
  const config = influxClient.getConfig();
  const client = influxClient.getClient();
  if (!config || !client) return EMPTY;

  const days = params.days ?? 7;
  const leadBucket = params.leadBucket ?? DEFAULT_LEAD_BUCKET;
  const queryApi = client.getQueryApi(config.org);

  const forecast = new Map<string, number>();
  const actual = new Map<string, number>();

  try {
    // The curve, as it was issued at that lead time.
    const forecastFlux = `from(bucket: "${config.bucket}-energy-hourly")
  |> range(start: -${days}d, stop: now())
  |> filter(fn: (r) => r._measurement == "${FORECAST_MEASUREMENT}")
  |> filter(fn: (r) => r.equipmentId == "${params.equipmentId}")
  |> filter(fn: (r) => r.leadBucket == "${leadBucket}")
  |> filter(fn: (r) => r._field == "watts")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`;

    for await (const { values, tableMeta } of queryApi.iterateRows(forecastFlux)) {
      const row = tableMeta.toObject(values);
      const at = String(row._time);
      const v = row._value as number | undefined;
      if (typeof v === "number") forecast.set(at, v);
    }

    if (forecast.size === 0) return EMPTY;

    // What the meter actually recorded, on the same hourly grid.
    const actualFlux = `from(bucket: "${config.bucket}")
  |> range(start: -${days}d, stop: now())
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${params.equipmentId}")
  |> filter(fn: (r) => r.alias == "${params.alias}")
  |> filter(fn: (r) => r._field == "value_number")
  |> aggregateWindow(every: 1h, fn: mean, createEmpty: false, timeSrc: "_start")
  |> sort(columns: ["_time"])`;

    for await (const { values, tableMeta } of queryApi.iterateRows(actualFlux)) {
      const row = tableMeta.toObject(values);
      const at = String(row._time);
      const v = row._value as number | undefined;
      if (typeof v === "number") actual.set(at, v);
    }
  } catch (err) {
    logger.warn({ err, equipmentId: params.equipmentId }, "PV accuracy query failed");
    return EMPTY;
  }

  return pairSeries(forecast, actual);
}

/**
 * Pair two hourly series on their common hours.
 *
 * Only hours present on both sides count. An hour the meter never reported is
 * not a forecast miss, and scoring it as one would make an outage look like a
 * bad model.
 */
export function pairSeries(
  forecast: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
): PvAccuracy {
  const points: AccuracyPoint[] = [];

  for (const [at, forecastW] of forecast) {
    const actualW = actual.get(at);
    if (typeof actualW !== "number") continue;
    if (!Number.isFinite(forecastW) || !Number.isFinite(actualW)) continue;
    points.push({ at, forecastW, actualW });
  }

  if (points.length === 0) return EMPTY;
  points.sort((a, b) => a.at.localeCompare(b.at));

  const totalError = points.reduce((sum, p) => sum + Math.abs(p.forecastW - p.actualW), 0);
  return {
    samples: points.length,
    maeW: Math.round(totalError / points.length),
    points,
  };
}

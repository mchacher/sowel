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
import { localDateStr } from "../../shared/local-date.js";

/** Measurement the forecaster writes its curve to. */
export const FORECAST_MEASUREMENT = "pv_forecast";

/**
 * Longest comparison window, in days.
 *
 * The forecast side lives for two years; the measured side is the 90-day
 * downsampled power series, and a pair needs both.
 */
export const MAX_ACCURACY_DAYS = 90;

/**
 * Both series label an hour by its END. Do not "fix" this.
 *
 * `sowel-downsample-hourly` aggregates without `timeSrc`, and Flux defaults that
 * to `_stop`, so a point in `-hourly` at 09:00 is the mean of 08:00-09:00.
 * Verified against the raw bucket on production data: 159 of 166 hours match to
 * the last decimal at exactly that offset.
 *
 * The forecast side inherits the same convention from the other direction.
 * Open-Meteo documents its radiation variables as **preceding-hour means**, so
 * the entry labelled 14:00 covers 13:00-14:00, and the forecaster writes its
 * curve points on those labels unchanged. On the reference site the series peaks
 * at 14:00 local against a solar noon of 13:37, which is that convention and not
 * a bug.
 *
 * Shifting one side to "align" them therefore breaks a join that was already
 * correct. Measured when it was tried: the fitted gain went from 3.8 to 45.8 and
 * the hourly shape collapsed into a monotonic decay from sunrise.
 *
 * @see MAX_ACCURACY_DAYS
 */

/** Lead bucket compared by default: what was said the day before. */
export const DEFAULT_LEAD_BUCKET = "6-24h";

export interface AccuracyPoint {
  /** Hour, UTC ISO. */
  at: string;
  forecastW: number;
  actualW: number;
}

export interface MeasuredPoint {
  /** Hour, UTC ISO. */
  at: string;
  watts: number;
}

/** One local day scored on its energy, forecast against measured. */
export interface DayEnergy {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Expected energy over the paired hours, Wh. */
  forecastWh: number;
  /** Measured energy over those same hours, Wh. */
  actualWh: number;
  /** How many hours were paired. Below `COMPLETE_DAY_HOURS` the day is partial. */
  hours: number;
}

export interface PvAccuracy {
  /** Hours compared. Zero means nothing to say, not a perfect score. */
  samples: number;
  /**
   * Mean absolute error in watts over those hours, null when there are none.
   *
   * Kept for the API's shape, no longer the headline (#907). Averaged over
   * every paired hour it is dominated by the night, where both sides are zero
   * and the error is trivially perfect: on the reference site 74 of 168 hours,
   * halving the figure and improving it every autumn as the nights lengthen.
   */
  maeW: number | null;
  /**
   * Mean absolute error on the DAILY ENERGY, Wh, over complete days only.
   *
   * This is the question a household asks of a production forecast: how far
   * off was the day. Night hours contribute nothing to an integral, so it
   * cannot be diluted by them, and it is comparable across seasons.
   */
  dailyMaeWh: number | null;
  /** The same error as a share of the measured production, percent. */
  dailyMaePct: number | null;
  /** Complete days behind `dailyMaeWh`. */
  dailyDays: number;
  /**
   * The running local day, scored on the hours elapsed so far.
   *
   * Excluded from `dailyMaeWh` — a few hours against a whole day's forecast
   * would read as a collapse in production — but reported, because "is today
   * on track" is what the aggregate score cannot answer (#907).
   */
  today: DayEnergy | null;
  /** The paired series, newest last, for the chart. */
  points: AccuracyPoint[];
  /**
   * Every hour the meter recorded over the window, paired or not.
   *
   * Separate from `points` on purpose. The error figure may only count hours
   * where a forecast was issued to compare against; the *line* on the chart has
   * no such requirement, and tying it to the pairing meant a household that had
   * just declared its installation saw a forecast drawn over an empty past
   * while its own production sat in the database, plainly known and invisible.
   */
  measured: MeasuredPoint[];
}

/** Nothing to compare. Exported so callers building the same shape cannot drift from it. */
export const EMPTY_ACCURACY: PvAccuracy = {
  samples: 0,
  maeW: null,
  dailyMaeWh: null,
  dailyMaePct: null,
  dailyDays: 0,
  today: null,
  points: [],
  measured: [],
};

/**
 * Paired hours below which a local day is partial and cannot be scored.
 *
 * 23, not 24: a DST spring-forward day genuinely has 23 hours, and requiring
 * 24 would silently drop it every year. An hour the meter missed mid-day also
 * lands a day here, which is the intended answer — an outage is not a forecast
 * miss, and scoring the day as one would blame the model for it.
 */
export const COMPLETE_DAY_HOURS = 23;

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
  if (!config || !client) return EMPTY_ACCURACY;

  // Bounded by the downsampled power retention (90 days), not by the forecast
  // side, which keeps two years. Asking for more would return fewer paired
  // hours than requested with nothing to say why.
  const days = Math.min(params.days ?? 7, MAX_ACCURACY_DAYS);
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

    // No early return on an empty forecast. The measured series is wanted
    // whether or not anything was ever promised for those hours: a household
    // that has just declared its installation has no forecast history at all,
    // and skipping the query here is what left its own production invisible
    // under a curve drawn over an empty past.

    // What the meter actually recorded, on the same hourly grid.
    //
    // No time shift here, and that is deliberate — see the note on hour stamps
    // below. Both sides of this join label an hour by its END, so they already
    // line up.
    //
    // The downsampled bucket, not the raw one. Raw retention is seven days —
    // exactly the default window, so the comparison would sit permanently on
    // the eviction boundary and any longer window would silently return only
    // the last week, `pairSeries` having quietly dropped every forecast hour
    // whose partner had expired. `-hourly` keeps 90 days of the same series,
    // already aggregated to the hour and stamped at the hour start, which is
    // where the forecast points sit too.
    const actualFlux = `from(bucket: "${config.bucket}-hourly")
  |> range(start: -${days}d, stop: now())
  |> filter(fn: (r) => r._measurement == "equipment_data")
  |> filter(fn: (r) => r.equipmentId == "${params.equipmentId}")
  |> filter(fn: (r) => r.alias == "${params.alias}")
  |> filter(fn: (r) => r._field == "mean")
  |> sort(columns: ["_time"])`;

    for await (const { values, tableMeta } of queryApi.iterateRows(actualFlux)) {
      const row = tableMeta.toObject(values);
      const at = String(row._time);
      const v = row._value as number | undefined;
      if (typeof v === "number") actual.set(at, v);
    }
  } catch (err) {
    logger.warn({ err, equipmentId: params.equipmentId }, "PV accuracy query failed");
    return EMPTY_ACCURACY;
  }

  return { ...pairSeries(forecast, actual), measured: toMeasured(actual) };
}

/** The measured series as the chart wants it: sorted, finite, oldest first. */
export function toMeasured(actual: ReadonlyMap<string, number>): MeasuredPoint[] {
  const out: MeasuredPoint[] = [];
  for (const [at, watts] of actual) {
    if (!Number.isFinite(watts)) continue;
    out.push({ at, watts });
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/**
 * The local day an hourly point belongs to.
 *
 * Both series label an hour by its END (see the note at the top of this file),
 * so the point stamped at local midnight covers 23:00-00:00 and belongs to the
 * day that just ended. Bucketing it on its own date would hand every day its
 * predecessor's last hour. For a PV series that hour is zero and the sums do
 * not move, but the day count does, and a day is scored or dropped on it.
 */
function localDayOf(at: string): string | null {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return localDateStr(new Date(ms - 1));
}

/**
 * Sum the paired hours into local days.
 *
 * Both sides are summed over the SAME hours: an hour the meter never reported
 * is absent from the pairing, so it is missing from both integrals rather than
 * counting as a production of zero against a forecast. That is what makes a
 * partial day (the running one) comparable at all.
 */
export function aggregateDays(points: readonly AccuracyPoint[]): DayEnergy[] {
  const byDay = new Map<string, DayEnergy>();
  for (const p of points) {
    const day = localDayOf(p.at);
    if (day === null) continue;
    const entry = byDay.get(day) ?? { day, forecastWh: 0, actualWh: 0, hours: 0 };
    // One hour of an hourly mean power in W is that many Wh.
    entry.forecastWh += p.forecastW;
    entry.actualWh += p.actualW;
    entry.hours += 1;
    byDay.set(day, entry);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The daily-energy error, and the running day.
 *
 * `now` is injected rather than read here so the caller (and the tests) decide
 * what "today" means; the boundary is local, like every day boundary in the
 * energy stack.
 */
export function scoreDays(
  points: readonly AccuracyPoint[],
  now: Date = new Date(),
): Pick<PvAccuracy, "dailyMaeWh" | "dailyMaePct" | "dailyDays" | "today"> {
  const days = aggregateDays(points);
  const todayStr = localDateStr(now);

  const today = days.find((d) => d.day === todayStr) ?? null;
  // Complete days only, and never the running one: it is complete only in the
  // last hour of the evening, and would swing the average until then.
  const scored = days.filter((d) => d.day !== todayStr && d.hours >= COMPLETE_DAY_HOURS);
  if (scored.length === 0) {
    return { dailyMaeWh: null, dailyMaePct: null, dailyDays: 0, today };
  }

  const totalErrorWh = scored.reduce((sum, d) => sum + Math.abs(d.forecastWh - d.actualWh), 0);
  // A share of what was actually produced over the same days, not the mean of
  // per-day percentages: a near-zero December day would otherwise post a 300%
  // error on a few hundred watt-hours and drag the average on its own.
  const totalActualWh = scored.reduce((sum, d) => sum + d.actualWh, 0);

  return {
    dailyMaeWh: Math.round(totalErrorWh / scored.length),
    dailyMaePct: totalActualWh > 0 ? Math.round((1000 * totalErrorWh) / totalActualWh) / 10 : null,
    dailyDays: scored.length,
    today,
  };
}

/**
 * Pair two hourly series on their common hours.
 *
 * Only hours present on both sides count. An hour the meter never reported is
 * not a forecast miss, and scoring it as one would make an outage look like a
 * bad model. The measured series rides along untouched, so the chart can draw
 * production for hours nothing was ever promised for.
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

  if (points.length === 0) return { ...EMPTY_ACCURACY, measured: toMeasured(actual) };
  points.sort((a, b) => a.at.localeCompare(b.at));

  const totalError = points.reduce((sum, p) => sum + Math.abs(p.forecastW - p.actualW), 0);
  return {
    samples: points.length,
    maeW: Math.round(totalError / points.length),
    ...scoreDays(points),
    points,
    measured: toMeasured(actual),
  };
}

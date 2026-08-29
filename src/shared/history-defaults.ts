// ============================================================
// History defaults — convention over configuration
//
// Whether a data binding is historized is decided from its alias and its
// category unless the owner forced it either way. The rule lived inside
// HistoryWriter, which meant the UI could not tell the owner what adding a
// binding would start recording without restating it (issue #707) — and a
// restated copy is exactly what spec 150 had to undo for binding candidates.
// It is a pure function of three values, so it lives here and both sides call
// the same one.
// ============================================================

/** Categories historized ON by default. */
export const CATEGORY_DEFAULTS_ON: ReadonlySet<string> = new Set([
  "temperature",
  "temperature_outdoor",
  "temperature_device",
  "humidity",
  "humidity_outdoor",
  "pressure",
  "luminosity",
  "power",
  "energy",
  "rain",
  "wind",
  "co2",
  "voc",
  "noise",
  "voltage",
  "current",
  "shutter_position",
  "battery",
]);

/** Aliases historized ON regardless of category (handles generic bindings). */
export const ALIAS_DEFAULTS_ON: ReadonlySet<string> = new Set(["setpoint", "power"]);

/** Aliases forced OFF — live-only values, not useful as time series.
 * `energy_forward` / `energy_reverse` are the raw cumulative Shelly
 * counters: monotonically growing, several hundred kWh in absolute
 * terms. They are needed as latest values (Live page) but writing them
 * as time-series points would pollute every category=energy aggregation
 * with the cumul (sum-of-cumuls), since the EnergyAggregator and the
 * downsampling tasks group on category, not alias.
 *
 * `sum_rain_1` / `sum_rain_24` are the same class of bug for rain: Netatmo's
 * ROLLING 1h / 24h totals, re-reported at every poll. Historizing them makes
 * the rain chart plot a flat rolling total ("11.9 mm every hour") and makes
 * any `category == "rain"` |> sum() (WeatherAggregator) a sum-of-cumuls. The
 * incremental `rain` alias stays historized; the live rolling totals are read
 * from the equipment binding, not InfluxDB. */
export const ALIAS_DEFAULTS_OFF: ReadonlySet<string> = new Set([
  "demand_30min",
  "energy_forward",
  "energy_reverse",
  "sum_rain_1",
  "sum_rain_24",
  "wind_angle",
  "gust_strength",
  "gust_angle",
]);

/**
 * Whether a data binding is written to InfluxDB.
 *
 * @param historize explicit override: 1 forces ON, 0 forces OFF, null/undefined
 *                  falls through to the conventions below.
 */
export function resolveHistorize(
  historize: number | null | undefined,
  alias: string,
  category: string,
): boolean {
  // 1. Explicit override
  if (historize === 1) return true;
  if (historize === 0) return false;
  // 2. Alias exclusion (cumulative counters, forecast data — not useful as time series)
  if (ALIAS_DEFAULTS_OFF.has(alias)) return false;
  if (/^j\d+_/.test(alias)) return false; // forecast jX_* bindings — not historized
  // 3. Alias default
  if (ALIAS_DEFAULTS_ON.has(alias)) return true;
  // 4. Category default
  if (CATEGORY_DEFAULTS_ON.has(category)) return true;
  return false;
}

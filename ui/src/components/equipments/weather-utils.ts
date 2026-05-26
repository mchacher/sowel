import type { ComputedDataEntry, DataBindingWithValue } from "../../types";

/**
 * Build a synthetic DataBindingWithValue from a ComputedDataEntry so the
 * value can flow through binding-shaped UI helpers (SensorValues, WeatherPanel).
 *
 * Use only as a fallback when the real cumulative-rain binding (sum_rain_*)
 * isn't attached to the equipment but Sowel still exposes the computed value
 * — typical of the Netatmo plugin which auto-binds only the instantaneous
 * `rain` device-side and emits rain_1h / rain_24h as computed data.
 *
 * The returned binding mimics the shape of a real binding closely enough
 * (key, category, unit, value) for downstream filters and formatters; the
 * id is prefixed `computed:` so consumers that care can tell them apart.
 */
export function syntheticBindingFromComputed(
  equipmentId: string,
  computed: ComputedDataEntry,
  options: { key: string; deviceId?: string; deviceName?: string },
): DataBindingWithValue {
  return {
    id: `computed:${computed.alias}`,
    equipmentId,
    deviceDataId: `computed:${computed.alias}`,
    alias: computed.alias,
    deviceId: options.deviceId ?? "computed",
    deviceName: options.deviceName ?? "computed",
    key: options.key,
    type: "number",
    category: computed.category ?? "rain",
    value: computed.value,
    unit: computed.unit,
    lastUpdated: computed.lastUpdated,
    lastChanged: computed.lastUpdated,
    stale: false,
  };
}

/** 16-point compass abbreviations (FR). 0° = N, clockwise. */
const COMPASS_FR = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO",
];

/** Convert a meteorological wind angle (0 = North, clockwise) to a compass abbreviation. */
export function angleToCompass(angle: number): string {
  const normalized = ((angle % 360) + 360) % 360;
  const idx = Math.round(normalized / 22.5) % 16;
  return COMPASS_FR[idx];
}

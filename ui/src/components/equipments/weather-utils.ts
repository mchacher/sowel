import type { ComputedDataEntry, DataBindingWithValue, EquipmentWithDetails } from "../../types";

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

/**
 * Find the indoor/outdoor temperature or humidity binding by data category.
 *
 * Lookup by category (not by key/alias) is mandatory because a single weather
 * equipment can carry two bindings sharing the same key, e.g. both the Netatmo
 * base station (`category: "temperature"`, indoor) and the outdoor module
 * (`category: "temperature_outdoor"`) push a `temperature` key. The auto-binding
 * deduplicates aliases (`temperature` / `temperature_2`) so the alias alone is
 * ambiguous about which is which — only the category is stable.
 */
export function findTempOutdoor(bindings: DataBindingWithValue[]): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === "temperature_outdoor");
}
export function findTempIndoor(bindings: DataBindingWithValue[]): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === "temperature");
}
export function findHumidityOutdoor(bindings: DataBindingWithValue[]): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === "humidity_outdoor");
}
export function findHumidityIndoor(bindings: DataBindingWithValue[]): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === "humidity");
}

/**
 * Today's measured min/max for the indoor or outdoor temperature (spec 134).
 *
 * The backend tracker exposes `<alias>_min_today` / `<alias>_max_today`
 * computed entries per temperature binding. The alias is derived from the
 * source binding (which varies: `temperature`, `temperature_2`, ...), so we
 * resolve the source binding by category first, then look its computed
 * extremes up by alias. Returns null unless both bounds are numbers.
 */
export function findTempExtremes(
  equipment: EquipmentWithDetails,
  category: "temperature" | "temperature_outdoor",
): { min: number; max: number } | null {
  const source = equipment.dataBindings.find((b) => b.category === category);
  if (!source) return null;
  const computed = equipment.computedData ?? [];
  const min = computed.find((c) => c.alias === `${source.alias}_min_today`)?.value;
  const max = computed.find((c) => c.alias === `${source.alias}_max_today`)?.value;
  if (typeof min !== "number" || typeof max !== "number") return null;
  return { min, max };
}

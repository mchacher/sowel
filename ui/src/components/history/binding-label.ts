import type { TFunction } from "i18next";
import type { HistoryBindingState } from "../../types";

export interface BindingLabelInput {
  alias: string;
  category: string;
  /** Backing physical device name. Used as a disambiguator when an equipment
   * exposes several bindings sharing the same category (batteries, …). */
  deviceName?: string;
  /** How many bindings on the same equipment carry this binding's category.
   * When > 1, the helper falls back to `${categoryLabel} ${deviceName}` to
   * keep them distinguishable. Callers compute this from their binding list. */
  sameCategoryCount?: number;
}

/**
 * Derives a human-readable label for a binding that's about to appear in a
 * chart-picker / legend / pill (Analyse page, History panel, etc.).
 *
 * The label is *equipment-level* by design: it expresses what the binding
 * exposes from the equipment's point of view, not which physical device
 * produces it. Going down to the device is reserved for the cases where the
 * equipment abstraction has no way to disambiguate (typically: several
 * batteries on a multi-module station — same category, no semantic sibling
 * like temperature/temperature_outdoor to lean on).
 *
 * Lookup order:
 *   1. Metric-specific key (wind_strength → "Vitesse du vent",
 *      sum_rain_24 → "Pluie 24h", …) — the alias's _N dedup suffix is
 *      stripped before lookup.
 *   2. Indoor / outdoor disambiguation derived from the data category
 *      itself (`temperature_outdoor`, `humidity_outdoor`, …).
 *   3. If the category appears more than once on the equipment AND a
 *      `deviceName` is available, suffix the device name (Batterie Module
 *      Extérieur, …).
 *   4. Plain category label (Pression, CO₂, …).
 */

/**
 * Per-key labels for metrics where the category alone (e.g. "wind") is too
 * coarse to distinguish the actual measurement (speed vs gust vs angle).
 * Values are i18n keys.
 */
const METRIC_LABELS: Record<string, string> = {
  wind_strength: "weather.windSpeed",
  wind_angle: "weather.windDirection",
  gust_strength: "weather.gustSpeed",
  gust_angle: "weather.gustDirection",
  rain: "weather.rainCurrent",
  sum_rain_1: "weather.rain1h",
  sum_rain_24: "weather.rain24h",
  rain_1h: "weather.rain1h",
  rain_24h: "weather.rain24h",
};

/** Categories that always have a clean i18n label and no inherent ambiguity. */
function categoryLabel(category: string, t: TFunction): string {
  // i18next falls back to the key if no translation exists, which is safer
  // than throwing for an unknown category (e.g. an exotic plugin category).
  return t(`category.${category}`);
}

export function humanBindingLabel(input: BindingLabelInput, t: TFunction): string {
  const { alias, category, deviceName, sameCategoryCount = 1 } = input;

  // 1. Metric-specific (overrides everything else). Try the alias direct
  // first because some original keys carry a numeric suffix that looks like
  // a dedup tag but isn't (e.g. `sum_rain_1`, `sum_rain_24`). Only then
  // try the de-deduped form for cases like `temperature_2`. The alias
  // de-dup counter starts at 2 (see uniqueAlias()), so `_1` is never a
  // dedup tag and can safely live in METRIC_LABELS keys.
  const directMetric = METRIC_LABELS[alias];
  if (directMetric) return t(directMetric);
  const strippedKey = alias.replace(/_\d+$/, "");
  if (strippedKey !== alias && METRIC_LABELS[strippedKey]) {
    return t(METRIC_LABELS[strippedKey]);
  }

  // 2. Indoor / outdoor disambiguation via the category itself
  const indoor = t("weather.indoor").toLowerCase();
  const outdoor = t("weather.outdoor").toLowerCase();
  if (category === "temperature_outdoor") return `${t("category.temperature")} ${outdoor}`;
  if (category === "temperature") return `${t("category.temperature")} ${indoor}`;
  if (category === "humidity_outdoor") return `${t("category.humidity")} ${outdoor}`;
  if (category === "humidity") return `${t("category.humidity")} ${indoor}`;

  // 3. Multi-instance category → device name as disambiguator
  if (sameCategoryCount > 1 && deviceName) {
    return `${categoryLabel(category, t)} ${deviceName}`;
  }

  // 4. Plain category
  return categoryLabel(category, t);
}

/**
 * Convenience for callers that already hold a HistoryBindingState array:
 * counts siblings on the fly. Use the lower-level `humanBindingLabel` when
 * the count is already known (e.g. embedded in a SeriesConfig).
 */
export function humanBindingLabelFromList(
  binding: HistoryBindingState,
  allBindings: readonly HistoryBindingState[],
  t: TFunction,
): string {
  return humanBindingLabel(
    {
      alias: binding.alias,
      category: binding.category,
      deviceName: binding.deviceName,
      sameCategoryCount: allBindings.filter((b) => b.category === binding.category).length,
    },
    t,
  );
}

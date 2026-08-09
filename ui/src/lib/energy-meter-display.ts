import type { DataBindingWithValue } from "../types";

/**
 * Pick the live instantaneous power of an energy meter (issue #376).
 * The generic `power`-category binding wins; Legrand NLPC meters expose only
 * a `demand_5min` alias (W averaged over 5 minutes) which is used as fallback.
 */
export function pickLivePowerW(bindings: DataBindingWithValue[]): number | null {
  const power = bindings.find((b) => b.category === "power" && typeof b.value === "number");
  if (power) return power.value as number;
  const demand = bindings.find((b) => b.alias === "demand_5min" && typeof b.value === "number");
  return demand ? (demand.value as number) : null;
}

/** Format a watt value: 1257 → "1.3 kW", 850 → "850 W". */
export function formatWatts(w: number): { value: string; unit: string } {
  if (Math.abs(w) >= 1000) return { value: (w / 1000).toFixed(1), unit: "kW" };
  return { value: String(Math.round(w)), unit: "W" };
}

/**
 * Format an energy value in Wh with kWh and MWh tiers — meter lifetime
 * indexes (e.g. Shelly `energy_forward`) reach millions of Wh.
 */
export function formatEnergyWh(wh: number): { value: string; unit: string } {
  if (Math.abs(wh) >= 1_000_000) return { value: (wh / 1_000_000).toFixed(2), unit: "MWh" };
  if (Math.abs(wh) >= 1000) return { value: (wh / 1000).toFixed(2), unit: "kWh" };
  return { value: String(Math.round(wh)), unit: "Wh" };
}

/**
 * Format any bound measurement for the meter measurements panel.
 * Category-aware for the electrical quantities, unit-passthrough otherwise.
 */
export function formatMeasurement(b: DataBindingWithValue): { value: string; unit: string } {
  if (typeof b.value !== "number") {
    const text = b.value === null || b.value === undefined ? "—" : String(b.value);
    return { value: text, unit: b.unit ?? "" };
  }
  switch (b.category) {
    case "power":
      return formatWatts(b.value);
    case "energy":
      return formatEnergyWh(b.value);
    case "voltage":
      return { value: b.value.toFixed(1), unit: b.unit ?? "V" };
    case "current":
      return { value: b.value.toFixed(2), unit: b.unit ?? "A" };
    default: {
      const value = Math.abs(b.value) >= 100 ? String(Math.round(b.value)) : String(Number(b.value.toFixed(2)));
      return { value, unit: b.unit ?? "" };
    }
  }
}

/** Display order of measurement rows in the meter panel. */
const MEASUREMENT_CATEGORY_ORDER = ["power", "voltage", "current", "energy"] as const;

/**
 * Sort a meter's bound measurements for display: electrical quantities first
 * (power, voltage, current, energy), then everything else in binding order.
 * The sort is stable so same-category bindings keep their relative order.
 */
export function sortMeasurements(bindings: DataBindingWithValue[]): DataBindingWithValue[] {
  const rank = (b: DataBindingWithValue): number => {
    const i = (MEASUREMENT_CATEGORY_ORDER as readonly string[]).indexOf(b.category);
    return i === -1 ? MEASUREMENT_CATEGORY_ORDER.length : i;
  };
  return bindings.slice().sort((a, b) => rank(a) - rank(b));
}

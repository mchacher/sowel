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

/** First numeric voltage binding (V), or null when not bound. */
export function pickVoltageV(bindings: DataBindingWithValue[]): number | null {
  const b = bindings.find((b) => b.category === "voltage" && typeof b.value === "number");
  return b ? (b.value as number) : null;
}

/** First numeric current binding (A), or null when not bound. */
export function pickCurrentA(bindings: DataBindingWithValue[]): number | null {
  const b = bindings.find((b) => b.category === "current" && typeof b.value === "number");
  return b ? (b.value as number) : null;
}

/**
 * First numeric power-factor binding, or null. No dedicated data category
 * exists — devices expose it as `generic` under a `power_factor` or `pf`
 * alias, which is what we match on.
 */
export function pickPowerFactor(bindings: DataBindingWithValue[]): number | null {
  const b = bindings.find(
    (b) => (b.alias === "power_factor" || b.alias === "pf") && typeof b.value === "number",
  );
  return b ? (b.value as number) : null;
}

/** Format a watt value: 1257 → "1.3 kW", 850 → "850 W". */
export function formatWatts(w: number): { value: string; unit: string } {
  if (Math.abs(w) >= 1000) return { value: (w / 1000).toFixed(1), unit: "kW" };
  return { value: String(Math.round(w)), unit: "W" };
}

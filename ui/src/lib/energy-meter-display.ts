import type { DataBindingWithValue } from "../types";

/**
 * The binding behind an energy meter's live instantaneous power (issue #376).
 *
 * The `power`-category binding, and only that one. It used to fall back on a
 * `demand_5min` alias, on the premise that Legrand NLPC meters expose nothing
 * else; they expose `power`, no plugin in the registry has ever produced
 * `demand_5min`, and its only declaration in this repository's history was a
 * test fixture (spec 175).
 *
 * Exposed alongside `pickLivePowerW` because a caller judging the reading's
 * freshness needs the binding's `lastUpdated`, not just its value (#839).
 */
export function pickLivePowerBinding(
  bindings: DataBindingWithValue[],
): DataBindingWithValue | undefined {
  return bindings.find((b) => b.category === "power" && typeof b.value === "number");
}

/** Value of the binding `pickLivePowerBinding` selects, or null when none is bound. */
export function pickLivePowerW(bindings: DataBindingWithValue[]): number | null {
  const b = pickLivePowerBinding(bindings);
  return b ? (b.value as number) : null;
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

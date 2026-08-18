import type { EquipmentWithDetails } from "../../types";

export type Speed = "off" | "v1" | "v2";

/** Interpret a relay state binding value as boolean. */
export function relayOn(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "on" || s === "true" || s === "1";
  }
  return false;
}

/**
 * Current VMC speed. Prefers the live `low`/`high` relay state bindings (they
 * update on every WebSocket push, including external/confirmed changes) and
 * falls back to the computed `speed` (which the optimistic command emit fills
 * for relays that report no state feedback). null when neither is known.
 */
export function vmcSpeedOf(equipment: EquipmentWithDetails): Speed | null {
  const low = equipment.dataBindings.find((d) => d.alias === "low");
  const high = equipment.dataBindings.find((d) => d.alias === "high");
  if (low || high) {
    return high && relayOn(high.value) ? "v2" : low && relayOn(low.value) ? "v1" : "off";
  }
  const computed = equipment.computedData?.find((c) => c.alias === "speed")?.value;
  return computed === "off" || computed === "v1" || computed === "v2" ? computed : null;
}

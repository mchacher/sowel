import type { EquipmentWithDetails, OrderBindingWithDetails, OrderCategory } from "../../../types";
import { findDataByCategory, findOrderByCategory } from "../../equipments/bindingUtils";

// Spec 149 — shared binding lookups for the presentation resolvers.
// These unify the 7 hand-rolled copies that had drifted across the desktop
// sub-widgets, the mobile card and the mobile tap action (issue #325).

/**
 * Find the ON/OFF toggle order binding, category-first (spec 110) with the
 * legacy alias/shape fallback, and reject non-togglable types.
 */
export function findToggleBinding(
  bindings: readonly OrderBindingWithDetails[],
  categories: readonly OrderCategory[],
): OrderBindingWithDetails | undefined {
  const binding =
    findOrderByCategory(bindings, categories, ["state"]) ??
    bindings.find((ob) => ob.type === "boolean" || (ob.alias === "state" && ob.type === "enum"));
  if (!binding) return undefined;
  return binding.type === "enum" || binding.type === "boolean" ? binding : undefined;
}

/**
 * Values a toggle control sends. Enum values are matched case-insensitively
 * with a literal ON/OFF fallback; boolean orders send true/false — except a
 * boolean binding aliased `state`, which keeps the historical ON/OFF strings
 * (legacy relay contract preserved from the pre-resolver sub-widgets).
 */
export function toggleValues(binding: OrderBindingWithDetails): {
  onValue: unknown;
  offValue: unknown;
} {
  if (binding.type === "boolean" && binding.alias !== "state") {
    return { onValue: true, offValue: false };
  }
  return {
    onValue: binding.enumValues?.find((v) => /^on$/i.test(v)) ?? "ON",
    offValue: binding.enumValues?.find((v) => /^off$/i.test(v)) ?? "OFF",
  };
}

/**
 * Relay-style ON state from the canonical `light_state` data binding
 * (category-first, `state` alias fallback — spec 110). Accepts the value
 * shapes seen across integrations: boolean, "ON"/"on", numeric 1.
 */
export function isOnFromStateBinding(equipment: EquipmentWithDetails): boolean {
  const binding = findDataByCategory(equipment.dataBindings, ["light_state"], ["state"]);
  if (!binding) return false;
  return (
    binding.value === true ||
    binding.value === 1 ||
    (typeof binding.value === "string" && binding.value.toUpperCase() === "ON")
  );
}

/** Format a daily runtime in seconds as a compact string (45s, 12m, 1h 05m). */
export function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

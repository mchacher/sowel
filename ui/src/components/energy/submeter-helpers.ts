/**
 * Pure helpers for the Live submeter breakdown (spec 117).
 * Co-located with `LiveSubmeterBreakdown.tsx` and exported separately
 * so the component stays focused on rendering and the logic is unit-testable.
 */

import type { EquipmentStatus, EquipmentWithDetails } from "../../types";
import { pickSubmeterColor } from "./submeterPalette";
import { isSubmeterEquipment } from "../../lib/metering";

export interface SubmeterRow {
  id: string;
  name: string;
  /** Instantaneous power in W. Null when binding is missing or equipment offline. */
  power: number | null;
  status: EquipmentStatus;
  /** ISO timestamp from spec 116 statusReason, if available. */
  offlineSince: string | null;
  color: string;
}

/**
 * Read the `power` alias from a submeter equipment.
 * Returns null when the equipment is fully offline, when no `power` binding
 * exists, or when the value is non-numeric. Negative values are returned as
 * their absolute value (clamp wired backwards — same convention as spec 091
 * backend integration).
 */
export function readSubmeterPower(eq: EquipmentWithDetails): number | null {
  if (eq.status === "offline") return null;
  const binding = eq.dataBindings.find((b) => b.alias === "power");
  if (!binding || typeof binding.value !== "number") return null;
  return Math.abs(binding.value);
}

/**
 * Build the legend rows for the donut.
 * Steps:
 *   1. Filter to submeters: `energy_meter`s + metering switches (spec 129).
 *   2. Sort by `id` ascending and assign a palette color by index — this is
 *      the SAME indexing rule the backend uses for the historical By-usage
 *      chart, so a given equipment gets the same color in both views.
 *   3. Re-sort the rows for display: by power descending, then null-power
 *      (offline / no data) last.
 */
export function buildSubmeterRows(
  equipments: EquipmentWithDetails[],
): SubmeterRow[] {
  const byId = [...equipments]
    .filter((eq) => isSubmeterEquipment(eq))
    .sort((a, b) => a.id.localeCompare(b.id));

  const rows: SubmeterRow[] = byId.map((eq, idx) => ({
    id: eq.id,
    name: eq.name,
    power: readSubmeterPower(eq),
    status: eq.status,
    offlineSince: eq.statusReason?.offlineSince ?? null,
    color: pickSubmeterColor(idx),
  }));

  rows.sort((a, b) => {
    const aNull = a.power === null;
    const bNull = b.power === null;
    if (aNull && !bNull) return 1;
    if (!aNull && bNull) return -1;
    if (aNull && bNull) return a.name.localeCompare(b.name);
    return (b.power as number) - (a.power as number);
  });

  return rows;
}

/**
 * Residual consumption not captured by any submeter.
 * Clamped to ≥ 0 — when `Σ submeters > house` (noise, clamp inaccuracy),
 * we report 0 rather than a negative value.
 */
export function computeOther(house: number, submeters: SubmeterRow[]): number {
  const sum = submeters.reduce(
    (acc, r) => acc + (r.power ?? 0),
    0,
  );
  return Math.max(0, house - sum);
}

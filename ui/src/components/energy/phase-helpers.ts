/**
 * Per-phase power extraction for 3-phase main energy meters (spec 132).
 *
 * Reads `power_l{n}` data-binding aliases bound on `main_energy_meter`
 * equipments (convention: any plugin exposing per-phase power binds it under
 * this alias — not Legrand-specific). Pure logic, split out from
 * PhaseBreakdown.tsx so it can be unit-tested (mirrors submeter-helpers.ts).
 */

import type { EquipmentWithDetails } from "../../types";
import { formatPower } from "../../lib/format";

export interface PhaseValue {
  n: number;
  power: number;
}

const PHASE_ALIAS = /^power_l(\d+)$/;

export function extractPhases(equipments: EquipmentWithDetails[]): PhaseValue[] {
  const byPhase = new Map<number, number>();
  for (const eq of equipments) {
    for (const b of eq.dataBindings) {
      const m = PHASE_ALIAS.exec(b.alias);
      if (!m || typeof b.value !== "number") continue;
      const n = Number(m[1]);
      byPhase.set(n, (byPhase.get(n) ?? 0) + b.value);
    }
  }
  return [...byPhase.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, power]) => ({ n, power }));
}

/** A phase's power, unsigned: « 270 W » (to the nearest 5), « 1,2 kW ». */
export function formatPhasePower(value: number, locale?: string): string {
  return formatPower(Math.abs(value), { step: 5, locale });
}

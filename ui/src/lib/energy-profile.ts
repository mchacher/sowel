import type { EnergyLoadClass, EquipmentType } from "../types";

/**
 * Spec 140 — form defaults for the flexible-load profile.
 *
 * NOTE: duplicated from `src/shared/constants.ts` (same situation as
 * `binding-candidates`): the backend copy is authoritative, this one only
 * pre-fills the form. Keep both in sync when the mapping changes.
 */
export function defaultEnergyClassFor(type: EquipmentType): EnergyLoadClass | null {
  switch (type) {
    case "water_heater":
    case "pool_pump":
    case "pool_heat_pump":
    case "water_valve":
      return "deferrable";
    case "thermostat":
    case "heater":
      return "comfort";
    default:
      return null;
  }
}

/**
 * Issue #546 — the form edits minOn/minOff in minutes; storage and API stay
 * in seconds (`minOnS`/`minOffS`). One decimal on display so legacy values
 * that are not a multiple of 60 s (e.g. 90 s → 1.5 min) round-trip unchanged.
 */
export function secondsToMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60);
}

export function defaultEnergyTimingsFor(type: EquipmentType): { minOnS: number; minOffS: number } {
  switch (type) {
    case "water_heater":
      return { minOnS: 300, minOffS: 300 };
    case "pool_heat_pump":
    case "thermostat":
    case "heater":
      return { minOnS: 900, minOffS: 600 };
    default:
      return { minOnS: 900, minOffS: 300 };
  }
}

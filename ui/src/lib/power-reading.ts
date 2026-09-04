import {
  BUDGET_LEARNING_MS,
  classifyPowerReading,
  type ReadingVerdict,
} from "../../../src/shared/reading-freshness";
import type { DataBindingWithValue, EquipmentWithDetails } from "../types";

// ============================================================
// May a tile print this wattage as a live measurement? (#839)
//
// The rule itself lives in shared/reading-freshness.ts and is already the
// authority for the Live breakdown (#833) and the `?role=submeter` feed
// (#840). What was missing is a way for the equipment tiles to ask it, and
// they are the reason it has to be asked at all: `equipment-status.ts`
// applies the electrical window only to METERING_EQUIPMENT_TYPES, so a
// water_heater carrying a power channel reports `stale: false` however old
// its value is. Production, during #744: 560 W drawn, `0 W` displayed, age
// 944 s, stale false.
//
// This module judges; it does not select and it does not format. Selection
// stays at the call sites because their lookups legitimately differ (the water
// heater column wants the `power` category, a meter card its `power` alias),
// and routing them all through one lookup here would change what each surface
// displays, which is not what this fix is for.
// Formatting stays there too: two decimals on the compact card, one in the
// meter's secondary row, none in the water heater column.
// ============================================================

export interface PowerReading {
  /**
   * The wattage a surface may render, or null when it must not be presented
   * as a current measurement. Non-null only when the verdict is "current",
   * so a caller that renders `watts` and nothing else is already correct.
   */
  watts: number | null;
  verdict: ReadingVerdict;
  /**
   * When the last reading dates from, for the "reading outdated · 16 min"
   * sub-label. Null unless the verdict is "stale": an offline equipment is
   * dated by its device dropping off, not by the age of a number, and saying
   * "16 min" there would send the reader looking at a reporting interval
   * instead of at a dead radio (the ordering `classifyPowerReading` documents).
   */
  since: string | null;
}

/**
 * Judge one power binding on behalf of a tile.
 *
 * The binding is passed in rather than looked up: see the module note. Pass
 * `undefined` for "this equipment has no such binding" and the verdict is
 * `missing`, which every surface already renders as nothing at all.
 *
 * `now` is injectable so component tests can age a reading without touching
 * the clock, the way the shared module's own tests do.
 */
export function resolvePowerReading(
  equipment: EquipmentWithDetails,
  binding: DataBindingWithValue | undefined,
  now: number = Date.now(),
): PowerReading {
  const verdict = classifyPowerReading({
    status: equipment.status,
    value: binding?.value,
    lastUpdated: binding?.lastUpdated,
    equipmentType: equipment.type,
    now,
    // Resolved by the engine from this source's own cadence and carried on the
    // binding (spec 175). A tile no longer decides how old is too old, which is
    // how the same meter used to read live here and outdated in its zone total.
    budgetMs: binding?.freshnessBudgetMs ?? BUDGET_LEARNING_MS,
  });
  return {
    watts: verdict === "current" && typeof binding?.value === "number" ? binding.value : null,
    verdict,
    since: verdict === "stale" ? (binding?.lastUpdated ?? null) : null,
  };
}

/** True when a surface must say "outdated" rather than draw a number. */
export function isOutdated(reading: PowerReading): boolean {
  return reading.verdict === "stale";
}

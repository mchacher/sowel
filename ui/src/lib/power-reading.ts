import {
  classifyPowerReading,
  SUBMETER_FRESHNESS_SLOW_MS,
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
// stays at the call sites because their lookups legitimately differ (the
// water heater column wants the `power` category, a Legrand meter falls back
// to `demand_5min`), and routing them all through one lookup here would
// change what each surface displays, which is not what this fix is for.
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
 * The freshness budget a reading answers to, when its own cadence outranks the
 * window its equipment type implies.
 *
 * `METERING_EQUIPMENT_TYPES` earns the tight two-minute window because the
 * engine expects a declared meter to report continuously. Two sources in that
 * set do not, and applying it to them would call a perfectly healthy device
 * outdated for most of every reporting cycle — the exact oscillation the
 * shared module documents and avoids for slow pollers:
 *
 * - `demand_5min`: a Legrand NLPC reports a power already averaged over five
 *   minutes, so the reading cannot be fresher than five minutes by
 *   construction.
 * - `solar_panel`: the one solar integration in the registry (apsystems)
 *   delivers on a Tasmota `tele/<root>/SENSOR` topic, whose default
 *   `TelePeriod` is 300 s. Under the meter window a panel in full sun would
 *   blank for roughly three minutes out of every five.
 *
 * The ten-minute slow budget is twice the slowest of those cadences, so
 * neither oscillates, and it still catches the failure this issue is about
 * (#744 measured a reading 124 days old).
 *
 * Returning undefined means "no override": the type's own budget applies.
 */
function budgetFor(
  equipment: EquipmentWithDetails,
  binding: DataBindingWithValue | undefined,
): number | undefined {
  if (binding?.alias === "demand_5min") return SUBMETER_FRESHNESS_SLOW_MS;
  if (equipment.type === "solar_panel") return SUBMETER_FRESHNESS_SLOW_MS;
  return undefined;
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
    budgetMs: budgetFor(equipment, binding),
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

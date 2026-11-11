/**
 * TariffClassifier — Classifies energy windows into HP/HC based on tariff schedule.
 *
 * Reads the tariff schedule from settings and splits energy (Wh) for a 30-min
 * window into HP and HC portions using linear prorata when a window straddles
 * a tariff transition.
 *
 * Used by the HistoryWriter at write time to produce `energy_hp` and `energy_hc`
 * data points alongside the total `energy` point.
 */

import type { Logger } from "../core/logger.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type {
  DaySchedule,
  TariffConfig,
  TariffSeason,
  TariffSlot,
  TariffSplit,
} from "../shared/types.js";

const SETTINGS_KEY = "energy.tariff";
const HALF_HOUR_S = 1800;

/** Spec 204 — the Enedis summer: 1 April to 31 October, both inclusive. */
export const SUMMER_DEFAULT: Readonly<Pick<TariffSeason, "from" | "to">> = {
  from: "04-01",
  to: "10-31",
};

/** The local `MM-DD` of a date (spec 061: the season is read on the local day). */
function localMonthDay(at: Date): string {
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/**
 * Whether a local date falls in the stored summer, both ends inclusive.
 * `MM-DD` strings compare as strings. Spec 204.
 */
export function isSummer(season: Pick<TariffSeason, "from" | "to">, at: Date): boolean {
  const md = localMonthDay(at);
  return season.from <= md && md <= season.to;
}

/**
 * The day schedules in force on a local date: the summer ones on a summer day
 * when the config has a summer, `schedules` otherwise. Every reader of the
 * schedule (classification, recipe snapshot) goes through this. Spec 204.
 */
export function schedulesOn(config: TariffConfig, at: Date): DaySchedule[] {
  if (config.summer && isSummer(config.summer, at)) return config.summer.schedules ?? [];
  return config.schedules ?? [];
}

/**
 * Expand a tariff slot into concrete `[startMinute, endMinute)` ranges within a
 * day, applying the two schedule conventions:
 *
 *  - an end of `"00:00"` means midnight *at the end* of the day (24:00), not
 *    the start of it;
 *  - a slot whose end is not after its start wraps past midnight and therefore
 *    yields two ranges.
 *
 * Exported so that everything reasoning about the schedule — energy
 * classification, and the recipe-facing snapshot — shares one interpretation
 * rather than each re-deriving it. Spec 138.
 */
export function slotRanges(slot: TariffSlot): Array<[number, number]> {
  const start = parseTimeToMinutes(slot.start);
  let end = parseTimeToMinutes(slot.end);
  if (end === 0) end = 1440;
  return end <= start
    ? [
        [start, 1440],
        [0, end],
      ]
    : [[start, end]];
}

/** Whether a minute-of-day falls inside a slot (start inclusive, end exclusive). */
export function isWithinSlot(minuteOfDay: number, slot: TariffSlot): boolean {
  return slotRanges(slot).some(([from, to]) => minuteOfDay >= from && minuteOfDay < to);
}

export class TariffClassifier {
  private logger: Logger;
  private settingsManager: SettingsManager;
  private cachedConfig: TariffConfig | null = null;
  private cacheKey: string | null = null;

  constructor(settingsManager: SettingsManager, logger: Logger) {
    this.settingsManager = settingsManager;
    this.logger = logger.child({ module: "tariff-classifier" });
  }

  /**
   * Classify an energy window into HP/HC split.
   * Uses the tariff schedule in effect for the window's day-of-week, in the
   * season of the window's start day (spec 204).
   * Applies linear prorata if the window straddles a tariff transition.
   *
   * @param totalWh Total energy in Wh for the window
   * @param windowStartEpoch Window start as Unix epoch seconds
   * @param windowSeconds Window duration in seconds (default 30 min — the
   *   historical aggregation window). Callers folding per-minute buckets
   *   pass 60 so a tariff transition only prorates the minute it lands in.
   * @returns HP/HC split in Wh
   */
  classify(totalWh: number, windowStartEpoch: number, windowSeconds = HALF_HOUR_S): TariffSplit {
    const config = this.getConfig();
    if (!config) {
      // No tariff configured → everything is HP
      return { hp: totalWh, hc: 0 };
    }

    const windowStart = new Date(windowStartEpoch * 1000);
    const dayOfWeek = windowStart.getDay(); // 0=Sunday..6=Saturday

    // Find the schedule for this day, in the season of the window's start day
    const daySchedule = schedulesOn(config, windowStart).find((s) => s.days.includes(dayOfWeek));
    if (!daySchedule || daySchedule.slots.length === 0) {
      // No schedule for this day → everything is HP
      return { hp: totalWh, hc: 0 };
    }

    const windowStartMinutes = windowStart.getHours() * 60 + windowStart.getMinutes();
    const windowEndMinutes = windowStartMinutes + windowSeconds / 60;

    let hpMinutes = 0;
    let hcMinutes = 0;

    for (const slot of daySchedule.slots) {
      for (const [rangeStart, rangeEnd] of slotRanges(slot)) {
        const overlapStart = Math.max(windowStartMinutes, rangeStart);
        const overlapEnd = Math.min(windowEndMinutes, rangeEnd);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > 0) {
          if (slot.tariff === "hp") {
            hpMinutes += overlap;
          } else {
            hcMinutes += overlap;
          }
        }
      }
    }

    const totalMinutes = hpMinutes + hcMinutes;
    if (totalMinutes === 0) {
      // No slot covers this window → default to HP
      return { hp: totalWh, hc: 0 };
    }

    return {
      hp: Math.round((totalWh * hpMinutes) / totalMinutes),
      hc: Math.round((totalWh * hcMinutes) / totalMinutes),
    };
  }

  /** Get the current tariff config from settings (cached). */
  getConfig(): TariffConfig | null {
    const raw = this.settingsManager.get(SETTINGS_KEY);
    if (!raw) {
      this.cachedConfig = null;
      this.cacheKey = null;
      return null;
    }

    // Use raw string as cache key to avoid re-parsing on every call
    if (raw === this.cacheKey) {
      return this.cachedConfig;
    }

    try {
      const parsed = JSON.parse(raw) as TariffConfig;
      this.cachedConfig = parsed;
      this.cacheKey = raw;
      return parsed;
    } catch (err) {
      this.logger.warn({ err }, "Invalid tariff config in settings");
      this.cachedConfig = null;
      this.cacheKey = null;
      return null;
    }
  }

  /** Get the window duration in seconds (for testing/external use). */
  static get WINDOW_DURATION_S(): number {
    return HALF_HOUR_S;
  }
}

/** Parse "HH:MM" to minutes since midnight. */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

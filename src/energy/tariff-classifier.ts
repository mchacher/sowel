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
import type { TariffConfig, TariffSplit } from "../shared/types.js";

const SETTINGS_KEY = "energy.tariff";
const HALF_HOUR_S = 1800;

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
   * Classify a 30-min energy window into HP/HC split.
   * Uses the tariff schedule in effect for the window's day-of-week.
   * Applies linear prorata if the window straddles a tariff transition.
   *
   * @param totalWh Total energy in Wh for the 30-min window
   * @param windowStartEpoch Window start as Unix epoch seconds
   * @returns HP/HC split in Wh
   */
  classify(totalWh: number, windowStartEpoch: number): TariffSplit {
    const config = this.getConfig();
    if (!config) {
      // No tariff configured → everything is HP
      return { hp: totalWh, hc: 0 };
    }

    const windowStart = new Date(windowStartEpoch * 1000);
    const dayOfWeek = windowStart.getDay(); // 0=Sunday..6=Saturday

    // Find the schedule for this day
    const daySchedule = config.schedules.find((s) => s.days.includes(dayOfWeek));
    if (!daySchedule || daySchedule.slots.length === 0) {
      // No schedule for this day → everything is HP
      return { hp: totalWh, hc: 0 };
    }

    const windowStartMinutes = windowStart.getHours() * 60 + windowStart.getMinutes();
    const windowEndMinutes = windowStartMinutes + 30;

    let hpMinutes = 0;
    let hcMinutes = 0;

    for (const slot of daySchedule.slots) {
      const slotStart = parseTimeToMinutes(slot.start);
      let slotEnd = parseTimeToMinutes(slot.end);

      // Handle midnight wrap: "00:00" means 24:00 (end of day)
      if (slotEnd === 0) slotEnd = 1440;

      // Build slot ranges — if end < start, the slot wraps around midnight
      // e.g. 17:04 → 00:04 becomes [17:04, 24:00) + [00:00, 00:04)
      const ranges: Array<[number, number]> =
        slotEnd <= slotStart
          ? [
              [slotStart, 1440],
              [0, slotEnd],
            ]
          : [[slotStart, slotEnd]];

      for (const [rangeStart, rangeEnd] of ranges) {
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

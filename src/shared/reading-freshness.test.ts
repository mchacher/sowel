import { describe, it, expect } from "vitest";
import {
  freshnessBudgetFor,
  isReadingCurrent,
  parseReadingTime,
  SUBMETER_FRESHNESS_MS,
  SUBMETER_FRESHNESS_SLOW_MS,
} from "./reading-freshness.js";

const NOW = Date.parse("2026-08-30T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("freshnessBudgetFor", () => {
  it("gives a declared meter the engine's own electrical window", () => {
    expect(freshnessBudgetFor("energy_meter")).toBe(SUBMETER_FRESHNESS_MS);
    expect(freshnessBudgetFor("main_energy_meter")).toBe(SUBMETER_FRESHNESS_MS);
    expect(SUBMETER_FRESHNESS_MS).toBe(2 * 60 * 1000);
  });

  it("gives everything else the looser one", () => {
    // A water_heater or thermostat carrying a power channel is not a meter,
    // and its source may legitimately be a 300 s poller.
    for (const t of ["water_heater", "thermostat", "appliance", "switch", "media_player"]) {
      expect(freshnessBudgetFor(t)).toBe(SUBMETER_FRESHNESS_SLOW_MS);
    }
  });

  it("keeps the loose budget above twice the slowest supported cadence", () => {
    // SmartThings, Legrand, Panasonic Comfort Cloud and MCZ Maestro all
    // default to polling every 300 s. A budget below 600 s makes a healthy
    // appliance flicker on every cycle.
    expect(SUBMETER_FRESHNESS_SLOW_MS).toBeGreaterThanOrEqual(2 * 300 * 1000);
  });
});

describe("parseReadingTime", () => {
  it("accepts both timestamp spellings the API emits", () => {
    expect(parseReadingTime("2026-05-27 08:00:00Z")).toBe(parseReadingTime("2026-05-27T08:00:00Z"));
  });

  it("returns null when there is nothing to parse", () => {
    expect(parseReadingTime(null)).toBeNull();
    expect(parseReadingTime(undefined)).toBeNull();
    expect(parseReadingTime("")).toBeNull();
    expect(parseReadingTime("not-a-date")).toBeNull();
  });
});

describe("isReadingCurrent", () => {
  it("accepts a reading inside the budget and refuses one past it", () => {
    expect(isReadingCurrent(ago(60_000), "energy_meter", NOW)).toBe(true);
    expect(isReadingCurrent(ago(SUBMETER_FRESHNESS_MS), "energy_meter", NOW)).toBe(true);
    expect(isReadingCurrent(ago(SUBMETER_FRESHNESS_MS + 1), "energy_meter", NOW)).toBe(false);
  });

  it("does not flag a 300 s poller on a non-meter type", () => {
    // The two rows in the #744 snapshot: Lave-linge and TV, both at 270 s,
    // both fed by one SmartThings poll, both fine.
    expect(isReadingCurrent(ago(270_000), "appliance", NOW)).toBe(true);
    expect(isReadingCurrent(ago(270_000), "media_player", NOW)).toBe(true);
  });

  it("still catches the two readings #744 was about", () => {
    // A water heater 13.5 minutes behind while drawing 560 W, and a wood stove
    // 124 days behind, both reporting stale: false to the engine.
    expect(isReadingCurrent(ago(944_000), "water_heater", NOW)).toBe(false);
    expect(isReadingCurrent(ago(124 * 24 * 3600 * 1000), "thermostat", NOW)).toBe(false);
  });

  it("treats an absent or unparseable timestamp as no evidence of age", () => {
    // Same reading as the backend: a binding that has never reported is not
    // stale. Guessing "old" here would blank a value on first boot.
    expect(isReadingCurrent(null, "energy_meter", NOW)).toBe(true);
    expect(isReadingCurrent("nonsense", "energy_meter", NOW)).toBe(true);
  });
});

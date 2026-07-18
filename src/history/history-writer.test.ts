import { describe, it, expect } from "vitest";
import { HistoryWriter } from "./history-writer.js";
import type { DataCategory } from "../shared/types.js";

describe("HistoryWriter.resolveHistorize", () => {
  // ============================================================
  // Explicit override
  // ============================================================

  it("returns true when historize=1 regardless of category", () => {
    expect(HistoryWriter.resolveHistorize(1, "anything", "generic")).toBe(true);
  });

  it("returns false when historize=0 regardless of category", () => {
    expect(HistoryWriter.resolveHistorize(0, "temperature", "temperature")).toBe(false);
  });

  // ============================================================
  // Category defaults — indoor + outdoor temperature/humidity
  // ============================================================

  it("historizes indoor temperature and humidity by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "temperature", "temperature")).toBe(true);
    expect(HistoryWriter.resolveHistorize(null, "humidity", "humidity")).toBe(true);
  });

  it("historizes outdoor temperature and humidity by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "temperature_2", "temperature_outdoor")).toBe(true);
    expect(HistoryWriter.resolveHistorize(null, "humidity_2", "humidity_outdoor")).toBe(true);
  });

  it("historizes the rest of the on-by-default categories", () => {
    const onByDefault: DataCategory[] = [
      "pressure",
      "luminosity",
      "rain",
      "wind",
      "co2",
      "voc",
      "noise",
      "shutter_position",
      "battery",
    ];
    for (const cat of onByDefault) {
      expect(HistoryWriter.resolveHistorize(null, cat, cat)).toBe(true);
    }
  });

  // ============================================================
  // Alias exclusions
  // ============================================================

  it("never historizes weather-forecast bindings (jN_* aliases)", () => {
    // Even though temperature_outdoor is on by default, the jN_ alias prefix
    // excludes forecast bindings from history (they update at hourly cadence
    // and the values are predictions, not measurements).
    expect(HistoryWriter.resolveHistorize(null, "j1_temp_max", "temperature_outdoor")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "j5_condition", "weather_condition")).toBe(false);
  });

  it("excludes raw cumulative energy counters (energy_forward / energy_reverse)", () => {
    expect(HistoryWriter.resolveHistorize(null, "energy_forward", "energy")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "energy_reverse", "energy")).toBe(false);
  });

  it("excludes rolling rain cumulatives (sum_rain_1 / sum_rain_24) but keeps incremental rain", () => {
    // Netatmo's rolling 1h/24h totals — historizing them makes the rain chart
    // plot a flat cumulative and sum-of-cumuls the WeatherAggregator.
    expect(HistoryWriter.resolveHistorize(null, "sum_rain_1", "rain")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "sum_rain_24", "rain")).toBe(false);
    // The incremental per-period rain stays historized.
    expect(HistoryWriter.resolveHistorize(null, "rain", "rain")).toBe(true);
  });

  // ============================================================
  // Default OFF for unrelated categories
  // ============================================================

  it("does not historize generic or unknown categories by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "state", "generic")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "action", "action")).toBe(false);
  });
});

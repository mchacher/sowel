import { describe, expect, it } from "vitest";
import { buildFluxQuery } from "./history-query";

const baseParams = {
  bucket: "sowel",
  equipmentId: "eq-1",
  alias: "sum_rain_24",
  from: new Date("2026-05-01T00:00:00Z"),
  to: new Date("2026-06-01T00:00:00Z"),
};

describe("buildFluxQuery", () => {
  describe("raw bucket", () => {
    it("filters on value_number for raw resolution", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        resolution: "raw",
      });
      expect(flux).toContain('_field == "value_number"');
      expect(flux).not.toContain("aggregateWindow");
    });

    it("aggregates with sum on raw bucket fallback for cumulative categories", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel",
        resolution: "1d",
        category: "rain",
        isDownsampled: false,
      });
      expect(flux).toContain('_field == "value_number"');
      expect(flux).toContain("aggregateWindow(every: 1d, fn: sum");
    });

    it("aggregates with mean on raw bucket for continuous categories", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel",
        alias: "temperature",
        resolution: "1d",
        category: "temperature",
        isDownsampled: false,
      });
      expect(flux).toContain('_field == "value_number"');
      expect(flux).toContain("aggregateWindow(every: 1d, fn: mean");
    });
  });

  describe("downsampled bucket (F8)", () => {
    // Rain (cumulative, non-energy) reads the hourly-mean bucket and re-sums it
    // into the target window — the daily bucket only stores the mean, which
    // collapsed a day's rain total to ~total/24 (0mm on the 30d view).
    it("re-sums the hourly mean into daily totals for cumulative categories", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).toContain("aggregateWindow(every: 1d, fn: sum");
      expect(flux).toContain('timeSrc: "_start"');
      expect(flux).not.toContain("value_number");
    });

    it("re-sums the hourly mean per hour for cumulative categories (hourly)", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1h",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).toContain("aggregateWindow(every: 1h, fn: sum");
    });

    it("reads the mean field directly for continuous categories (no re-aggregation)", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-daily",
        alias: "temperature",
        resolution: "1d",
        category: "temperature",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).not.toContain("aggregateWindow");
    });

    it("does not re-sum energy (it uses its own pre-summed buckets)", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-energy-daily",
        alias: "energy_total",
        resolution: "1d",
        category: "energy",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).not.toContain("fn: sum");
    });

    it("includes the equipmentId and alias filters", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain('r.equipmentId == "eq-1"');
      expect(flux).toContain('r.alias == "sum_rain_24"');
    });

    it("respects the from/to time window", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain("2026-05-01T00:00:00.000Z");
      expect(flux).toContain("2026-06-01T00:00:00.000Z");
    });
  });
});

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
    it("reads the mean field directly from sowel-daily for cumulative categories", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-daily",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).not.toContain("value_number");
      expect(flux).not.toContain("aggregateWindow");
    });

    it("reads the mean field directly from sowel-hourly for cumulative categories", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1h",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain('_field == "mean"');
      expect(flux).not.toContain("value_number");
      expect(flux).not.toContain("aggregateWindow");
    });

    it("includes the equipmentId and alias filters", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-daily",
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
        bucket: "sowel-daily",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      expect(flux).toContain("2026-05-01T00:00:00.000Z");
      expect(flux).toContain("2026-06-01T00:00:00.000Z");
    });
  });
});

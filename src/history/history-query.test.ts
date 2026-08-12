import { describe, it, expect } from "vitest";
import {
  buildFluxQuery,
  queryHistory,
  querySparkline,
  queryZoneSparkline,
  queryHistorizedAliases,
} from "./history-query.js";
import { createLogger } from "../core/logger.js";
import type { InfluxClient } from "../core/influx-client.js";

const logger = createLogger("silent").logger;

/**
 * Build a fake InfluxClient. `rows` is the list of row objects each query
 * iteration should yield; `capture` (optional) records every Flux string run.
 * Pass `configured: false` to simulate an unconfigured client.
 */
function makeInflux(options: {
  rows?: Record<string, unknown>[];
  capture?: string[];
  configured?: boolean;
  throwOnQuery?: boolean;
}): InfluxClient {
  const { rows = [], capture, configured = true, throwOnQuery = false } = options;

  const queryApi = {
    iterateRows(flux: string) {
      capture?.push(flux);
      if (throwOnQuery) throw new Error("influx boom");
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of rows) {
            yield { values: row, tableMeta: { toObject: (v: unknown) => v } };
          }
        },
      };
    },
  };

  return {
    getConfig: () => (configured ? { org: "sowel-org", bucket: "sowel" } : null),
    getClient: () => (configured ? { getQueryApi: () => queryApi } : null),
  } as unknown as InfluxClient;
}

const BASE = {
  bucket: "sowel",
  equipmentId: "eq-1",
  alias: "temperature",
  from: new Date("2026-08-01T00:00:00Z"),
  to: new Date("2026-08-02T00:00:00Z"),
};

describe("buildFluxQuery", () => {
  it("raw continuous data: value_number filter, no aggregateWindow, limit 2500", () => {
    const q = buildFluxQuery({ ...BASE, resolution: "raw" });
    expect(q).toContain('from(bucket: "sowel")');
    expect(q).toContain('r._field == "value_number"');
    expect(q).not.toContain("aggregateWindow");
    expect(q).toContain("limit(n: 2500)");
  });

  it("raw discrete data uses the 2000 limit", () => {
    const q = buildFluxQuery({ ...BASE, resolution: "raw", isDiscrete: true });
    expect(q).toContain("limit(n: 2000)");
  });

  it("raw-bucket aggregated fallback uses mean for continuous categories", () => {
    const q = buildFluxQuery({ ...BASE, resolution: "1h", category: "temperature" });
    expect(q).toContain("aggregateWindow(every: 1h, fn: mean");
    expect(q).toContain("limit(n: 500)");
  });

  it("raw-bucket aggregated fallback uses sum for cumulative categories", () => {
    const q = buildFluxQuery({ ...BASE, resolution: "1d", category: "rain" });
    expect(q).toContain("aggregateWindow(every: 1d, fn: sum");
  });

  it("downsampled cumulative (rain) re-sums the hourly mean field into the window", () => {
    const q = buildFluxQuery({
      ...BASE,
      bucket: "sowel-hourly",
      resolution: "1h",
      category: "rain",
      isDownsampled: true,
    });
    expect(q).toContain('from(bucket: "sowel-hourly")');
    expect(q).toContain('r._field == "mean"');
    expect(q).toContain(
      'aggregateWindow(every: 1h, fn: sum, createEmpty: false, timeSrc: "_start")',
    );
  });

  it("downsampled energy reads the mean field directly with no aggregateWindow", () => {
    const q = buildFluxQuery({
      ...BASE,
      bucket: "sowel-energy-hourly",
      resolution: "1h",
      category: "energy",
      isDownsampled: true,
    });
    expect(q).toContain('from(bucket: "sowel-energy-hourly")');
    expect(q).toContain('r._field == "mean"');
    expect(q).not.toContain("aggregateWindow");
    expect(q).toContain("limit(n: 500)");
  });

  it("downsampled continuous data reads the mean field directly", () => {
    const q = buildFluxQuery({
      ...BASE,
      bucket: "sowel-hourly",
      resolution: "1h",
      category: "temperature",
      isDownsampled: true,
    });
    expect(q).toContain('r._field == "mean"');
    expect(q).not.toContain("aggregateWindow");
  });
});

describe("queryHistory", () => {
  it("returns an empty raw result when Influx is not configured", async () => {
    const res = await queryHistory(
      makeInflux({ configured: false }),
      { equipmentId: "eq-1", alias: "temperature", from: "-24h" },
      logger,
    );
    expect(res).toEqual({ points: [], resolution: "raw" });
  });

  it("maps raw points and drops rows with a missing or non-numeric value", async () => {
    const influx = makeInflux({
      rows: [
        { _time: "2026-08-01T00:00:00Z", _value: 21.5 },
        { _time: "2026-08-01T00:05:00Z", _value: "NaN-string" }, // dropped
        { _value: 22 }, // missing time, dropped
        { _time: "2026-08-01T00:10:00Z", _value: 22.1 },
      ],
      capture: [],
    });

    const res = await queryHistory(
      influx,
      { equipmentId: "eq-1", alias: "temperature", from: "-1h", dataType: "number" },
      logger,
    );

    expect(res.resolution).toBe("raw");
    expect(res.points).toEqual([
      { time: "2026-08-01T00:00:00Z", value: 21.5 },
      { time: "2026-08-01T00:10:00Z", value: 22.1 },
    ]);
  });

  it("forces raw resolution for discrete (boolean/enum) data types", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ rows: [], capture });
    const res = await queryHistory(
      influx,
      { equipmentId: "eq-1", alias: "state", from: "-30d", dataType: "boolean" },
      logger,
    );
    expect(res.resolution).toBe("raw");
    expect(capture[0]).toContain("value_number");
    expect(capture[0]).toContain("limit(n: 2000)"); // discrete raw limit
  });

  it("aggregated path pivots mean/min/max into points", async () => {
    const influx = makeInflux({
      rows: [{ _time: "2026-08-01T00:00:00Z", mean: 20, min: 18, max: 23 }],
    });
    const res = await queryHistory(
      influx,
      { equipmentId: "eq-1", alias: "temperature", from: "-7d", aggregation: "1h" },
      logger,
    );
    expect(res.resolution).toBe("1h");
    expect(res.points[0]).toEqual({ time: "2026-08-01T00:00:00Z", value: 20, min: 18, max: 23 });
  });

  it("energy category routes to the dedicated energy bucket", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ rows: [{ _time: "t", _value: 5 }], capture });
    await queryHistory(
      influx,
      {
        equipmentId: "eq-1",
        alias: "consumption",
        from: "-7d",
        aggregation: "1h",
        category: "energy",
      },
      logger,
    );
    expect(capture[0]).toContain('from(bucket: "sowel-energy-hourly")');
  });

  it("cumulative category falls back to the raw bucket when the downsampled one is empty", async () => {
    const capture: string[] = [];
    // Downsampled bucket yields nothing on the first query, then the raw
    // fallback query yields a point. Both share the same fake row set, so we
    // instead assert two queries ran (downsampled + raw fallback).
    const influx = makeInflux({ rows: [], capture });
    const res = await queryHistory(
      influx,
      {
        equipmentId: "eq-1",
        alias: "consumption",
        from: "-7d",
        aggregation: "1h",
        category: "energy",
      },
      logger,
    );
    expect(res.points).toEqual([]);
    expect(capture.length).toBe(2); // downsampled bucket, then raw fallback
    expect(capture[0]).toContain('from(bucket: "sowel-energy-hourly")');
    expect(capture[1]).toContain('from(bucket: "sowel")');
  });

  it("aggregated path falls back to the raw bucket when the downsampled one is empty", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ rows: [], capture });
    await queryHistory(
      influx,
      { equipmentId: "eq-1", alias: "temperature", from: "-7d", aggregation: "1h" },
      logger,
    );
    expect(capture.length).toBe(2); // downsampled (sowel-hourly), then raw fallback
    expect(capture[1]).toContain('from(bucket: "sowel")');
  });

  it("swallows a query error and returns empty points", async () => {
    const influx = makeInflux({ throwOnQuery: true });
    const res = await queryHistory(
      influx,
      { equipmentId: "eq-1", alias: "temperature", from: "-1h" },
      logger,
    );
    expect(res.points).toEqual([]);
  });
});

describe("querySparkline", () => {
  it("returns [] when Influx is not configured", async () => {
    const res = await querySparkline(
      makeInflux({ configured: false }),
      { equipmentId: "eq-1", alias: "temperature" },
      logger,
    );
    expect(res).toEqual([]);
  });

  it("collects numeric values over a 24h / 30m window", async () => {
    const capture: string[] = [];
    const influx = makeInflux({
      rows: [{ _value: 1 }, { _value: 2 }, { _value: "skip" }, { _value: 3 }],
      capture,
    });
    const res = await querySparkline(influx, { equipmentId: "eq-1", alias: "temperature" }, logger);
    expect(res).toEqual([1, 2, 3]);
    expect(capture[0]).toContain("range(start: -24h)");
    expect(capture[0]).toContain("aggregateWindow(every: 30m");
  });

  it("returns [] on error", async () => {
    const influx = makeInflux({ throwOnQuery: true });
    expect(
      await querySparkline(influx, { equipmentId: "eq-1", alias: "temperature" }, logger),
    ).toEqual([]);
  });
});

describe("queryZoneSparkline", () => {
  it("aggregates a zone/category over 24h", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ rows: [{ _value: 4 }, { _value: 6 }], capture });
    const res = await queryZoneSparkline(
      influx,
      { zoneId: "zone-1", category: "temperature" },
      logger,
    );
    expect(res).toEqual([4, 6]);
    expect(capture[0]).toContain('r.zoneId == "zone-1"');
    expect(capture[0]).toContain('r.category == "temperature"');
  });
});

describe("queryHistorizedAliases", () => {
  it("returns distinct alias strings", async () => {
    const influx = makeInflux({ rows: [{ _value: "temperature" }, { _value: "humidity" }] });
    const res = await queryHistorizedAliases(influx, "eq-1", logger);
    expect(res).toEqual(["temperature", "humidity"]);
  });

  it("returns [] on error", async () => {
    const influx = makeInflux({ throwOnQuery: true });
    expect(await queryHistorizedAliases(influx, "eq-1", logger)).toEqual([]);
  });
});

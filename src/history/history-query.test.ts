import { describe, expect, it } from "vitest";
import {
  buildFluxQuery,
  buildLastBeforeQuery,
  applyDiscreteBoundaries,
  queryHistory,
  querySparkline,
  queryZoneSparkline,
  queryHistorizedAliases,
  rainDailyMode,
} from "./history-query.js";
import type { HistoryPoint } from "../shared/types.js";
import { createLogger } from "../core/logger.js";
import type { InfluxClient } from "../core/influx-client.js";

const logger = createLogger("silent").logger;

const baseParams = {
  bucket: "sowel",
  equipmentId: "eq-1",
  alias: "sum_rain_24",
  from: new Date("2026-05-01T00:00:00Z"),
  to: new Date("2026-06-01T00:00:00Z"),
};

/**
 * Build a fake InfluxClient. `rows` is the list of row objects each query
 * iteration should yield; `capture` (optional) records every Flux string run.
 * Pass `configured: false` to simulate an unconfigured client.
 */
function makeInflux(options: {
  rows?: Record<string, unknown>[];
  /** Rows returned specifically for the discrete carry-in `last()` query, so a
   *  test can prove the anchor value comes from *before* the window rather than
   *  leaking the in-window rows. Falls back to `rows` when omitted. */
  lastRows?: Record<string, unknown>[];
  capture?: string[];
  configured?: boolean;
  throwOnQuery?: boolean;
  /** Throw only for the queries this predicate matches (e.g. a missing bucket). */
  throwWhen?: (flux: string) => boolean;
}): InfluxClient {
  const {
    rows = [],
    lastRows,
    capture,
    configured = true,
    throwOnQuery = false,
    throwWhen,
  } = options;

  const queryApi = {
    iterateRows(flux: string) {
      capture?.push(flux);
      if (throwOnQuery || throwWhen?.(flux)) throw new Error("influx boom");
      const out = lastRows && flux.includes("|> last()") ? lastRows : rows;
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of out) {
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

    it("stamps raw rain windows at their start and cuts days at local midnight", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel",
        resolution: "1d",
        category: "rain",
        isDownsampled: false,
        timezone: "Europe/Paris",
      });
      expect(flux.startsWith('import "timezone"')).toBe(true);
      expect(flux).toContain('timeSrc: "_start"');
      expect(flux).toContain('location: timezone.location(name: "Europe/Paris")');
      // raw points already carry the time the rain fell: no shift
      expect(flux).not.toContain("timeShift");
    });

    it("leaves the raw fallback of continuous categories alone", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel",
        alias: "temperature",
        resolution: "1d",
        category: "temperature",
        isDownsampled: false,
        timezone: "Europe/Paris",
      });
      expect(flux).not.toContain("timezone");
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

    // The hourly task stamps each hour at its end: 13:00-14:00 rain sits at 14:00.
    it("shifts rain hours back to their start before re-summing", () => {
      const flux = buildFluxQuery({
        ...baseParams,
        bucket: "sowel-hourly",
        resolution: "1d",
        category: "rain",
        isDownsampled: true,
      });
      const shift = flux.indexOf("timeShift(duration: -1h)");
      expect(shift).toBeGreaterThan(flux.indexOf('_field == "mean"'));
      expect(shift).toBeLessThan(flux.indexOf("aggregateWindow"));
    });

    it("cuts rain days at local midnight, in the server zone by default", () => {
      const prev = process.env.TZ;
      process.env.TZ = "America/New_York";
      try {
        const flux = buildFluxQuery({
          ...baseParams,
          bucket: "sowel-hourly",
          resolution: "1d",
          category: "rain",
          isDownsampled: true,
        });
        expect(flux.startsWith('import "timezone"')).toBe(true);
        expect(flux).toContain('location: timezone.location(name: "America/New_York")');
      } finally {
        if (prev === undefined) delete process.env.TZ;
        else process.env.TZ = prev;
      }
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

  describe("raw result limits", () => {
    it("caps continuous raw data at 2500 points", () => {
      const flux = buildFluxQuery({ ...baseParams, resolution: "raw" });
      expect(flux).toContain("limit(n: 2500)");
    });

    it("caps discrete (state) raw data at 2000 points", () => {
      const flux = buildFluxQuery({ ...baseParams, resolution: "raw", isDiscrete: true });
      expect(flux).toContain("limit(n: 2000)");
    });
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
    // fallback query runs. Both share the same fake row set, so we assert two
    // queries ran (downsampled + raw fallback).
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

// ============================================================
// #498 — discrete (state) series span the whole window
// ============================================================

const p = (time: string, value: number): HistoryPoint => ({ time, value });

describe("buildLastBeforeQuery (#498 carry-in)", () => {
  it("looks for the last value strictly before the window start", () => {
    const flux = buildLastBeforeQuery({
      bucket: "sowel",
      equipmentId: "eq-1",
      alias: "state",
      from: new Date("2026-05-01T00:00:00Z"),
      lookbackMs: 30 * 86_400_000,
    });
    expect(flux).toContain(
      "range(start: 2026-04-01T00:00:00.000Z, stop: 2026-05-01T00:00:00.000Z)",
    );
    expect(flux).toContain('r.equipmentId == "eq-1"');
    expect(flux).toContain('r.alias == "state"');
    expect(flux).toContain('r._field == "value_number"');
    expect(flux).toContain("|> last()");
  });
});

describe("applyDiscreteBoundaries (#498)", () => {
  const from = "2026-05-01T00:00:00.000Z";
  const to = "2026-05-01T23:59:59.000Z";

  it("anchors the line at the window start with the prior state", () => {
    const out = applyDiscreteBoundaries([p("2026-05-01T12:00:00Z", 1)], from, to, 0);
    expect(out[0]).toEqual(p(from, 0)); // carry-in: was Off before the window
    expect(out[out.length - 1]).toEqual(p(to, 1)); // extend the last state On to the end
  });

  it("does not prepend when a sample already sits at the window start", () => {
    const out = applyDiscreteBoundaries([p(from, 1), p("2026-05-01T10:00:00Z", 0)], from, to, 1);
    expect(out.filter((x) => x.time === from)).toHaveLength(1);
    expect(out[0]).toEqual(p(from, 1));
  });

  it("draws a flat line across the window when the state never changed inside it", () => {
    const out = applyDiscreteBoundaries([], from, to, 0);
    expect(out).toEqual([p(from, 0), p(to, 0)]);
  });

  it("returns nothing when there is no in-window data and no prior state", () => {
    expect(applyDiscreteBoundaries([], from, to, null)).toEqual([]);
  });

  it("does not extend when the last sample is already at the window end", () => {
    const out = applyDiscreteBoundaries([p("2026-05-01T08:00:00Z", 1), p(to, 0)], from, to, 1);
    expect(out.filter((x) => x.time === to)).toHaveLength(1);
  });
});

describe("queryHistory — discrete boundaries (#498)", () => {
  it("anchors a discrete series with the state from before the window, then extends it", async () => {
    const capture: string[] = [];
    // In-window: a single On (1) at noon. Before the window: Off (0). The
    // carry-in must anchor at Off, proving the value comes from the
    // strictly-before `last()` query, not the in-window sample.
    const influx = makeInflux({
      rows: [{ _time: "2026-05-01T12:00:00Z", _value: 1 }],
      lastRows: [{ _time: "2026-04-30T20:00:00Z", _value: 0 }],
      capture,
    });
    const result = await queryHistory(
      influx,
      {
        equipmentId: "eq-1",
        alias: "state",
        from: "2026-05-01T00:00:00Z",
        to: "2026-05-01T23:59:59Z",
        aggregation: "raw",
        dataType: "boolean",
      },
      logger,
    );
    expect(capture.some((q) => q.includes("|> last()"))).toBe(true);
    expect(result.points).toEqual([
      { time: "2026-05-01T00:00:00.000Z", value: 0 }, // carry-in: Off, from before the window
      { time: "2026-05-01T12:00:00Z", value: 1 }, // in-window change to On
      { time: "2026-05-01T23:59:59.000Z", value: 1 }, // extend the last state to the window end
    ]);
  });

  it("does not issue a carry-in query for a continuous series", async () => {
    const capture: string[] = [];
    const influx = makeInflux({ rows: [{ _time: "2026-05-01T02:00:00Z", _value: 20 }], capture });
    await queryHistory(
      influx,
      {
        equipmentId: "eq-1",
        alias: "temp",
        from: "2026-05-01T00:00:00Z",
        to: "2026-05-01T06:00:00Z",
        aggregation: "raw",
        dataType: "number",
      },
      logger,
    );
    expect(capture.some((q) => q.includes("|> last()"))).toBe(false);
  });
});

// Spec 186 — rain kept a year as daily totals. The hourly bucket rain is summed
// from keeps 90 days; past that, the old days come from the rain-daily bucket.
describe("rain-daily bucket (spec 186)", () => {
  const rainParams = {
    ...baseParams,
    alias: "rain",
    bucket: "sowel-hourly",
    category: "rain",
    isDownsampled: true,
    timezone: "Europe/Paris",
  } as const;

  it("unions the rain-daily totals with the recent hourly sums", () => {
    const flux = buildFluxQuery({
      ...rainParams,
      resolution: "1d",
      rainDailyBucket: "sowel-rain-daily",
    });
    expect(flux).toContain('from(bucket: "sowel-rain-daily")');
    expect(flux).toContain('r._field == "sum"');
    expect(flux).toContain("date.sub(d: 80d, from: now())");
    expect(flux).toContain("location: loc)");
    // the hourly point stamped exactly at the cutoff is the previous day's last hour
    expect(flux).toContain("range(start: date.add(d: 1s, to: cutoff)");
    expect(flux).toContain("union(tables: [older, recent])");
    expect(flux.indexOf("timeShift(duration: -1h)")).toBeGreaterThan(flux.indexOf("recent ="));
  });

  it("ignores the rain-daily bucket for hourly resolution", () => {
    const flux = buildFluxQuery({
      ...rainParams,
      resolution: "1h",
      rainDailyBucket: "sowel-rain-daily",
    });
    expect(flux).not.toContain("rain-daily");
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it("reads a 6-month daily rain range through the rain-daily bucket", async () => {
    const capture: string[] = [];
    await queryHistory(
      makeInflux({ rows: [{ _time: "2026-05-01T22:00:00Z", _value: 4 }], capture }),
      {
        equipmentId: "eq-1",
        alias: "rain",
        from: daysAgo(183),
        aggregation: "1d",
        category: "rain",
      },
      logger,
    );
    expect(capture[0]).toContain('from(bucket: "sowel-rain-daily")');
  });

  it("keeps the hourly-only read for a range within the hourly retention", async () => {
    const capture: string[] = [];
    await queryHistory(
      makeInflux({ rows: [{ _time: "2026-05-01T22:00:00Z", _value: 4 }], capture }),
      {
        equipmentId: "eq-1",
        alias: "rain",
        from: daysAgo(30),
        aggregation: "1d",
        category: "rain",
      },
      logger,
    );
    expect(capture[0]).not.toContain("rain-daily");
  });

  it("never touches the rain-daily bucket for other categories", async () => {
    const capture: string[] = [];
    await queryHistory(
      makeInflux({ rows: [], capture }),
      {
        equipmentId: "eq-1",
        alias: "temperature",
        from: daysAgo(183),
        aggregation: "1d",
        category: "temperature",
      },
      logger,
    );
    expect(capture.join("\n")).not.toContain("rain-daily");
  });

  it("reads a window wholly older than the cutoff from the rain-daily bucket alone", async () => {
    const capture: string[] = [];
    await queryHistory(
      makeInflux({ rows: [{ _time: "2026-05-01T22:00:00Z", _value: 4 }], capture }),
      {
        equipmentId: "eq-1",
        alias: "rain",
        from: daysAgo(160),
        to: daysAgo(130),
        aggregation: "1d",
        category: "rain",
      },
      logger,
    );
    expect(capture[0]).toContain('from(bucket: "sowel-rain-daily")');
    expect(capture[0]).not.toContain("sowel-hourly");
    expect(capture[0]).toContain(`stop: ${new Date(Date.parse(daysAgo(130))).toISOString()}`);
  });

  it("still falls back to the raw bucket when the rain read returns nothing", async () => {
    const capture: string[] = [];
    await queryHistory(
      makeInflux({ rows: [], capture }),
      {
        equipmentId: "eq-1",
        alias: "rain",
        from: daysAgo(183),
        aggregation: "1d",
        category: "rain",
      },
      logger,
    );
    expect(capture).toHaveLength(2);
    expect(capture[1]).toContain('from(bucket: "sowel")');
  });

  it("falls back to the hourly read when the rain-daily bucket cannot be read", async () => {
    const capture: string[] = [];
    const res = await queryHistory(
      makeInflux({
        rows: [{ _time: "2026-09-01T22:00:00Z", _value: 2.1 }],
        capture,
        throwWhen: (flux) => flux.includes("rain-daily"),
      }),
      {
        equipmentId: "eq-1",
        alias: "rain",
        from: daysAgo(183),
        aggregation: "1d",
        category: "rain",
      },
      logger,
    );
    expect(capture).toHaveLength(2);
    expect(capture[1]).not.toContain("rain-daily");
    expect(res.points).toEqual([{ time: "2026-09-01T22:00:00Z", value: 2.1 }]);
  });
});

describe("rainDailyMode (spec 186)", () => {
  const now = Date.parse("2026-10-08T10:00:00Z");
  const ago = (d: number) => new Date(now - d * 86_400_000);

  it("keeps the hourly read while the window starts within 81 days", () => {
    expect(rainDailyMode(ago(80.5), ago(0), now)).toBe("hourly");
    expect(rainDailyMode(ago(30), ago(0), now)).toBe("hourly");
  });

  it("unions when the window spans the cutoff", () => {
    expect(rainDailyMode(ago(183), ago(0), now)).toBe("union");
    expect(rainDailyMode(ago(183), ago(79), now)).toBe("union");
  });

  it("reads rain-daily alone when the window ends before or around the cutoff", () => {
    expect(rainDailyMode(ago(160), ago(130), now)).toBe("daily");
    expect(rainDailyMode(ago(183), ago(80), now)).toBe("daily");
  });
});

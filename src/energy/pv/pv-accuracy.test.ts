import { describe, expect, it } from "vitest";
import type { InfluxClient } from "../../core/influx-client.js";
import { createLogger } from "../../core/logger.js";
import {
  FORECAST_MEASUREMENT,
  MAX_ACCURACY_DAYS,
  pairSeries,
  queryPvAccuracy,
} from "./pv-accuracy.js";

const h = (n: number): string => `2026-08-25T${String(n).padStart(2, "0")}:00:00Z`;

describe("pairSeries", () => {
  it("scores the hours both sides carry", () => {
    const forecast = new Map([
      [h(10), 1000],
      [h(11), 1200],
    ]);
    const actual = new Map([
      [h(10), 900],
      [h(11), 1400],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(2);
    expect(result.maeW).toBe(150); // (100 + 200) / 2
    expect(result.points).toHaveLength(2);
  });

  it("ignores an hour the meter never reported", () => {
    // An outage is not a forecast miss. Scoring it as one would make a dead
    // inverter look like a bad model.
    const forecast = new Map([
      [h(10), 1000],
      [h(11), 1200],
    ]);
    const actual = new Map([[h(10), 1000]]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(1);
    expect(result.maeW).toBe(0);
  });

  it("ignores an hour that was never forecast", () => {
    const result = pairSeries(
      new Map([[h(10), 500]]),
      new Map([
        [h(10), 500],
        [h(11), 900],
      ]),
    );
    expect(result.samples).toBe(1);
  });

  it("reports nothing rather than a perfect score when there is no overlap", () => {
    const result = pairSeries(new Map([[h(10), 1000]]), new Map([[h(15), 1000]]));
    expect(result.samples).toBe(0);
    expect(result.maeW).toBeNull();
    expect(result.points).toEqual([]);
  });

  it("reports nothing on empty inputs", () => {
    expect(pairSeries(new Map(), new Map()).maeW).toBeNull();
  });

  it("returns the points in chronological order whatever the map order", () => {
    const forecast = new Map([
      [h(14), 1],
      [h(9), 2],
      [h(11), 3],
    ]);
    const actual = new Map([
      [h(9), 2],
      [h(11), 3],
      [h(14), 1],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.points.map((p) => p.at)).toEqual([h(9), h(11), h(14)]);
  });

  it("skips a non-finite value rather than producing a NaN error", () => {
    const forecast = new Map([
      [h(10), Number.NaN],
      [h(11), 1000],
    ]);
    const actual = new Map([
      [h(10), 500],
      [h(11), 800],
    ]);
    const result = pairSeries(forecast, actual);
    expect(result.samples).toBe(1);
    expect(result.maeW).toBe(200);
  });

  it("treats over- and under-forecasting alike", () => {
    const over = pairSeries(new Map([[h(10), 1200]]), new Map([[h(10), 1000]]));
    const under = pairSeries(new Map([[h(10), 800]]), new Map([[h(10), 1000]]));
    expect(over.maeW).toBe(under.maeW);
  });
});

/**
 * Which bucket each side of the pairing actually reads.
 *
 * This has been wrong twice, in both directions, and never visibly: a forecast
 * read from a bucket nothing writes, and a measurement read from a bucket that
 * evicts it after seven days. Both produced an empty or truncated comparison
 * that looked exactly like "no data yet".
 *
 * Asserted by capturing the Flux the query emits, not by grepping the source
 * for substrings — the previous version of this test checked two unrelated
 * literals and would have stayed green through either regression.
 */
describe("the buckets the query reads", () => {
  function captureQueries(): { queries: string[]; influx: InfluxClient } {
    const queries: string[] = [];
    const influx = {
      getConfig: () => ({ bucket: "sowel", org: "sowel" }),
      getClient: () => ({
        getQueryApi: () => ({
          iterateRows: (flux: string) => {
            queries.push(flux);
            // Yielding nothing is enough: the assertions are on the queries.
            return (async function* () {})();
          },
        }),
      }),
    } as unknown as InfluxClient;
    return { queries, influx };
  }

  const silent = createLogger("silent").logger;

  it("reads the forecast from the two-year energy-hourly bucket", async () => {
    const { queries, influx } = captureQueries();
    await queryPvAccuracy(influx, { equipmentId: "eq-1", alias: "power" }, silent);

    expect(queries[0]).toContain('from(bucket: "sowel-energy-hourly")');
    expect(queries[0]).toContain(`r._measurement == "${FORECAST_MEASUREMENT}"`);
  });

  it("reads the measurement from the 90-day hourly bucket, not the 7-day raw one", async () => {
    const { queries, influx } = captureQueries();
    // The forecast side must return something for the actual side to run at all.
    const influxWithForecast = {
      ...influx,
      getClient: () => ({
        getQueryApi: () => ({
          iterateRows: async function* (flux: string) {
            queries.push(flux);
            if (flux.includes(FORECAST_MEASUREMENT)) {
              yield {
                values: [],
                tableMeta: { toObject: () => ({ _time: "2026-08-19T12:00:00Z", _value: 3000 }) },
              } as never;
            }
          },
        }),
      }),
    } as unknown as InfluxClient;

    await queryPvAccuracy(influxWithForecast, { equipmentId: "eq-1", alias: "power" }, silent);

    const actualQuery = queries.find((q) => q.includes("equipment_data"));
    expect(actualQuery).toBeDefined();
    // The raw bucket retains exactly the default window, so it must not be it.
    expect(actualQuery).toContain('from(bucket: "sowel-hourly")');
    expect(actualQuery).not.toContain('from(bucket: "sowel")');
    // And the downsampled series stores `mean`, never `value_number`.
    expect(actualQuery).toContain('r._field == "mean"');
    // And no time shift: both sides label an hour by its END (the downsample
    // task defaults `timeSrc` to `_stop`, and Open-Meteo's radiation variables
    // are preceding-hour means), so the join already lines up. Shifting one side
    // to "align" them took the fitted gain from 3.8 to 45.8 when it was tried.
    expect(actualQuery).not.toContain("timeShift");
  });

  it("caps the window at the retention of the shorter side", async () => {
    const { queries, influx } = captureQueries();
    await queryPvAccuracy(influx, { equipmentId: "eq-1", alias: "power", days: 365 }, silent);

    expect(queries[0]).toContain(`range(start: -${MAX_ACCURACY_DAYS}d`);
  });
});

/**
 * The measured series is not gated on the pairing.
 *
 * The chart draws production for the past whether or not a forecast was ever
 * issued for those hours. Tying the two together meant a household that had just
 * declared its installation saw its own production vanish from the chart while
 * it sat in the database.
 */
describe("the measured series", () => {
  const silent = createLogger("silent").logger;

  /** An influx stub with a forecast series and a measured series of given sizes. */
  function stub(forecastHours: number, measuredHours: number): InfluxClient {
    const row = (at: string, v: number) =>
      ({ values: [], tableMeta: { toObject: () => ({ _time: at, _value: v }) } }) as never;
    return {
      getConfig: () => ({ bucket: "sowel", org: "sowel" }),
      getClient: () => ({
        getQueryApi: () => ({
          iterateRows: (flux: string) =>
            (async function* () {
              const isForecast = flux.includes(FORECAST_MEASUREMENT);
              const n = isForecast ? forecastHours : measuredHours;
              for (let i = 0; i < n; i++) {
                yield row(
                  `2026-08-25T${String(i).padStart(2, "0")}:00:00Z`,
                  isForecast ? 900 : 800,
                );
              }
            })(),
        }),
      }),
    } as unknown as InfluxClient;
  }

  it("comes back even when nothing was ever forecast", async () => {
    const res = await queryPvAccuracy(stub(0, 5), { equipmentId: "eq", alias: "power" }, silent);
    expect(res.samples).toBe(0);
    expect(res.maeW).toBeNull();
    // The point of the fix: the line has data even though the figure does not.
    expect(res.measured).toHaveLength(5);
    expect(res.measured[0].watts).toBe(800);
  });

  it("carries every measured hour, not only the paired ones", async () => {
    const res = await queryPvAccuracy(stub(3, 8), { equipmentId: "eq", alias: "power" }, silent);
    expect(res.samples).toBe(3);
    expect(res.measured).toHaveLength(8);
  });

  it("comes back sorted oldest first", async () => {
    const res = await queryPvAccuracy(stub(0, 6), { equipmentId: "eq", alias: "power" }, silent);
    const ats = res.measured.map((p) => p.at);
    expect([...ats].sort()).toEqual(ats);
  });

  it("is empty, not absent, when the meter reported nothing", async () => {
    const res = await queryPvAccuracy(stub(4, 0), { equipmentId: "eq", alias: "power" }, silent);
    expect(res.measured).toEqual([]);
  });
});

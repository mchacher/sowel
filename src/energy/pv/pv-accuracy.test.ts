import { describe, expect, it } from "vitest";
import type { InfluxClient } from "../../core/influx-client.js";
import { createLogger } from "../../core/logger.js";
import {
  FORECAST_MEASUREMENT,
  MAX_ACCURACY_DAYS,
  aggregateDays,
  pairSeries,
  queryPvAccuracy,
  scoreDays,
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

// ============================================================
// Daily energy score (#907)
//
// The hourly power MAE is dominated by the night, where both sides are zero
// and the error is trivially perfect: 74 of 168 hours on the reference site,
// halving the figure and improving it every autumn as the nights lengthen.
// What a household asks of a production forecast is how far off the day was.
// ============================================================

/**
 * Hours of one local day, stamped by their END.
 *
 * Built from local-time components so the suite holds in any timezone: hour 24
 * is the next local midnight, which `aggregateDays` attributes to the day that
 * just ended.
 */
function localDay(
  y: number,
  m: number,
  d: number,
  watts: (hour: number) => { f: number; a: number },
  hours = 24,
): { at: string; forecastW: number; actualW: number }[] {
  const out = [];
  for (let hour = 1; hour <= hours; hour++) {
    const { f, a } = watts(hour);
    out.push({
      at: new Date(y, m - 1, d, hour).toISOString(),
      forecastW: f,
      actualW: a,
    });
  }
  return out;
}

/** A day that produces only between 10:00 and 16:00, flat. */
const shaped = (f: number, a: number) => (hour: number) =>
  hour >= 10 && hour <= 16 ? { f, a } : { f: 0, a: 0 };

describe("scoreDays", () => {
  it("scores a day on its energy, not on an average that the night dilutes", () => {
    // 7 producing hours at 1000 W expected against 900 W measured: 700 Wh out
    // over the day. The hourly MAE of the same day is 100 W across 7 hours and
    // 0 W across the other 17, which reads as 29 W and says nothing.
    const points = localDay(2026, 6, 10, shaped(1000, 900));
    const res = scoreDays(points, new Date(2026, 5, 12));

    expect(res.dailyDays).toBe(1);
    expect(res.dailyMaeWh).toBe(700);
    expect(res.dailyMaePct).toBe(11.1); // 700 of 6300 Wh produced
  });

  it("leaves the running day out of the aggregate and reports it on its own", () => {
    const finished = localDay(2026, 6, 10, shaped(1000, 900));
    // Today, three producing hours in: comparing 3 h of production against a
    // whole day's forecast is what would read as a collapse.
    const today = localDay(2026, 6, 11, shaped(1000, 800), 12);
    const res = scoreDays([...finished, ...today], new Date(2026, 5, 11, 12));

    expect(res.dailyDays).toBe(1);
    expect(res.dailyMaeWh).toBe(700);
    expect(res.today?.day).toBe("2026-06-11");
    expect(res.today?.hours).toBe(12);
    // Both sides summed over the SAME elapsed hours: 3 producing hours so far.
    expect(res.today?.forecastWh).toBe(3000);
    expect(res.today?.actualWh).toBe(2400);
  });

  it("drops a day the meter did not cover, rather than blaming the model for an outage", () => {
    const partial = localDay(2026, 6, 10, shaped(1000, 900), 22);
    const res = scoreDays(partial, new Date(2026, 5, 12));

    expect(res.dailyDays).toBe(0);
    expect(res.dailyMaeWh).toBeNull();
  });

  it("keeps a day one hour short, which is what a spring-forward day has", () => {
    // Built on plain local components on purpose: under a timezone that has no
    // DST (CI runs UTC) the local constructor would hand back 24 real hours and
    // the case would pass for the wrong reason. What is pinned here is the
    // threshold itself, on exactly 23 distinct paired hours.
    const short = localDay(2026, 6, 10, shaped(1000, 900), 23);
    const res = scoreDays(short, new Date(2026, 5, 12));

    expect(res.dailyDays).toBe(1);
    expect(new Set(short.map((p) => p.at)).size).toBe(23);
  });

  it("averages the error over the days, rather than summing it", () => {
    // Summing instead of dividing passes every single-day assertion, and ships
    // "± 10.31 kWh" where the reference site reads "± 1.15 kWh".
    const monday = localDay(2026, 6, 8, shaped(1000, 900)); // 700 Wh out
    const tuesday = localDay(2026, 6, 9, shaped(1000, 500)); // 3500 Wh out
    const res = scoreDays([...monday, ...tuesday], new Date(2026, 5, 12));

    expect(res.dailyDays).toBe(2);
    expect(res.dailyMaeWh).toBe(2100);
  });

  it("keeps the running day out even once it has a full day of hours", () => {
    // The `hours >= COMPLETE_DAY_HOURS` filter alone does not do this: by
    // 23:30 today has 23 paired hours and would enter the aggregate, so a
    // collapsed afternoon would swing the headline for the last half hour of
    // every day and swing back at midnight.
    const yesterday = localDay(2026, 6, 10, shaped(1000, 900)); // 700 Wh out
    const today = localDay(2026, 6, 11, shaped(1000, 300), 23); // 4900 Wh out
    const res = scoreDays([...yesterday, ...today], new Date(2026, 5, 11, 23, 30));

    expect(res.dailyDays).toBe(1);
    expect(res.dailyMaeWh).toBe(700);
    expect(res.today?.day).toBe("2026-06-11");
    expect(res.today?.hours).toBe(23);
  });

  it("weights the percentage by production, so a dark day cannot dominate it", () => {
    // A 200 Wh miss on a 400 Wh winter day is 50% on its own; a 700 Wh miss on
    // a 6300 Wh summer day is 11%. Averaging the two percentages would post
    // 30%, which describes neither. The share of what was actually produced is
    // 900 of 6700, and that is the number a household can act on.
    const bright = localDay(2026, 6, 10, shaped(1000, 900));
    const dark = localDay(2026, 12, 10, (hour) =>
      hour >= 12 && hour <= 13 ? { f: 300, a: 200 } : { f: 0, a: 0 },
    );
    const res = scoreDays([...bright, ...dark], new Date(2026, 11, 12));

    expect(res.dailyDays).toBe(2);
    expect(res.dailyMaePct).toBe(13.4); // 900 / 6700
  });

  it("says nothing rather than zero when no day has finished", () => {
    const today = localDay(2026, 6, 11, shaped(1000, 900), 6);
    const res = scoreDays(today, new Date(2026, 5, 11, 6));

    expect(res.dailyDays).toBe(0);
    expect(res.dailyMaeWh).toBeNull();
    expect(res.dailyMaePct).toBeNull();
    expect(res.today?.hours).toBe(6);
  });
});

describe("aggregateDays", () => {
  it("attributes the midnight hour to the day it closes, not the one it opens", () => {
    // Both series label an hour by its END, so the point stamped at local
    // midnight covers 23:00-00:00 of the day before. Bucketing it on its own
    // date would hand every day its predecessor's last hour.
    const days = aggregateDays([
      { at: new Date(2026, 5, 11, 0).toISOString(), forecastW: 10, actualW: 20 },
      { at: new Date(2026, 5, 11, 1).toISOString(), forecastW: 30, actualW: 40 },
    ]);

    expect(days.map((d) => d.day)).toEqual(["2026-06-10", "2026-06-11"]);
    expect(days[0].actualWh).toBe(20);
    expect(days[1].actualWh).toBe(40);
  });

  it("ignores an unparseable stamp instead of bucketing it under NaN", () => {
    const days = aggregateDays([
      { at: "not-a-date", forecastW: 10, actualW: 20 },
      { at: new Date(2026, 5, 11, 1).toISOString(), forecastW: 30, actualW: 40 },
    ]);

    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-06-11");
  });
});

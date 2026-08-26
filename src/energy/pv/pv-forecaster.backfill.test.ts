import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MIN_SAMPLES } from "./pv-model.js";
import { PvForecaster } from "./pv-forecaster.js";

/**
 * Fitting from existing history (spec 161), driven through the real `backfill`
 * against a real database.
 *
 * The pairing arithmetic is covered directly in `pv-backfill.test.ts`. What is
 * exercised here is everything that needs state: the refusals, the upsert that
 * makes a second run harmless, and the model actually landing in the table.
 */

const EQUIPMENT_ID = "eq-pv";
const PEAK = 4000;
/** Enough daylight hours to clear `MIN_SAMPLES` comfortably. */
const DAYS = 30;
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE pv_forecast_model (
      equipment_id   TEXT PRIMARY KEY,
      gain           REAL NOT NULL,
      shape          TEXT NOT NULL,
      fitted_at      TEXT NOT NULL,
      samples        INTEGER NOT NULL,
      fitted_peak_wc REAL NOT NULL,
      gain_reset_at  TEXT,
      capacity_changed_at TEXT
    );
    CREATE TABLE pv_forecast_sample (
      equipment_id TEXT NOT NULL,
      at           TEXT NOT NULL,
      hour_local   INTEGER NOT NULL,
      poa          REAL NOT NULL,
      temp_c       REAL NOT NULL,
      watts        REAL NOT NULL,
      direct_fraction REAL,
      PRIMARY KEY (equipment_id, at)
    );
    CREATE TABLE pv_health_day (
      equipment_id      TEXT NOT NULL,
      day               TEXT NOT NULL,
      ratio             REAL NOT NULL,
      hours             INTEGER NOT NULL,
      measured_wh       REAL NOT NULL,
      irradiation_wh_m2 REAL NOT NULL,
      PRIMARY KEY (equipment_id, day)
    );
    CREATE TABLE pv_health_alert (
      equipment_id TEXT PRIMARY KEY,
      since        TEXT NOT NULL,
      normal       REAL NOT NULL,
      deficit      REAL NOT NULL,
      raised_at    TEXT NOT NULL
    );
  `);
}

/** Hour starts over the last `DAYS` days, at the hours the sun is up. */
function hourStarts(): number[] {
  const out: number[] = [];
  const now = Date.now();
  for (let d = 1; d <= DAYS; d++) {
    const day = new Date(now - d * 86_400_000);
    for (const h of HOURS) {
      out.push(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h));
    }
  }
  return out;
}

interface BuildOptions {
  /** Omit the published history entirely, as an older plugin would. */
  noHistory?: boolean;
  /** Publish a history whose hours carry no readings. */
  emptyHistory?: boolean;
  planes?: Array<{ tiltDeg: number; azimuthDeg: number; peakWc: number }>;
  since?: string;
  /** Make the Influx query throw, as an unreachable database does. */
  influxDown?: boolean;
  /** Return no production rows. */
  noProduction?: boolean;
  coordinates?: boolean;
}

/** Flux emitted by the most recent `build(...)` forecaster, for assertions. */
const emittedFlux: string[] = [];

function build(db: Database.Database, opts: BuildOptions = {}): PvForecaster {
  const noop = (): void => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as never;

  const starts = hourStarts();
  const history = opts.emptyHistory
    ? starts.map((ms) => ({
        t: new Date(ms).toISOString(),
        direct: null,
        diffuse: null,
        temp: null,
      }))
    : starts.map((ms) => ({ t: new Date(ms).toISOString(), direct: 600, diffuse: 120, temp: 24 }));

  const deviceData = opts.noHistory
    ? []
    : [{ key: "irradiance_history", type: "json", value: { hours: history } }];

  const planes = opts.planes ?? [{ tiltDeg: 35, azimuthDeg: 180, peakWc: PEAK }];

  return new PvForecaster({
    db,
    logger,
    eventBus: { onType: () => noop } as never,
    deviceManager: { getAllWithData: () => [{ data: deviceData }] } as never,
    equipmentManager: {
      getAll: () => [{ id: EQUIPMENT_ID, solarProfile: { planes, since: opts.since } }],
      getDataBindingsWithValues: () => [{ alias: "power", category: "power", value: 1000 }],
    } as never,
    settingsManager: {
      get: (key: string) => {
        if (opts.coordinates === false) return undefined;
        if (key === "home.latitude") return "45.175508";
        if (key === "home.longitude") return "5.805943";
        return undefined;
      },
    } as never,
    influxClient: {
      isConnected: () => true,
      getConfig: () => ({ bucket: "sowel", org: "sowel" }),
      getClient: () => ({
        getQueryApi: () => ({
          iterateRows: (flux: string) => {
            emittedFlux.push(flux);
            if (opts.influxDown) {
              // Rejecting, not throwing synchronously: an unreachable Influx
              // fails while the caller is already iterating.
              return {
                [Symbol.asyncIterator]() {
                  return {
                    next: () => Promise.reject(new Error("influx unreachable")),
                  };
                },
              };
            }
            const rows = opts.noProduction ? [] : starts;
            return (async function* () {
              for (const ms of rows) {
                yield {
                  values: [],
                  tableMeta: {
                    toObject: () => ({ _time: new Date(ms).toISOString(), _value: 2500 }),
                  },
                } as never;
              }
            })();
          },
        }),
      }),
    } as never,
  });
}

function sampleCount(db: Database.Database): number {
  return (
    db
      .prepare("SELECT count(*) AS n FROM pv_forecast_sample WHERE equipment_id = ?")
      .get(EQUIPMENT_ID) as { n: number }
  ).n;
}

describe("backfill from existing history", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  it("fits a model from history alone, with no live sample ever collected", async () => {
    const forecaster = build(db);
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.ok).toBe(true);
    expect(report.hoursPaired).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect(report.model).not.toBeNull();
    // This is the whole point: a model exists on day one instead of day twelve.
    const row = db
      .prepare("SELECT gain, fitted_peak_wc FROM pv_forecast_model WHERE equipment_id = ?")
      .get(EQUIPMENT_ID) as { gain: number; fitted_peak_wc: number };
    expect(row.gain).toBeGreaterThan(0);
    expect(row.fitted_peak_wc).toBe(PEAK);
  });

  it("reports the window it used and why it stopped there", async () => {
    const forecaster = build(db);
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.boundedBy).toBe("window");
    expect(Date.parse(report.windowTo!)).toBeGreaterThan(Date.parse(report.windowFrom!));
  });

  it("stops at a declared change date, and says that is why", async () => {
    const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const forecaster = build(db, { since });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.boundedBy).toBe("declaration");
    // Five days of daylight hours, not fourteen: fitting across the change is
    // exactly what this bound exists to prevent.
    expect(report.hoursPaired).toBeLessThan(DAYS * HOURS.length);
    expect(report.hoursPaired).toBeGreaterThan(0);
  });

  it("writes the samples but fits nothing when the declared window is too short", async () => {
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const forecaster = build(db, { since });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.ok).toBe(true);
    expect(report.model).toBeNull();
    expect(report.reason).toBe("not-enough-history");
    // The hours are still written: a live fortnight on top of them reaches the
    // floor. Only the pruning waits for a successful fit.
    expect(sampleCount(db)).toBe(report.hoursPaired);
  });

  it("drops history from before a declared change, so the fit actually moves", async () => {
    // The order that matters, and the one that was wrong: an unbounded run
    // first, a declared date second. Bounding only what the second run *adds*
    // leaves the first run's samples in the store, and the nightly refit keeps
    // fitting on an array that no longer exists.
    const wide = build(db);
    await wide.backfill(EQUIPMENT_ID);
    wide.stop();
    const wideCount = sampleCount(db);

    // Long enough to fit on its own, which is what licenses the delete.
    const since = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const narrow = build(db, { since });
    const report = await narrow.backfill(EQUIPMENT_ID);
    narrow.stop();

    expect(report.boundedBy).toBe("declaration");
    expect(report.model).not.toBeNull();
    expect(sampleCount(db)).toBeLessThan(wideCount);
    expect(sampleCount(db)).toBe(report.hoursPaired);
    // Nothing older than the declared date survives anywhere in the store.
    const oldest = (
      db
        .prepare("SELECT min(at) AS a FROM pv_forecast_sample WHERE equipment_id = ?")
        .get(EQUIPMENT_ID) as { a: string }
    ).a;
    expect(oldest >= since).toBe(true);
  });

  it("destroys nothing when the declared window turns out too short to fit", async () => {
    // The failure this guards: a mistyped date — yesterday instead of last year
    // — used to delete every accumulated sample before anyone knew whether a fit
    // was even possible, and the route still answered 200.
    const wide = build(db);
    await wide.backfill(EQUIPMENT_ID);
    wide.stop();
    const before = sampleCount(db);

    const narrow = build(db, { since: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    const report = await narrow.backfill(EQUIPMENT_ID);
    narrow.stop();

    expect(report.model).toBeNull();
    expect(report.reason).toBe("not-enough-history");
    // Every earlier sample survives: the household is exactly where it started,
    // and can correct the date and run it again.
    expect(sampleCount(db)).toBe(before);
  });

  it("is idempotent, so running it twice does not double the history", async () => {
    const forecaster = build(db);
    await forecaster.backfill(EQUIPMENT_ID);
    const after1 = sampleCount(db);
    await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(sampleCount(db)).toBe(after1);
  });

  it("refuses when no array is declared", async () => {
    const forecaster = build(db, { planes: [] });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.ok).toBe(false);
    expect(report.reason).toBe("no-profile");
    expect(sampleCount(db)).toBe(0);
  });

  it("refuses when no plugin publishes the history", async () => {
    // The old-plugin case. Distinct from "not enough history" because the fix is
    // different: update the plugin, not wait.
    const forecaster = build(db, { noHistory: true });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.reason).toBe("no-history");
  });

  it("treats a history of entirely null hours as no history", async () => {
    const forecaster = build(db, { emptyHistory: true });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.reason).toBe("no-history");
  });

  it("refuses without home coordinates rather than fitting on a nonsense sun", async () => {
    const forecaster = build(db, { coordinates: false });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    expect(report.reason).toBe("no-coordinates");
  });

  it("distinguishes an unreachable database from an empty history", async () => {
    const down = build(db, { influxDown: true });
    const downReport = await down.backfill(EQUIPMENT_ID);
    down.stop();
    expect(downReport.reason).toBe("influx-unavailable");

    const empty = build(db, { noProduction: true });
    const emptyReport = await empty.backfill(EQUIPMENT_ID);
    empty.stop();
    // Zero hours is a true answer; "influx is down" is not.
    expect(emptyReport.ok).toBe(true);
    expect(emptyReport.hoursPaired).toBe(0);
    expect(emptyReport.reason).toBe("not-enough-history");
  });

  it("clears any pending capacity stamp, since the fit describes the declared array", async () => {
    db.prepare(
      `INSERT INTO pv_forecast_model
         (equipment_id, gain, shape, fitted_at, samples, fitted_peak_wc, gain_reset_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(EQUIPMENT_ID, 2.0, "{}", new Date().toISOString(), 10, 3000, new Date().toISOString());

    const forecaster = build(db);
    await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    const row = db
      .prepare("SELECT fitted_peak_wc, gain_reset_at FROM pv_forecast_model WHERE equipment_id = ?")
      .get(EQUIPMENT_ID) as { fitted_peak_wc: number; gain_reset_at: string | null };
    // Left armed, the very next nightly refit would hold the backfilled gain
    // hostage to a change that no longer exists.
    expect(row.gain_reset_at).toBeNull();
    expect(row.fitted_peak_wc).toBe(PEAK);
  });
});

describe("the production query the backfill emits", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    emittedFlux.length = 0;
  });

  it("reads the 90-day hourly bucket, and does not re-stamp its points", async () => {
    const forecaster = build(db);
    await forecaster.backfill(EQUIPMENT_ID);
    forecaster.stop();

    const flux = emittedFlux.at(-1)!;
    expect(flux).toContain('from(bucket: "sowel-hourly")');
    expect(flux).toContain('r._field == "mean"');
    // Read with no shift, on purpose: `-hourly` labels an hour by its END and so
    // does Open-Meteo's irradiance, so the two already agree. Shifting the
    // production side collapsed the fitted gain from 3.8 to 45.8 and turned the
    // hourly shape into a monotonic decay from sunrise.
    expect(flux).not.toContain("timeShift");
  });
});

/**
 * What the computed aliases expose, and when.
 *
 * These are the machine-facing surface: a recipe binds to `pv_forecast_now_w`
 * and acts on it. Unlike the panel, it has no "provisional" label to read, so a
 * clear-sky estimate published here is indistinguishable from a learned
 * forecast — and clear-sky reads near nameplate by construction.
 */
describe("computed aliases while there is no model", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  it("publishes nothing before a model exists", async () => {
    const forecaster = build(db, { since: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    const report = await forecaster.backfill(EQUIPMENT_ID);
    expect(report.model).toBeNull();

    // `persist()` already refuses to write this curve to Influx; the aliases
    // must agree with it rather than quietly hand it to a recipe.
    expect(forecaster.getComputedDataForEquipment(EQUIPMENT_ID)).toEqual([]);
    forecaster.stop();
  });

  it("publishes the figures once a model has been fitted", async () => {
    const forecaster = build(db);
    const report = await forecaster.backfill(EQUIPMENT_ID);
    expect(report.model).not.toBeNull();
    forecaster.stop();

    // The curve is computed on the next recompute, which needs the forward
    // series; what matters here is that the model gate no longer blocks.
    expect(forecaster.getModel(EQUIPMENT_ID)).not.toBeNull();
  });
});

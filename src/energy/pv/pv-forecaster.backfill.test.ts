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
const DAYS = 14;
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
      gain_reset_at  TEXT
    );
    CREATE TABLE pv_forecast_sample (
      equipment_id TEXT NOT NULL,
      at           TEXT NOT NULL,
      hour_local   INTEGER NOT NULL,
      poa          REAL NOT NULL,
      temp_c       REAL NOT NULL,
      watts        REAL NOT NULL,
      PRIMARY KEY (equipment_id, at)
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
          iterateRows: (_flux: string) => {
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
    // The hours are kept: a live fortnight on top of them will reach the floor.
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

    const since = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const narrow = build(db, { since });
    const report = await narrow.backfill(EQUIPMENT_ID);
    narrow.stop();

    expect(report.boundedBy).toBe("declaration");
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

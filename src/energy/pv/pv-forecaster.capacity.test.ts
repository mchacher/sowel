import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { MIN_SAMPLES } from "./pv-model.js";
import { PvForecaster } from "./pv-forecaster.js";

/**
 * The capacity-change trigger, on a real database.
 *
 * This logic has broken twice, both times the same way: something advanced
 * `fitted_peak_wc` past a change nobody had measured, which silently disarmed
 * the fast re-estimation and left the forecast wrong by the size of the change
 * until the 45-day window drifted. Neither failure was visible in any output.
 *
 * Driven through the real `refitAll`, not a reimplementation of its rules.
 */

const EQUIPMENT_ID = "eq-pv";
const OLD_PEAK = 3000;
const NEW_PEAK = 4000;

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE equipments (id TEXT PRIMARY KEY, solar_profile TEXT);
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

/** `count` daylight samples, the most recent `fresh` of them after `changedAt`. */
function seedSamples(db: Database.Database, count: number, changedAt: number, fresh: number): void {
  const insert = db.prepare(
    `INSERT INTO pv_forecast_sample (equipment_id, at, hour_local, poa, temp_c, watts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    // The freshest `fresh` samples sit after the change, the rest well before.
    const ms =
      i < count - fresh
        ? changedAt - (count - fresh - i + 1) * 3_600_000
        : changedAt + (i - (count - fresh) + 1) * 3_600_000;
    insert.run(EQUIPMENT_ID, new Date(ms).toISOString(), 8 + (i % 10), 600, 25, 1500);
  }
}

function build(db: Database.Database): PvForecaster {
  const noop = (): void => {};
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => logger,
  } as never;

  return new PvForecaster({
    db,
    logger,
    eventBus: { onType: () => noop } as never,
    influxClient: { isConnected: () => false } as never,
    deviceManager: { getAllWithData: () => [] } as never,
    equipmentManager: {
      getAll: () => [
        {
          id: EQUIPMENT_ID,
          solarProfile: { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: NEW_PEAK }] },
        },
      ],
      getDataBindingsWithValues: () => [],
    } as never,
    settingsManager: { get: () => undefined } as never,
  });
}

describe("the capacity-change trigger survives the nightly refit", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.prepare("INSERT INTO equipments (id, solar_profile) VALUES (?, ?)").run(
      EQUIPMENT_ID,
      JSON.stringify({ planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: NEW_PEAK }] }),
    );
  });

  function seedModel(gainResetAt: string | null): void {
    db.prepare(
      `INSERT INTO pv_forecast_model
         (equipment_id, gain, shape, fitted_at, samples, fitted_peak_wc, gain_reset_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(EQUIPMENT_ID, 2.5, "{}", new Date().toISOString(), 500, OLD_PEAK, gainResetAt);
  }

  function row(): { fitted_peak_wc: number; gain_reset_at: string | null } {
    return db
      .prepare("SELECT fitted_peak_wc, gain_reset_at FROM pv_forecast_model WHERE equipment_id = ?")
      .get(EQUIPMENT_ID) as { fitted_peak_wc: number; gain_reset_at: string | null };
  }

  it("keeps the old capacity on the row while the change is unmeasured", () => {
    const changedAt = Date.now() - 6 * 3_600_000;
    seedModel(new Date(changedAt).toISOString());
    // Plenty of history, but almost none of it after the change.
    seedSamples(db, MIN_SAMPLES + 60, changedAt, 4);

    build(db).refitAll();

    const after = row();
    // Advancing this is what disarmed the trigger, twice.
    expect(after.fitted_peak_wc).toBe(OLD_PEAK);
    expect(after.gain_reset_at).not.toBeNull();
  });

  it("closes the change once the window has actually seen the new array", () => {
    const changedAt = Date.now() - 40 * 24 * 3_600_000;
    seedModel(new Date(changedAt).toISOString());
    seedSamples(db, MIN_SAMPLES + 60, changedAt, MIN_SAMPLES + 60);

    build(db).refitAll();

    const after = row();
    expect(after.fitted_peak_wc).toBe(NEW_PEAK);
    expect(after.gain_reset_at).toBeNull();
  });

  it("stamps the declared capacity normally when no change is pending", () => {
    seedModel(null);
    seedSamples(db, MIN_SAMPLES + 60, Date.now() - 20 * 24 * 3_600_000, MIN_SAMPLES + 60);

    build(db).refitAll();

    expect(row().fitted_peak_wc).toBe(NEW_PEAK);
    expect(row().gain_reset_at).toBeNull();
  });

  it("leaves a row alone when there is not enough history to fit at all", () => {
    seedModel(new Date(Date.now() - 3_600_000).toISOString());
    seedSamples(db, 10, Date.now() - 3_600_000, 10);

    build(db).refitAll();

    const after = row();
    expect(after.fitted_peak_wc).toBe(OLD_PEAK);
    expect(after.gain_reset_at).not.toBeNull();
  });
});

/**
 * What the nightly refit is allowed to overwrite.
 *
 * The stamp was guarded; the gain it protects was not. While a declared capacity
 * change is pending, the stored gain is the one re-estimated on post-change
 * production and the 45-day window still describes the array as it was — so
 * writing the window's gain at 02:15 undoes exactly the correction the pending
 * state exists to preserve.
 *
 * The seeded samples all fit a gain of 2.5 (1500 W at 600 W/m2), so a kept gain
 * and a refit one are trivially distinguishable.
 */
describe("the nightly refit does not undo a re-estimated gain", () => {
  let db: Database.Database;

  const WINDOW_GAIN = 2.5;
  const RE_ESTIMATED = 3.33;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    db.prepare("INSERT INTO equipments (id, solar_profile) VALUES (?, ?)").run(
      EQUIPMENT_ID,
      JSON.stringify({ planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: NEW_PEAK }] }),
    );
  });

  function seedModelWithGain(gain: number, gainResetAt: string | null, peakWc: number): void {
    db.prepare(
      `INSERT INTO pv_forecast_model
         (equipment_id, gain, shape, fitted_at, samples, fitted_peak_wc, gain_reset_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      EQUIPMENT_ID,
      gain,
      JSON.stringify({ 8: 1, 9: 1 }),
      new Date().toISOString(),
      500,
      peakWc,
      gainResetAt,
    );
  }

  function gainNow(): number {
    return (
      db.prepare("SELECT gain FROM pv_forecast_model WHERE equipment_id = ?").get(EQUIPMENT_ID) as {
        gain: number;
      }
    ).gain;
  }

  it("keeps a fresh re-estimate when almost no post-change history exists yet", () => {
    // The state the capacity trigger leaves the moment it fires: capacity
    // already advanced to the declared value, stamp still set, and only a
    // handful of hours of the new array recorded.
    const changedAt = Date.now() - 4 * 3_600_000;
    seedModelWithGain(RE_ESTIMATED, new Date(changedAt).toISOString(), NEW_PEAK);
    seedSamples(db, MIN_SAMPLES + 60, changedAt, 4);

    build(db).refitAll();

    // Re-estimated in the evening, silently back to the old array by morning —
    // the panel would report a gain that no longer exists.
    expect(gainNow()).toBeCloseTo(RE_ESTIMATED, 5);
  });

  it("keeps the gain the capacity trigger re-estimated", () => {
    // The state `modelFor` leaves behind once it has fired: capacity advanced to
    // the declared value, stamp still set because the window has not caught up.
    const changedAt = Date.now() - 2 * 24 * 3_600_000;
    seedModelWithGain(RE_ESTIMATED, new Date(changedAt).toISOString(), NEW_PEAK);
    seedSamples(db, MIN_SAMPLES + 60, changedAt, 20);

    build(db).refitAll();

    expect(gainNow()).toBeCloseTo(RE_ESTIMATED, 5);
  });

  it("refreshes the shape even while the gain is held", () => {
    const reEstimatedAt = Date.now() - 4 * 3_600_000;
    seedModelWithGain(RE_ESTIMATED, new Date(reEstimatedAt).toISOString(), NEW_PEAK);
    seedSamples(db, MIN_SAMPLES + 60, reEstimatedAt, 4);

    build(db).refitAll();

    // The seeded shape had two hours; the window covers ten. Holding the gain
    // must not freeze the rest of the model.
    const shape = JSON.parse(
      (
        db
          .prepare("SELECT shape FROM pv_forecast_model WHERE equipment_id = ?")
          .get(EQUIPMENT_ID) as {
          shape: string;
        }
      ).shape,
    ) as Record<string, number>;
    expect(Object.keys(shape).length).toBeGreaterThan(2);
  });

  it("takes the window gain once the window has actually seen the new array", () => {
    const changedAt = Date.now() - 40 * 24 * 3_600_000;
    seedModelWithGain(RE_ESTIMATED, new Date(changedAt).toISOString(), NEW_PEAK);
    seedSamples(db, MIN_SAMPLES + 60, changedAt, MIN_SAMPLES + 60);

    build(db).refitAll();

    // The hold is temporary by design: once enough post-change history exists,
    // the full fit is the better estimate and must win.
    expect(gainNow()).toBeCloseTo(WINDOW_GAIN, 5);
  });
});

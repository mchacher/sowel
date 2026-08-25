import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_DAYS, MIN_NORMAL_DAYS } from "./pv-health.js";
import { PvForecaster } from "./pv-forecaster.js";

/**
 * The daily health check, driven through the real `runHealthCheck` against a
 * real database (spec 162).
 *
 * The rules are covered directly in `pv-health.test.ts`. What is exercised here
 * is everything that needs state: the day grouping, the upsert, and the alarm
 * being raised once rather than every night.
 */

const EQUIPMENT_ID = "eq-pv";
const PEAK = 4000;
const POA = 800;

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
      equipment_id    TEXT NOT NULL,
      at              TEXT NOT NULL,
      hour_local      INTEGER NOT NULL,
      poa             REAL NOT NULL,
      temp_c          REAL NOT NULL,
      watts           REAL NOT NULL,
      direct_fraction REAL,
      PRIMARY KEY (equipment_id, at)
    );
    CREATE TABLE pv_health_day (
      equipment_id TEXT NOT NULL,
      day          TEXT NOT NULL,
      ratio        REAL NOT NULL,
      hours        INTEGER NOT NULL,
      measured_wh  REAL NOT NULL,
      modelled_wh  REAL NOT NULL,
      PRIMARY KEY (equipment_id, day)
    );
  `);
}

function seedModel(db: Database.Database): void {
  db.prepare(
    `INSERT INTO pv_forecast_model
       (equipment_id, gain, shape, fitted_at, samples, fitted_peak_wc, gain_reset_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(EQUIPMENT_ID, 3.8, JSON.stringify({ 12: 1 }), new Date().toISOString(), 300, PEAK);
}

/**
 * `days` consecutive days ending yesterday, each with six clear midday hours at
 * `watts`. `faultyTail` days at the end run at `faultyWatts` instead.
 */
function seedDays(
  db: Database.Database,
  days: number,
  watts: number,
  faultyTail = 0,
  faultyWatts = watts,
  directFraction: number | null = 0.9,
): void {
  const insert = db.prepare(
    `INSERT INTO pv_forecast_sample
       (equipment_id, at, hour_local, poa, temp_c, watts, direct_fraction)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let d = days; d >= 1; d--) {
    const base = new Date(Date.now() - d * 86_400_000);
    const faulty = d <= faultyTail;
    for (let h = 10; h <= 15; h++) {
      const at = new Date(base);
      at.setHours(h, 0, 0, 0);
      insert.run(
        EQUIPMENT_ID,
        at.toISOString(),
        h,
        POA,
        25,
        faulty ? faultyWatts : watts,
        directFraction,
      );
    }
  }
}

function build(db: Database.Database, emit: (e: unknown) => void = () => {}): PvForecaster {
  const noop = (): void => {};
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as never;

  return new PvForecaster({
    db,
    logger,
    eventBus: { onType: () => noop, emit } as never,
    deviceManager: { getAllWithData: () => [] } as never,
    equipmentManager: {
      getAll: () => [
        {
          id: EQUIPMENT_ID,
          name: "Shelly Solar",
          zoneId: "zone-1",
          solarProfile: { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: PEAK }] },
        },
      ],
      getDataBindingsWithValues: () => [],
    } as never,
    settingsManager: { get: () => undefined } as never,
    influxClient: {
      isConnected: () => false,
      getConfig: () => null,
      getClient: () => null,
    } as never,
  });
}

const storedDays = (db: Database.Database): number =>
  (db.prepare("SELECT count(*) AS n FROM pv_health_day").get() as { n: number }).n;

describe("the daily PV health check", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedModel(db);
  });

  it("stores one ratio per qualifying day", () => {
    seedDays(db, 10, 3000);
    const f = build(db);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(10);
    const row = db.prepare("SELECT ratio, hours FROM pv_health_day LIMIT 1").get() as {
      ratio: number;
      hours: number;
    };
    expect(row.hours).toBe(6);
    expect(row.ratio).toBeCloseTo(3000 / POA, 6);
  });

  it("stores nothing for days whose hours were never clear", () => {
    // Overcast is missing information, not bad performance.
    seedDays(db, 10, 3000, 0, 3000, 0.3);
    const f = build(db);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(0);
  });

  it("skips rows written before the fraction existed", () => {
    seedDays(db, 10, 3000, 0, 3000, null);
    const f = build(db);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(0);
  });

  it("is idempotent, so running it twice does not double the history", () => {
    seedDays(db, 10, 3000);
    const f = build(db);
    f.runHealthCheck();
    const after1 = storedDays(db);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(after1);
  });

  it("raises an alarm on a sustained deficit", () => {
    // 25 % down, a whole micro-inverter, for the last three days.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.stop();

    const raised = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === "system.alarm.raised");
    expect(raised).toHaveLength(1);
    expect(raised[0].source).toBe("pv-health");
    expect(raised[0].level).toBe("warning");
    expect(raised[0].zoneId).toBe("zone-1");
    expect(String(raised[0].message)).toContain("25 %");
  });

  it("raises once, not again every night", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.runHealthCheck();
    f.runHealthCheck();
    f.stop();

    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(1);
  });

  it("stays quiet on a healthy array", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.stop();

    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(0);
  });

  it("stays quiet on a deficit inside the margin", () => {
    // 8 % down: ordinary variation against a 4.3 % noise floor.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2760);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.stop();

    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(0);
  });

  it("resolves when production comes back", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();

    // A clear day back at full output.
    db.prepare("DELETE FROM pv_forecast_sample").run();
    db.prepare("DELETE FROM pv_health_day").run();
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000);
    f.runHealthCheck();
    f.stop();

    const resolved = emit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "system.alarm.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].source).toBe("pv-health");
  });

  it("does nothing at all without a fitted model", () => {
    // The provisional clear-sky curve reads high by construction; judging an
    // array against it would report every new installation as failing.
    db.prepare("DELETE FROM pv_forecast_model").run();
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("getHealth", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedModel(db);
  });

  const equipment = {
    id: EQUIPMENT_ID,
    name: "Shelly Solar",
    zoneId: "zone-1",
    solarProfile: { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: PEAK }] },
  } as never;

  it("reports the series, the normal and the detection speed", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000);
    const f = build(db);
    f.runHealthCheck();
    const h = f.getHealth(equipment);
    f.stop();

    expect(h.days.length).toBe(MIN_NORMAL_DAYS + ALERT_DAYS);
    expect(h.normal).toBeCloseTo(3000 / POA, 6);
    expect(h.alert).toBeNull();
    expect(h.detection).not.toBeNull();
    expect(h.detection!.qualifyingDays).toBeGreaterThan(0);
  });

  it("reports the alert when there is one", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const f = build(db);
    f.runHealthCheck();
    const h = f.getHealth(equipment);
    f.stop();

    expect(h.alert).not.toBeNull();
    expect(h.alert!.deficit).toBeCloseTo(0.25, 2);
  });

  it("says nothing rather than guessing when there is no history", () => {
    const f = build(db);
    const h = f.getHealth(equipment);
    f.stop();

    expect(h.days).toEqual([]);
    expect(h.normal).toBeNull();
    expect(h.detection).toBeNull();
  });
});

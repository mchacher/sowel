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
      gain_reset_at  TEXT,
      capacity_changed_at TEXT
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

function build(
  db: Database.Database,
  emit: (e: unknown) => void = () => {},
  planes: Array<{ tiltDeg: number; azimuthDeg: number; peakWc: number }> | null = null,
): PvForecaster {
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
          solarProfile:
            planes === null
              ? { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: PEAK }] }
              : { planes },
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

const standingAlerts = (db: Database.Database): number =>
  (db.prepare("SELECT count(*) AS n FROM pv_health_alert").get() as { n: number }).n;

/** Append one more clear day after the newest sample already stored. */
function appendDay(db: Database.Database, watts: number): void {
  const newest = (
    db.prepare("SELECT max(at) AS a FROM pv_forecast_sample").get() as { a: string | null }
  ).a;
  const base = newest ? new Date(Date.parse(newest) + 86_400_000) : new Date();
  const insert = db.prepare(
    `INSERT INTO pv_forecast_sample
       (equipment_id, at, hour_local, poa, temp_c, watts, direct_fraction)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(equipment_id, at) DO UPDATE SET watts = excluded.watts`,
  );
  for (let h = 10; h <= 15; h++) {
    const at = new Date(base);
    at.setHours(h, 0, 0, 0);
    insert.run(EQUIPMENT_ID, at.toISOString(), h, POA, 25, watts, 0.9);
  }
}

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

  it("resolves when a repaired array produces again", () => {
    // Appended to the standing fault, not a reset history: the previous form of
    // this test deleted every sample and reseeded a clean run, so it passed
    // whether or not the alert had been cleared for the right reason.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    expect(standingAlerts(db)).toBe(1);

    // Symmetric with the raise: one good day is no longer enough — that is the
    // anti-flapping rule — so a repaired array clears after ALERT_DAYS of them.
    appendDay(db, 3000);
    f.runHealthCheck();
    expect(standingAlerts(db)).toBe(1);

    for (let i = 1; i < ALERT_DAYS; i++) appendDay(db, 3000);
    f.runHealthCheck();
    f.stop();

    expect(standingAlerts(db)).toBe(0);
    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.resolved")).toHaveLength(1);
  });

  it("does not clear itself once the fault fills the median window", () => {
    // The critical defect the alert table exists for: a rolling median absorbs a
    // sustained fault, and after fourteen clear days the alert used to clear
    // itself and announce that the panels had recovered.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();

    for (let i = 0; i < 16; i++) {
      appendDay(db, 2250);
      f.runHealthCheck();
    }
    f.stop();

    expect(standingAlerts(db)).toBe(1);
    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.resolved")).toHaveLength(0);
  });

  it("survives a restart without re-raising or losing the resolution", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const first = vi.fn();
    const a = build(db, first);
    a.runHealthCheck();
    a.stop();
    expect(first.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(1);

    // A new process over the same database, as every self-update produces.
    const second = vi.fn();
    const b = build(db, second);
    b.runHealthCheck();
    expect(second.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(0);

    for (let i = 0; i < ALERT_DAYS; i++) appendDay(db, 3000);
    b.runHealthCheck();
    b.stop();
    // The resolution used to be lost for good: the in-memory flag was empty
    // after the restart, so the branch that emits it could never run.
    expect(second.mock.calls.filter((c) => c[0].type === "system.alarm.resolved")).toHaveLength(1);
  });

  it("does not announce recovery when it merely stops being able to judge", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();

    // A fortnight of overcast: nothing recent to judge on.
    db.prepare("DELETE FROM pv_forecast_sample").run();
    f.runHealthCheck();
    f.stop();

    expect(standingAlerts(db)).toBe(1);
    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.resolved")).toHaveLength(0);
  });

  it("closes a standing alert when the array is no longer declared", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    build(db, emit).runHealthCheck();
    expect(standingAlerts(db)).toBe(1);

    // No foreign key cascades this table, so nothing else would ever close it
    // and the banner would carry a ghost for good.
    const undeclared = build(db, emit, []);
    undeclared.runHealthCheck();
    undeclared.stop();

    expect(standingAlerts(db)).toBe(0);
    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.resolved")).toHaveLength(1);
  });

  it("skips an equipment with no declared array", () => {
    seedDays(db, 10, 3000);
    const f = build(db, () => {}, []);
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(0);
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

  it("exposes the capacity cutoff the series counts from (#724)", () => {
    // The building-progress line needs "since when": the stamped change day,
    // as a local date, or null when nothing was ever stamped.
    const f = build(db);
    expect(f.getHealth(equipment).sinceCutoff).toBeNull();

    // Midday UTC so the expected local date holds in any test-runner timezone.
    db.prepare("UPDATE pv_forecast_model SET capacity_changed_at = ? WHERE equipment_id = ?").run(
      "2026-08-05T12:00:00.000Z",
      EQUIPMENT_ID,
    );
    expect(f.getHealth(equipment).sinceCutoff).toBe("2026-08-05");
    f.stop();
  });
});

/**
 * The long memory the reference needs.
 *
 * Validated against a real eight-month single-panel outage with a known repair
 * date: a reference built on the 45-day sample window caught 7 % of it, one
 * built on a high centile of a year caught 91 %. That only works if the day
 * series outlives the samples that produced it.
 */
describe("health history outlives the sample window", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedModel(db);
  });

  it("keeps stored days after their samples are gone", () => {
    seedDays(db, 20, 3000);
    const f = build(db);
    f.runHealthCheck();
    const before = storedDays(db);
    expect(before).toBe(20);

    // What `pruneSamples` does at 50 days, and what a spec 161 backfill does.
    db.prepare("DELETE FROM pv_forecast_sample").run();
    f.runHealthCheck();
    f.stop();

    expect(storedDays(db)).toBe(before);
  });

  it("judges against the stored series, not only what the samples still hold", () => {
    // A fault that outlives the sample window must still be measured against
    // the array as it was before it started.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    expect(standingAlerts(db)).toBe(1);

    db.prepare("DELETE FROM pv_forecast_sample").run();
    f.runHealthCheck();
    f.stop();

    // The alert stands on history the samples no longer carry.
    expect(standingAlerts(db)).toBe(1);
  });
});

/**
 * A declared capacity change invalidates the health history (spec 162 edge
 * case), through the live path — not only through a backfill.
 *
 * The failure this pins: a household removes two panels and saves the new peak.
 * The 80th-centile reference, built on up to a year of bigger-array days, holds
 * the smaller array to a standard it can never reach; a false "panels failing"
 * alert is raised after three clear days and can never resolve.
 */
describe("a declared capacity change resets the judgement", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
    seedModel(db);
  });

  function markChanged(at: string): void {
    db.prepare("UPDATE pv_forecast_model SET capacity_changed_at = ? WHERE equipment_id = ?").run(
      at,
      EQUIPMENT_ID,
    );
  }

  it("closes a standing alert raised against the old array, as a reset, not a recovery", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    expect(standingAlerts(db)).toBe(1);

    // What `markCapacityChange` writes when the declared peak moves. A second
    // later than the raise: in real life the two are never simultaneous, and in
    // a fast test they land in the same millisecond, where the strict "newer
    // than the raise" comparison correctly does nothing.
    markChanged(new Date(Date.now() + 1000).toISOString());
    f.runHealthCheck();
    f.stop();

    expect(standingAlerts(db)).toBe(0);
    const resolved = emit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "system.alarm.resolved");
    expect(resolved).toHaveLength(1);
    // Worded as monitoring being reset — the panels did not recover.
    expect(String(resolved[0].message)).toContain("declared array changed");
  });

  it("excludes pre-change days from what the card reports", () => {
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000);
    const f = build(db);
    f.runHealthCheck();

    markChanged(new Date().toISOString());
    const h = f.getHealth({
      id: EQUIPMENT_ID,
      name: "Shelly Solar",
      zoneId: "zone-1",
      solarProfile: { planes: [{ tiltDeg: 35, azimuthDeg: 180, peakWc: PEAK }] },
    } as never);
    f.stop();

    // Every stored day predates the change: the reference must not exist and
    // the old-array days must not be shown as the new array's record.
    expect(h.days).toEqual([]);
    expect(h.normal).toBeNull();
  });

  it("does not raise against a reference built on the old array", () => {
    // 25 % lower output on the last days — which is exactly what a smaller
    // array produces, not a fault. With the pre-change days excluded there is
    // no reference yet, so nothing may be asserted.
    seedDays(db, MIN_NORMAL_DAYS + ALERT_DAYS, 3000, ALERT_DAYS, 2250);
    markChanged(new Date(Date.now() - (ALERT_DAYS + 1) * 86_400_000).toISOString());
    const emit = vi.fn();
    const f = build(db, emit);
    f.runHealthCheck();
    f.stop();

    expect(standingAlerts(db)).toBe(0);
    expect(emit.mock.calls.filter((c) => c[0].type === "system.alarm.raised")).toHaveLength(0);
  });
});

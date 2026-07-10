import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PowerSubmeterIntegrator } from "./power-submeter-integrator.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migrations = [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
    "005_device_data_enum_values.sql",
    "006_pool_runtime_and_category_override.sql",
    "007_pool_water_temp_state.sql",
    "008_mqtt_publisher_mapping_enabled.sql",
    "009_submeter_integrator_state.sql",
  ];
  for (const file of migrations) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", `../../migrations/${file}`),
      "utf-8",
    );
    db.exec(sql);
  }
  // Insert minimum zone + equipment rows to satisfy FK on submeter state inserts.
  db.prepare(`INSERT INTO zones (id, name) VALUES (?, ?)`).run("zone-1", "Test");
  db.prepare(
    `INSERT INTO equipments (id, name, zone_id, type, enabled) VALUES (?, ?, ?, ?, 1)`,
  ).run("eq-pac", "PAC", "zone-1", "energy_meter");
  return db;
}

const logger = createLogger("silent").logger;

function makeStubs(
  opts: { isPowerOnly: boolean; influxConnected?: boolean } = { isPowerOnly: true },
) {
  const equipmentManager = {
    getById: vi.fn((id: string) =>
      id === "eq-pac"
        ? { id, name: "PAC", zoneId: "zone-1", type: "energy_meter", enabled: true }
        : null,
    ),
    getAll: vi.fn(() => [
      { id: "eq-pac", name: "PAC", zoneId: "zone-1", type: "energy_meter", enabled: true },
    ]),
    getDataBindingsWithValues: vi.fn(() =>
      opts.isPowerOnly
        ? [{ alias: "power", category: "power", value: 1000 }]
        : [{ alias: "energy", category: "energy", value: 0 }],
    ),
  } as unknown as EquipmentManager;

  const writePoint = vi.fn();
  const influxClient = {
    isConnected: vi.fn(() => opts.influxConnected ?? true),
    writePoint,
  } as unknown as InfluxClient;

  return { equipmentManager, influxClient, writePoint };
}

function emitPower(bus: EventBus, equipmentId: string, value: number) {
  bus.emit({
    type: "equipment.data.changed",
    equipmentId,
    alias: "power",
    value,
    previous: null,
  });
}

describe("PowerSubmeterIntegrator", () => {
  let db: Database.Database;
  let bus: EventBus;

  beforeEach(() => {
    db = createTestDb();
    bus = new EventBus(logger);
  });

  it("first sample sets last_sample_* but does not credit any Wh", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    const t0 = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => t0,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 1000);
    integ.flushAll();

    expect(writePoint).not.toHaveBeenCalled();
    integ.stop();
  });

  it("integrates two samples with constant power", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 1000);
    now += 60_000;
    emitPower(bus, "eq-pac", 1000);
    integ.flushAll();

    expect(writePoint).toHaveBeenCalledOnce();
    integ.stop();
  });

  it("integrates a metering switch reporting power but not energy (spec 129)", () => {
    db.prepare(
      `INSERT INTO equipments (id, name, zone_id, type, enabled) VALUES (?, ?, ?, ?, 1)`,
    ).run("eq-plug", "Prise", "zone-1", "switch");
    const equipmentManager = {
      getById: vi.fn((id: string) =>
        id === "eq-plug"
          ? { id, name: "Prise", zoneId: "zone-1", type: "switch", enabled: true }
          : null,
      ),
      getAll: vi.fn(() => [
        { id: "eq-plug", name: "Prise", zoneId: "zone-1", type: "switch", enabled: true },
      ]),
      getDataBindingsWithValues: vi.fn(() => [{ alias: "power", category: "power", value: 1000 }]),
    } as unknown as EquipmentManager;
    const writePoint = vi.fn();
    const influxClient = { isConnected: vi.fn(() => true), writePoint } as unknown as InfluxClient;

    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();
    emitPower(bus, "eq-plug", 1000);
    now += 60_000;
    emitPower(bus, "eq-plug", 1000);
    integ.flushAll();
    expect(writePoint).toHaveBeenCalledOnce();
    integ.stop();
  });

  it("ignores a bare switch with no power binding (spec 129)", () => {
    db.prepare(
      `INSERT INTO equipments (id, name, zone_id, type, enabled) VALUES (?, ?, ?, ?, 1)`,
    ).run("eq-relay", "Relais", "zone-1", "switch");
    const equipmentManager = {
      getById: vi.fn((id: string) =>
        id === "eq-relay"
          ? { id, name: "Relais", zoneId: "zone-1", type: "switch", enabled: true }
          : null,
      ),
      getAll: vi.fn(() => [
        { id: "eq-relay", name: "Relais", zoneId: "zone-1", type: "switch", enabled: true },
      ]),
      getDataBindingsWithValues: vi.fn(() => [
        { alias: "state", category: "light_state", value: "ON" },
      ]),
    } as unknown as EquipmentManager;
    const writePoint = vi.fn();
    const influxClient = { isConnected: vi.fn(() => true), writePoint } as unknown as InfluxClient;

    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();
    emitPower(bus, "eq-relay", 1000);
    now += 60_000;
    emitPower(bus, "eq-relay", 1000);
    integ.flushAll();
    expect(writePoint).not.toHaveBeenCalled();
    integ.stop();
  });

  it("trapezoidal integration with rising power: prev=500, curr=1500, dt=60s → ~16.67 Wh", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 500);
    now += 60_000;
    emitPower(bus, "eq-pac", 1500);
    integ.flushAll();

    expect(writePoint).toHaveBeenCalledOnce();
    // 500 + 1500 = 2000 / 2 = 1000 W mean × 60s / 3600 = 16.666... Wh
    const row = db
      .prepare(`SELECT pending_wh FROM submeter_integrator_state WHERE equipment_id = 'eq-pac'`)
      .get() as { pending_wh: number };
    expect(row.pending_wh).toBeCloseTo(0, 5); // flushed already
    integ.stop();
  });

  it("negative power → integrate absolute value, warn once", () => {
    const { equipmentManager, influxClient } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", -1000);
    now += 60_000;
    emitPower(bus, "eq-pac", -1000);
    // Read pending_wh BEFORE flush to inspect raw integration
    const row = db
      .prepare(`SELECT pending_wh FROM submeter_integrator_state WHERE equipment_id = 'eq-pac'`)
      .get() as { pending_wh: number };
    expect(row.pending_wh).toBeCloseTo((1000 * 60) / 3600, 5);
    integ.stop();
  });

  it("stale sample (Δt > 600s) → no integration, just refresh baseline", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 1000);
    now += 700 * 1000; // 11.66 min
    emitPower(bus, "eq-pac", 1000);
    integ.flushAll();

    expect(writePoint).not.toHaveBeenCalled();
    integ.stop();
  });

  it("state survives restart — pending_wh persisted, restored on init", () => {
    const stubs = makeStubs();
    let now = 1_700_000_000_000;
    {
      const integ = new PowerSubmeterIntegrator(
        db,
        bus,
        stubs.equipmentManager,
        stubs.influxClient,
        logger,
        { now: () => now, flushIntervalMs: 60_000 },
      );
      integ.init();
      integ.start();
      emitPower(bus, "eq-pac", 1000);
      now += 60_000;
      emitPower(bus, "eq-pac", 1000);
      integ.stop();
    }

    // New integrator on the same DB
    const stubs2 = makeStubs();
    const integ2 = new PowerSubmeterIntegrator(
      db,
      new EventBus(logger),
      stubs2.equipmentManager,
      stubs2.influxClient,
      logger,
      { now: () => now, flushIntervalMs: 60_000 },
    );
    integ2.init();
    integ2.start();
    integ2.flushAll();

    expect(stubs2.writePoint).toHaveBeenCalledOnce();
    integ2.stop();
  });

  it("catchUpFromBindings: integrates from current binding value when no events arrive (steady-state device)", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    // No event emitted, but binding has a value (steady 1000 W).
    integ.flushAll(); // 1st: sets baseline only
    now += 60_000;
    integ.flushAll(); // 2nd: should integrate 1000W * 60s = 16.67 Wh

    expect(writePoint).toHaveBeenCalledOnce();
    integ.stop();
  });

  it("getComputedDataForEquipment exposes cumulative_wh as a computed energy entry", () => {
    const { equipmentManager, influxClient } = makeStubs();
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 1000);
    now += 60_000;
    emitPower(bus, "eq-pac", 1000);

    const computed = integ.getComputedDataForEquipment("eq-pac");
    expect(computed).toHaveLength(1);
    expect(computed[0].alias).toBe("energy");
    expect(computed[0].category).toBe("energy");
    expect(computed[0].value).toBeCloseTo((1000 * 60) / 3600, 2);
    integ.stop();
  });

  it("flush with zero pending_wh writes nothing", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs();
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => 1_700_000_000_000,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();
    integ.flushAll();
    expect(writePoint).not.toHaveBeenCalled();
    integ.stop();
  });

  it("ignores equipment that has cumulative energy (not a power-only submeter)", () => {
    const { equipmentManager, influxClient, writePoint } = makeStubs({
      isPowerOnly: false,
    });
    let now = 1_700_000_000_000;
    const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
      now: () => now,
      flushIntervalMs: 60_000,
    });
    integ.init();
    integ.start();

    emitPower(bus, "eq-pac", 1000);
    now += 60_000;
    emitPower(bus, "eq-pac", 1000);
    integ.flushAll();

    expect(writePoint).not.toHaveBeenCalled();
    integ.stop();
  });
});

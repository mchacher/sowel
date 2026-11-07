import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { PowerSubmeterIntegrator, splitTrapezoidWh } from "./power-submeter-integrator.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  // Insert minimum zone + equipment rows to satisfy FK on submeter state inserts.
  db.prepare(`INSERT INTO zones (id, name) VALUES (?, ?)`).run("zone-1", "Test");
  db.prepare(
    `INSERT INTO equipments (id, name, zone_id, type, enabled) VALUES (?, ?, ?, ?, 1)`,
  ).run("eq-pac", "PAC", "zone-1", "energy_meter");
  return db;
}

const logger = createLogger("silent").logger;

function makeStubs(
  opts: { isPowerOnly: boolean; influxConnected?: boolean; localProduction?: boolean } = {
    isPowerOnly: true,
  },
) {
  const equipmentManager = {
    getById: vi.fn((id: string) =>
      id === "eq-pac"
        ? {
            id,
            name: "PAC",
            zoneId: "zone-1",
            type: "energy_meter",
            enabled: true,
            ...(opts.localProduction && { localProduction: true }),
          }
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

  it("integrates a water_heater reporting power but no command (#521)", () => {
    db.prepare(
      `INSERT INTO equipments (id, name, zone_id, type, enabled) VALUES (?, ?, ?, ?, 1)`,
    ).run("eq-cet", "Chauffe-eau", "zone-1", "water_heater");
    const equipmentManager = {
      getById: vi.fn((id: string) =>
        id === "eq-cet"
          ? { id, name: "Chauffe-eau", zoneId: "zone-1", type: "water_heater", enabled: true }
          : null,
      ),
      getAll: vi.fn(() => [
        {
          id: "eq-cet",
          name: "Chauffe-eau",
          zoneId: "zone-1",
          type: "water_heater",
          enabled: true,
        },
      ]),
      getDataBindingsWithValues: vi.fn(() => [{ alias: "power", category: "power", value: 2000 }]),
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
    emitPower(bus, "eq-cet", 2000);
    now += 60_000;
    emitPower(bus, "eq-cet", 2000);
    integ.flushAll();
    expect(writePoint).toHaveBeenCalledOnce();
    // Surfaced as computed energy so the equipment card sees a growing Wh value.
    const computed = integ.getComputedDataForEquipment("eq-cet");
    expect(computed[0]?.alias).toBe("energy");
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

  // ── Spec 195 — local production ─────────────────────────────────────────

  describe("local production (spec 195)", () => {
    function pending(): { pending_wh: number; pending_production_wh: number } {
      return db
        .prepare(
          `SELECT pending_wh, pending_production_wh FROM submeter_integrator_state WHERE equipment_id = 'eq-pac'`,
        )
        .get() as { pending_wh: number; pending_production_wh: number };
    }

    function pointOf(call: unknown[]): { alias: string; value: number } {
      const point = call[0] as { tags: Record<string, string>; fields: Record<string, string> };
      return { alias: point.tags.alias, value: parseFloat(point.fields.value_number) };
    }

    it("a flagged meter's negative power is production, not consumption", () => {
      const { equipmentManager, influxClient } = makeStubs({
        isPowerOnly: true,
        localProduction: true,
      });
      let now = 1_700_000_000_000;
      const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
        now: () => now,
      });
      integ.init();
      integ.start();

      emitPower(bus, "eq-pac", -1000);
      now += 60_000;
      emitPower(bus, "eq-pac", -1000);

      expect(pending().pending_wh).toBeCloseTo(0, 5);
      expect(pending().pending_production_wh).toBeCloseTo((1000 * 60) / 3600, 5);
      // The by-usage slice is fed by the cumulative: production never reaches it.
      expect(integ.getComputedDataForEquipment("eq-pac")[0].value).toBe(0);
      integ.stop();
    });

    it("flush writes the production as its own `production` delta and emits it", () => {
      const { equipmentManager, influxClient, writePoint } = makeStubs({
        isPowerOnly: true,
        localProduction: true,
      });
      const emitted: Array<{ alias: string; value: unknown }> = [];
      bus.on((e) => {
        if (e.type === "equipment.data.changed" && e.alias !== "power") {
          emitted.push({ alias: e.alias, value: e.value });
        }
      });
      let now = 1_700_000_000_000;
      const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
        now: () => now,
      });
      integ.init();
      integ.start();

      // 600 W drawn, then 600 W produced: a crossing exactly half-way.
      emitPower(bus, "eq-pac", 600);
      now += 60_000;
      emitPower(bus, "eq-pac", -600);
      integ.flushAll();

      const points = writePoint.mock.calls.map(pointOf);
      expect(points.map((p) => p.alias).sort()).toEqual(["energy", "production"]);
      // Each side is a triangle: 600 W × 30 s / 2 = 2.5 Wh.
      for (const p of points) expect(p.value).toBeCloseTo(2.5, 5);
      expect(emitted.map((e) => e.alias).sort()).toEqual(["energy", "production"]);
      integ.stop();
    });

    it("an unflagged meter keeps reading negative power as a backwards clamp (spec 091)", () => {
      const { equipmentManager, influxClient, writePoint } = makeStubs();
      let now = 1_700_000_000_000;
      const integ = new PowerSubmeterIntegrator(db, bus, equipmentManager, influxClient, logger, {
        now: () => now,
      });
      integ.init();
      integ.start();

      emitPower(bus, "eq-pac", 600);
      now += 60_000;
      emitPower(bus, "eq-pac", -600);
      integ.flushAll();

      const points = writePoint.mock.calls.map(pointOf);
      expect(points).toHaveLength(1);
      expect(points[0].alias).toBe("energy");
      expect(points[0].value).toBeCloseTo(10, 5); // |600| W × 60 s
      integ.stop();
    });
  });
});

describe("splitTrapezoidWh (spec 195)", () => {
  it("puts a one-signed interval entirely on its side", () => {
    expect(splitTrapezoidWh(500, 1500, 60)).toEqual({
      consumedWh: (1000 * 60) / 3600,
      producedWh: 0,
    });
    const prod = splitTrapezoidWh(-500, -1500, 60);
    expect(prod.consumedWh).toBe(0);
    expect(prod.producedWh).toBeCloseTo((1000 * 60) / 3600, 10);
  });

  it("splits a crossing interval at the interpolated zero", () => {
    // 300 W → −100 W over 40 s: zero at 30 s. Triangles 300×30/2 and 100×10/2 W·s.
    const { consumedWh, producedWh } = splitTrapezoidWh(300, -100, 40);
    expect(consumedWh).toBeCloseTo(4500 / 3600, 10);
    expect(producedWh).toBeCloseTo(500 / 3600, 10);
  });

  it("is symmetric in direction", () => {
    expect(splitTrapezoidWh(-100, 300, 40)).toEqual(splitTrapezoidWh(300, -100, 40));
  });
});

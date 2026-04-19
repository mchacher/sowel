import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EquipmentManager } from "./equipment-manager.js";
import { PoolRuntimeTracker } from "./pool-runtime-tracker.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
    "005_device_data_enum_values.sql",
    "006_pool_runtime_and_category_override.sql",
  ]) {
    db.exec(readFileSync(resolve(import.meta.dirname ?? ".", "../../migrations", file), "utf-8"));
  }
  return db;
}

const logger = createLogger("silent").logger;

function todayLocalString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("PoolRuntimeTracker", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let zoneManager: ZoneManager;
  let equipmentManager: EquipmentManager;
  let tracker: PoolRuntimeTracker;
  let deviceManager: DeviceManager;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    deviceManager = new DeviceManager(db, eventBus, logger);
    equipmentManager = new EquipmentManager(
      db,
      eventBus,
      { getById: () => null, dispatchOrder: async () => {} } as any,
      deviceManager,
      logger,
    );
  });

  afterEach(() => {
    tracker?.stop();
    db.close();
    vi.useRealTimers();
  });

  function createPump(): string {
    const zone = zoneManager.create({ name: "Piscine" });
    return equipmentManager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id }).id;
  }

  function startTracker(): void {
    tracker = new PoolRuntimeTracker(db, eventBus, equipmentManager, logger);
    tracker.start();
  }

  it("OFF → ON records stateSince but adds no time yet", () => {
    const eqId = createPump();
    startTracker();

    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: null,
    });
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "ON",
      previous: "OFF",
    });

    expect(tracker.getRuntime(eqId)).toBeGreaterThanOrEqual(0);
    expect(tracker.getRuntime(eqId)).toBeLessThan(2); // basically 0
  });

  it("ON → OFF after 60s accumulates ~60s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00"));
    const eqId = createPump();
    startTracker();

    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: null,
    });
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "ON",
      previous: "OFF",
    });

    vi.setSystemTime(new Date("2026-04-19T12:01:00")); // +60s
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: "ON",
    });

    expect(tracker.getRuntime(eqId)).toBe(60);
  });

  it("multiple ON/OFF cycles accumulate correctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T08:00:00"));
    const eqId = createPump();
    startTracker();

    // Initial OFF state
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: null,
    });

    // Cycle 1: ON for 30s
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "ON",
      previous: "OFF",
    });
    vi.setSystemTime(new Date("2026-04-19T08:00:30"));
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: "ON",
    });

    // Cycle 2: ON for 90s
    vi.setSystemTime(new Date("2026-04-19T08:01:00"));
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "ON",
      previous: "OFF",
    });
    vi.setSystemTime(new Date("2026-04-19T08:02:30"));
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: "ON",
    });

    expect(tracker.getRuntime(eqId)).toBe(120);
  });

  it("startup with stale last_reset_date resets cumulative", () => {
    const eqId = createPump();
    // Pre-seed a state with yesterday's date
    db.prepare(
      `INSERT INTO pool_runtime_state (equipment_id, current_state, state_since, cumulative_seconds_today, last_reset_date)
       VALUES (?, 'OFF', ?, 5000, '2025-01-01')`,
    ).run(eqId, new Date().toISOString());

    startTracker();
    expect(tracker.getRuntime(eqId)).toBe(0);

    const row = db
      .prepare(
        "SELECT cumulative_seconds_today, last_reset_date FROM pool_runtime_state WHERE equipment_id = ?",
      )
      .get(eqId) as { cumulative_seconds_today: number; last_reset_date: string };
    expect(row.cumulative_seconds_today).toBe(0);
    expect(row.last_reset_date).toBe(todayLocalString());
  });

  it("ignores events for non-pool_pump equipments", () => {
    const zone = zoneManager.create({ name: "Salon" });
    const eq = equipmentManager.create({
      name: "Switch",
      type: "switch",
      zoneId: zone.id,
    });
    startTracker();

    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eq.id,
      alias: "state",
      value: "ON",
      previous: "OFF",
    });

    expect(tracker.getRuntime(eq.id)).toBe(0);
  });

  it("equipment.removed deletes the runtime state row", () => {
    const eqId = createPump();
    startTracker();

    // Seed an ON event so a state row is created
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias: "state",
      value: "OFF",
      previous: null,
    });

    eventBus.emit({
      type: "equipment.removed",
      equipmentId: eqId,
      equipmentName: "Pompe",
      zoneId: null,
    });

    const row = db.prepare("SELECT * FROM pool_runtime_state WHERE equipment_id = ?").get(eqId);
    expect(row).toBeUndefined();
  });
});

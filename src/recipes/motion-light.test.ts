import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZoneManager } from "../zones/zone-manager.js";
import { ZoneAggregator } from "../zones/zone-aggregator.js";
import { EquipmentManager } from "../equipments/equipment-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { RecipeManager } from "./engine/recipe-manager.js";
import { MotionLightRecipe } from "./motion-light.js";
import type { EngineEvent } from "../shared/types.js";

// ============================================================
// Test helpers
// ============================================================

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migrations = ["001_devices.sql", "002_zones.sql", "003_equipments.sql", "005_recipes.sql"];
  for (const file of migrations) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../migrations", file),
      "utf-8",
    );
    db.exec(sql);
  }
  return db;
}

const logger = createLogger("silent");

function seedDevice(
  db: Database.Database,
  opts: {
    name?: string;
    dataKeys?: { id?: string; key: string; type?: string; category?: string; value?: string }[];
    orderKeys?: { id?: string; key: string; type?: string; payloadKey?: string }[];
  } = {},
) {
  const deviceId = crypto.randomUUID();
  const name = opts.name ?? "Test Device";
  db.prepare(
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status)
     VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online')`,
  ).run(deviceId, `z2m/${name}`, name, name);

  const dataIds: string[] = [];
  for (const d of opts.dataKeys ?? []) {
    const id = d.id ?? crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_data (id, device_id, key, type, category, value)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, deviceId, d.key, d.type ?? "boolean", d.category ?? "generic", d.value ?? null);
    dataIds.push(id);
  }

  const orderIds: string[] = [];
  for (const o of opts.orderKeys ?? []) {
    const id = o.id ?? crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_orders (id, device_id, key, type, mqtt_set_topic, payload_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, deviceId, o.key, o.type ?? "boolean", `z2m/${name}/set`, o.payloadKey ?? o.key);
    orderIds.push(id);
  }

  return { deviceId, dataIds, orderIds };
}

// ============================================================
// Setup helpers
// ============================================================

interface TestSetup {
  db: Database.Database;
  eventBus: EventBus;
  zoneManager: ZoneManager;
  equipmentManager: EquipmentManager;
  aggregator: ZoneAggregator;
  manager: RecipeManager;
  events: EngineEvent[];
  published: Array<{ topic: string; payload: string }>;
  zoneId: string;
  lightId: string;
  pirDataId: string;
  lightDataId: string;
}

function createTestSetup(): TestSetup {
  const db = createTestDb();
  const eventBus = new EventBus(logger);
  const published: Array<{ topic: string; payload: string }> = [];
  const mockMqtt = {
    publish: (topic: string, payload: string) => published.push({ topic, payload }),
    isConnected: () => true,
  };

  const zoneManager = new ZoneManager(db, eventBus, logger);
  const equipmentManager = new EquipmentManager(db, eventBus, mockMqtt as never, logger);
  const aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
  const manager = new RecipeManager(db, eventBus, equipmentManager, zoneManager, aggregator, logger);
  manager.register(MotionLightRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Salon" });

  // Create PIR sensor device + equipment
  const pirDevice = seedDevice(db, {
    name: "PIR Salon",
    dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
  });
  const pirEq = equipmentManager.create({ name: "PIR Salon", type: "motion_sensor", zoneId: zone.id });
  equipmentManager.addDataBinding(pirEq.id, pirDevice.dataIds[0], "occupancy");

  // Create light device + equipment with both data and order bindings
  const lightDevice = seedDevice(db, {
    name: "Spots Salon",
    dataKeys: [{ key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") }],
    orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
  });
  const lightEq = equipmentManager.create({ name: "Spots Salon", type: "light_onoff", zoneId: zone.id });
  equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
  equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");

  // Compute initial aggregation
  aggregator.computeAll();

  const events: EngineEvent[] = [];
  eventBus.on((event) => events.push(event));

  return {
    db,
    eventBus,
    zoneManager,
    equipmentManager,
    aggregator,
    manager,
    events,
    published,
    zoneId: zone.id,
    lightId: lightEq.id,
    pirDataId: pirDevice.dataIds[0],
    lightDataId: lightDevice.dataIds[0],
  };
}

function simulateMotion(setup: TestSetup, active: boolean): void {
  // Update DB
  setup.db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run(
    JSON.stringify(active),
    setup.pirDataId,
  );
  // Trigger reactive pipeline
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "pir-device",
    deviceName: "PIR Salon",
    dataId: setup.pirDataId,
    key: "occupancy",
    value: active,
    previous: !active,
    timestamp: new Date().toISOString(),
  });
}

function simulateLightState(setup: TestSetup, state: "ON" | "OFF"): void {
  setup.db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run(
    JSON.stringify(state),
    setup.lightDataId,
  );
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "light-device",
    deviceName: "Spots Salon",
    dataId: setup.lightDataId,
    key: "state",
    value: state,
    previous: state === "ON" ? "OFF" : "ON",
    timestamp: new Date().toISOString(),
  });
}

// ============================================================
// Tests
// ============================================================

describe("MotionLightRecipe", () => {
  let setup: TestSetup;

  beforeEach(() => {
    vi.useFakeTimers();
    setup = createTestSetup();
  });

  afterEach(() => {
    setup.manager.stopAll();
    setup.db.close();
    vi.useRealTimers();
  });

  // ============================================================
  // Validation
  // ============================================================

  it("validates required params", () => {
    expect(() => setup.manager.createInstance("motion-light", {})).toThrow("Invalid params");
  });

  it("validates zone exists", () => {
    expect(() =>
      setup.manager.createInstance("motion-light", { zone: "nonexistent", light: setup.lightId, timeout: "10m" }),
    ).toThrow("Invalid params");
  });

  it("validates light exists and has state order", () => {
    expect(() =>
      setup.manager.createInstance("motion-light", { zone: setup.zoneId, light: "nonexistent", timeout: "10m" }),
    ).toThrow("Invalid params");
  });

  // ============================================================
  // Motion → turn on
  // ============================================================

  it("turns light on when motion detected and light is off", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    setup.published.length = 0;

    // Simulate motion detected
    simulateMotion(setup, true);

    // Should have published ON command
    expect(setup.published.length).toBeGreaterThanOrEqual(1);
    const onCommand = setup.published.find((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommand).toBeDefined();
  });

  // ============================================================
  // Motion true + light already on → reset timer (no action)
  // ============================================================

  it("resets timer when motion detected and light is already on", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    // Light is already on
    simulateLightState(setup, "ON");
    setup.published.length = 0;

    // Simulate motion — should NOT turn on (already on)
    simulateMotion(setup, true);

    // No new ON command published
    const onCommand = setup.published.find((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommand).toBeUndefined();
  });

  // ============================================================
  // No motion + light on → start timer → turn off
  // ============================================================

  it("starts timer when no motion and light is on, turns off on expiry", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    // Light on + motion on
    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    setup.published.length = 0;

    // Motion stops
    simulateMotion(setup, false);

    // Timer not yet expired
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(setup.published.find((p) => JSON.parse(p.payload).state === "OFF")).toBeUndefined();

    // Timer expires
    vi.advanceTimersByTime(2 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeDefined();
  });

  // ============================================================
  // Motion re-detected before timer → timer cancelled
  // ============================================================

  it("cancels timer when motion re-detected before expiry", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    // Light on, motion on, then motion off (starts timer)
    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    simulateMotion(setup, false);

    // Advance 3 minutes
    vi.advanceTimersByTime(3 * 60 * 1000);
    setup.published.length = 0;

    // Motion re-detected
    simulateMotion(setup, true);

    // Wait full timeout — should NOT turn off because motion was re-detected
    vi.advanceTimersByTime(5 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeUndefined();
  });

  // ============================================================
  // Light turned on externally + no motion → start timer
  // ============================================================

  it("starts timer when light turned on externally without motion", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });
    setup.published.length = 0;

    // External turn on (no motion)
    simulateLightState(setup, "ON");

    // Timer should expire and turn off
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeDefined();
  });

  // ============================================================
  // Light turned off externally → timer cancelled
  // ============================================================

  it("cancels timer when light turned off externally", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    // Light on externally (starts timer)
    simulateLightState(setup, "ON");
    setup.published.length = 0;

    // Light turned off externally
    simulateLightState(setup, "OFF");

    // Timer should be cancelled — nothing happens after timeout
    vi.advanceTimersByTime(10 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeUndefined();
  });

  // ============================================================
  // Zone with no motion sensors → warning logged
  // ============================================================

  it("logs warning when zone has no motion sensors", () => {
    // Create a zone without PIR
    const emptyZone = setup.zoneManager.create({ name: "Empty Zone" });
    setup.aggregator.computeAll();

    // Create a light in the empty zone
    const lightDevice = seedDevice(setup.db, {
      name: "Light2",
      dataKeys: [{ key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") }],
      orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
    });
    const lightEq = setup.equipmentManager.create({ name: "Light2", type: "light_onoff", zoneId: emptyZone.id });
    setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");
    setup.aggregator.computeAll();

    const instance = setup.manager.createInstance("motion-light", {
      zone: emptyZone.id,
      light: lightEq.id,
      timeout: "5m",
    });

    // Check logs contain the warning
    const logs = setup.manager.getLog(instance.id);
    expect(logs.some((l) => l.level === "warn")).toBe(true);
  });

  // ============================================================
  // Light equipment missing → error
  // ============================================================

  it("throws error when light equipment has no state order", () => {
    // Create a light without order binding
    const lightDevice = seedDevice(setup.db, {
      name: "Light No Order",
      dataKeys: [{ key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") }],
    });
    const lightEq = setup.equipmentManager.create({ name: "Light No Order", type: "light_onoff", zoneId: setup.zoneId });
    setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");

    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        light: lightEq.id,
        timeout: "5m",
      }),
    ).toThrow("Invalid params");
  });

  // ============================================================
  // Stop cleans up
  // ============================================================

  it("stops recipe cleanly on delete", () => {
    const instance = setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });

    // Light on + motion → then motion off (timer started)
    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    simulateMotion(setup, false);

    setup.manager.deleteInstance(instance.id);
    setup.published.length = 0;

    // Advance past timeout — should NOT turn off (recipe stopped)
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(setup.published).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZoneManager } from "../zones/zone-manager.js";
import { ZoneAggregator } from "../zones/zone-aggregator.js";
import { EquipmentManager } from "../equipments/equipment-manager.js";
import { DeviceManager } from "../devices/device-manager.js";
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
  const migrations = [
    "001_devices.sql",
    "002_zones.sql",
    "003_equipments.sql",
    "005_recipes.sql",
    "007_settings.sql",
    "011_integration_architecture.sql",
  ];
  for (const file of migrations) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../migrations", file),
      "utf-8",
    );
    db.exec(sql);
  }
  return db;
}

const logger = createLogger("silent").logger;

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
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
     VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online', 'zigbee2mqtt', ?)`,
  ).run(deviceId, `z2m/${name}`, name, name, name);

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
      `INSERT INTO device_orders (id, device_id, key, type, mqtt_set_topic, payload_key, dispatch_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      deviceId,
      o.key,
      o.type ?? "boolean",
      `z2m/${name}/set`,
      o.payloadKey ?? o.key,
      JSON.stringify({ topic: `z2m/${name}/set`, payloadKey: o.payloadKey ?? o.key }),
    );
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
  const mockIntegrationRegistry = {
    getById: (id: string) => ({
      id,
      getStatus: () => "connected" as const,
      executeOrder: async (
        _device: any,
        dispatchConfig: Record<string, unknown>,
        value: unknown,
      ) => {
        const topic = dispatchConfig.topic as string;
        const payloadKey = dispatchConfig.payloadKey as string;
        published.push({ topic, payload: JSON.stringify({ [payloadKey]: value }) });
      },
    }),
  };

  const zoneManager = new ZoneManager(db, eventBus, logger);
  const deviceManager = new DeviceManager(db, eventBus, logger);
  const equipmentManager = new EquipmentManager(
    db,
    eventBus,
    mockIntegrationRegistry as any,
    deviceManager,
    logger,
  );
  const aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
  const manager = new RecipeManager(
    db,
    eventBus,
    equipmentManager,
    zoneManager,
    aggregator,
    logger,
  );
  manager.register(MotionLightRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Salon" });

  // Create PIR sensor device + equipment
  const pirDevice = seedDevice(db, {
    name: "PIR Salon",
    dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
  });
  const pirEq = equipmentManager.create({ name: "PIR Salon", type: "sensor", zoneId: zone.id });
  equipmentManager.addDataBinding(pirEq.id, pirDevice.dataIds[0], "occupancy");

  // Create light device + equipment with both data and order bindings
  const lightDevice = seedDevice(db, {
    name: "Spots Salon",
    dataKeys: [
      { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
    ],
    orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
  });
  const lightEq = equipmentManager.create({
    name: "Spots Salon",
    type: "light_onoff",
    zoneId: zone.id,
  });
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

function addSecondLight(setup: TestSetup): { lightId: string; lightDataId: string } {
  const lightDevice = seedDevice(setup.db, {
    name: "Lampe Salon",
    dataKeys: [
      { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
    ],
    orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
  });
  const lightEq = setup.equipmentManager.create({
    name: "Lampe Salon",
    type: "light_dimmable",
    zoneId: setup.zoneId,
  });
  setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
  setup.equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");
  setup.aggregator.computeAll();
  return { lightId: lightEq.id, lightDataId: lightDevice.dataIds[0] };
}

function addLuxSensor(setup: TestSetup, initialLux: number): string {
  const luxDevice = seedDevice(setup.db, {
    name: "Lux Sensor",
    dataKeys: [
      {
        key: "illuminance_lux",
        type: "number",
        category: "luminosity",
        value: JSON.stringify(initialLux),
      },
    ],
  });
  const luxEq = setup.equipmentManager.create({
    name: "Lux Sensor",
    type: "sensor",
    zoneId: setup.zoneId,
  });
  setup.equipmentManager.addDataBinding(luxEq.id, luxDevice.dataIds[0], "illuminance_lux");
  setup.aggregator.computeAll();
  return luxDevice.dataIds[0];
}

function simulateMotion(setup: TestSetup, active: boolean): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(active), setup.pirDataId);
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

function simulateLightState(setup: TestSetup, state: "ON" | "OFF", dataId?: string): void {
  const id = dataId ?? setup.lightDataId;
  setup.db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run(JSON.stringify(state), id);
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "light-device",
    deviceName: "Spots Salon",
    dataId: id,
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
      setup.manager.createInstance("motion-light", {
        zone: "nonexistent",
        lights: [setup.lightId],
        timeout: "10m",
      }),
    ).toThrow("Invalid params");
  });

  it("validates lights exist and have state order", () => {
    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: ["nonexistent"],
        timeout: "10m",
      }),
    ).toThrow("Invalid params");
  });

  it("validates lights belong to selected zone", () => {
    const otherZone = setup.zoneManager.create({ name: "Cuisine" });
    const lightDevice = seedDevice(setup.db, {
      name: "Light Cuisine",
      dataKeys: [
        { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      ],
      orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
    });
    const lightEq = setup.equipmentManager.create({
      name: "Light Cuisine",
      type: "light_onoff",
      zoneId: otherZone.id,
    });
    setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");

    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [lightEq.id],
        timeout: "10m",
      }),
    ).toThrow("Invalid params");
  });

  it("validates empty lights list", () => {
    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [],
        timeout: "10m",
      }),
    ).toThrow("Invalid params");
  });

  it("validates luxThreshold is non-negative", () => {
    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "10m",
        luxThreshold: -10,
      }),
    ).toThrow("Invalid params");
  });

  // ============================================================
  // Motion → turn on (single light)
  // ============================================================

  it("turns light on when motion detected and light is off", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    expect(setup.published.length).toBeGreaterThanOrEqual(1);
    const onCommand = setup.published.find((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommand).toBeDefined();
  });

  // ============================================================
  // Multi-light: motion turns on all lights
  // ============================================================

  it("turns on all lights when motion detected", () => {
    const second = addSecondLight(setup);
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId, second.lightId],
      timeout: "5m",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const onCommands = setup.published.filter((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommands).toHaveLength(2);
  });

  it("turns off all lights when timer expires", () => {
    const second = addSecondLight(setup);
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId, second.lightId],
      timeout: "5m",
    });

    // Light on + motion on
    simulateLightState(setup, "ON");
    simulateLightState(setup, "ON", second.lightDataId);
    simulateMotion(setup, true);
    simulateMotion(setup, false);
    setup.published.length = 0;

    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    const offCommands = setup.published.filter((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "OFF";
    });
    expect(offCommands).toHaveLength(2);
  });

  // ============================================================
  // Motion true + light already on → reset timer (no action)
  // ============================================================

  it("resets timer when motion detected and light is already on", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    setup.published.length = 0;

    simulateMotion(setup, true);

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
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    setup.published.length = 0;

    simulateMotion(setup, false);

    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(setup.published.find((p) => JSON.parse(p.payload).state === "OFF")).toBeUndefined();

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
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    simulateMotion(setup, false);

    vi.advanceTimersByTime(3 * 60 * 1000);
    setup.published.length = 0;

    simulateMotion(setup, true);

    vi.advanceTimersByTime(5 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeUndefined();
  });

  // ============================================================
  // Motion impulse resets timer
  // ============================================================

  it("resets off-timer on repeated motion impulses", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    simulateMotion(setup, false); // starts 5min timer

    // After 3 minutes, new motion impulse
    vi.advanceTimersByTime(3 * 60 * 1000);
    simulateMotion(setup, true); // cancels timer
    simulateMotion(setup, false); // restarts 5min timer

    // After 4 more minutes (7 total), not yet expired
    vi.advanceTimersByTime(4 * 60 * 1000);
    setup.published.length = 0;
    expect(setup.published.find((p) => JSON.parse(p.payload).state === "OFF")).toBeUndefined();

    // After 2 more minutes (5 from last motion stop), timer expires
    vi.advanceTimersByTime(2 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeDefined();
  });

  // ============================================================
  // Light turned on externally + no motion → start timer
  // ============================================================

  it("starts timer when light turned on externally without motion", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });
    setup.published.length = 0;

    simulateLightState(setup, "ON");

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
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    setup.published.length = 0;

    simulateLightState(setup, "OFF");

    vi.advanceTimersByTime(10 * 60 * 1000);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeUndefined();
  });

  // ============================================================
  // Lux threshold
  // ============================================================

  it("does not turn on when zone luminosity is above lux threshold", () => {
    addLuxSensor(setup, 200);
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      luxThreshold: 50,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeUndefined();
  });

  it("turns on when zone luminosity is below lux threshold", () => {
    addLuxSensor(setup, 30);
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      luxThreshold: 50,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeDefined();
  });

  it("ignores lux threshold when no luminosity sensor exists", () => {
    // No lux sensor added — zone luminosity is null
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      luxThreshold: 50,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeDefined();
  });

  it("turns on when lux equals threshold", () => {
    addLuxSensor(setup, 50);
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      luxThreshold: 50,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    // luminosity === threshold → NOT too bright (> not >=)
    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeDefined();
  });

  // ============================================================
  // Failsafe max-on duration
  // ============================================================

  it("forces lights off after maxOnDuration", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      maxOnDuration: "1h",
    });
    setup.published.length = 0;

    // Motion keeps going (sensor stuck)
    simulateMotion(setup, true);

    // After 1 hour, failsafe kicks in
    vi.advanceTimersByTime(60 * 60 * 1000 + 100);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeDefined();
  });

  it("cancels failsafe timer when light turned off manually", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      maxOnDuration: "1h",
    });

    simulateMotion(setup, true);
    // Light is now on, failsafe timer started
    simulateLightState(setup, "ON");
    setup.published.length = 0;

    // Turn off manually
    simulateLightState(setup, "OFF");
    setup.published.length = 0;

    // After 1 hour, nothing should happen (failsafe was cancelled)
    vi.advanceTimersByTime(60 * 60 * 1000 + 100);
    const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
    expect(offCommand).toBeUndefined();
  });

  it("failsafe logs a warning", () => {
    const instance = setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      maxOnDuration: "1h",
    });

    simulateMotion(setup, true);
    vi.advanceTimersByTime(60 * 60 * 1000 + 100);

    const logs = setup.manager.getLog(instance.id);
    expect(logs.some((l) => l.level === "warn" && l.message.includes("Failsafe"))).toBe(true);
  });

  // ============================================================
  // Backward compatibility: single "light" param
  // ============================================================

  it("supports legacy single light param", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      light: setup.lightId,
      timeout: "5m",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeDefined();
  });

  // ============================================================
  // Zone with no motion sensors → warning logged
  // ============================================================

  it("logs warning when zone has no motion sensors", () => {
    const emptyZone = setup.zoneManager.create({ name: "Empty Zone" });
    setup.aggregator.computeAll();

    const lightDevice = seedDevice(setup.db, {
      name: "Light2",
      dataKeys: [
        { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      ],
      orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
    });
    const lightEq = setup.equipmentManager.create({
      name: "Light2",
      type: "light_onoff",
      zoneId: emptyZone.id,
    });
    setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");
    setup.aggregator.computeAll();

    const instance = setup.manager.createInstance("motion-light", {
      zone: emptyZone.id,
      lights: [lightEq.id],
      timeout: "5m",
    });

    const logs = setup.manager.getLog(instance.id);
    expect(logs.some((l) => l.level === "warn")).toBe(true);
  });

  // ============================================================
  // Light equipment missing state order → error
  // ============================================================

  it("throws error when light equipment has no state order", () => {
    const lightDevice = seedDevice(setup.db, {
      name: "Light No Order",
      dataKeys: [
        { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      ],
    });
    const lightEq = setup.equipmentManager.create({
      name: "Light No Order",
      type: "light_onoff",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");

    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [lightEq.id],
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
      lights: [setup.lightId],
      timeout: "5m",
    });

    simulateLightState(setup, "ON");
    simulateMotion(setup, true);
    simulateMotion(setup, false);

    setup.manager.deleteInstance(instance.id);
    setup.published.length = 0;

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(setup.published).toHaveLength(0);
  });
});

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
    "020_history.sql",
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
    type: "light_onoff",
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

function addButton(setup: TestSetup): { buttonId: string; actionDataId: string } {
  const buttonDevice = seedDevice(setup.db, {
    name: "Button Salon",
    dataKeys: [{ key: "action", type: "enum", category: "action", value: JSON.stringify("") }],
  });
  const buttonEq = setup.equipmentManager.create({
    name: "Button Salon",
    type: "button",
    zoneId: setup.zoneId,
  });
  setup.equipmentManager.addDataBinding(buttonEq.id, buttonDevice.dataIds[0], "action");
  setup.aggregator.computeAll();
  return { buttonId: buttonEq.id, actionDataId: buttonDevice.dataIds[0] };
}

function simulateButtonPress(setup: TestSetup, buttonId: string): void {
  setup.eventBus.emit({
    type: "equipment.data.changed",
    equipmentId: buttonId,
    alias: "action",
    value: "single",
    previous: "",
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

function simulateLuxChange(setup: TestSetup, luxDataId: string, value: number): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(value), luxDataId);
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "lux-device",
    deviceName: "Lux Sensor",
    dataId: luxDataId,
    key: "illuminance_lux",
    value,
    previous: 0,
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

  it("rejects dimmable light in simple motion-light recipe", () => {
    // Create a dimmable light in the zone
    const dimmableDevice = seedDevice(setup.db, {
      name: "Dimmer Entrée",
      dataKeys: [
        { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      ],
      orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
    });
    const dimmableEq = setup.equipmentManager.create({
      name: "Dimmer Entrée",
      type: "light_dimmable",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(dimmableEq.id, dimmableDevice.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(dimmableEq.id, dimmableDevice.orderIds[0], "state");

    expect(() =>
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [dimmableEq.id],
        timeout: "10m",
      }),
    ).toThrow("requires light_onoff");
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
  // Startup: evaluate current zone state
  // ============================================================

  it("turns lights on immediately if motion already present when recipe starts", () => {
    // Set motion BEFORE creating the recipe
    simulateMotion(setup, true);
    setup.published.length = 0;

    // Create instance — start() should evaluate current zone state
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    const onCommand = setup.published.find((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommand).toBeDefined();
  });

  it("does not turn lights on at startup if no motion present", () => {
    // No motion — default state
    setup.published.length = 0;

    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    const onCommand = setup.published.find((p) => {
      const payload = JSON.parse(p.payload);
      return payload.state === "ON";
    });
    expect(onCommand).toBeUndefined();
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

  it("enters override when manually turned off while motion active", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    // Motion detected → lights turn on
    simulateMotion(setup, true);
    simulateLightState(setup, "ON");

    // User manually turns off light while there is still motion
    setup.published.length = 0;
    simulateLightState(setup, "OFF");

    // Verify override mode is entered
    const instance = setup.manager.getInstances().find((i) => i.recipeId === "motion-light")!;
    const logs = setup.manager.getLog(instance.id);
    expect(
      logs.some((l) => l.message.includes("turned off manually") && l.message.includes("override")),
    ).toBe(true);

    // Motion continues — lights should NOT be turned on again
    setup.published.length = 0;
    simulateMotion(setup, true);
    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeUndefined();
  });

  it("does not enter override when recipe itself turns off lights", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
    });

    // Motion on → lights on
    simulateMotion(setup, true);
    simulateLightState(setup, "ON");

    // Motion stops → off-timer starts
    simulateMotion(setup, false);

    // Wait for timeout → recipe turns off lights
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);

    // Simulate MQTT echo: light reports OFF
    simulateLightState(setup, "OFF");

    // Verify no override mode
    const instance = setup.manager.getInstances().find((i) => i.recipeId === "motion-light")!;
    const logs = setup.manager.getLog(instance.id);
    expect(
      logs.some((l) => l.message.includes("turned off manually") && l.message.includes("override")),
    ).toBe(false);

    // New motion should turn lights on (no override blocking)
    setup.published.length = 0;
    simulateMotion(setup, true);
    const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
    expect(onCommand).toBeDefined();
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
  // Dynamic lux monitoring (turn off when too bright)
  // ============================================================

  describe("Dynamic lux monitoring", () => {
    it("turns off lights when luminosity rises above threshold + hysteresis", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
      });

      // Motion → lights on (lux 30 < 50)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Sunrise: lux rises to 60 (> 50 × 1.10 = 55)
      simulateLuxChange(setup, luxDataId, 60);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeDefined();
    });

    it("does NOT turn off when lux is in hysteresis zone (between threshold and threshold + 10%)", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
      });

      // Motion → lights on
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Lux rises to 53 (> 50 but < 55) — in hysteresis zone
      simulateLuxChange(setup, luxDataId, 53);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeUndefined();
    });

    it("turns off lights due to lux even when motion is active", () => {
      const luxDataId = addLuxSensor(setup, 20);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 100,
      });

      // Motion → lights on
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Sun comes up: lux rises to 120 (> 100 × 1.10 = 110) while someone is in the room
      simulateLuxChange(setup, luxDataId, 120);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeDefined();
    });

    it("does not turn off when lux is high but no luxThreshold configured", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        // no luxThreshold
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      simulateLuxChange(setup, luxDataId, 500);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeUndefined();
    });

    it("lux-based turn off is ignored in override mode", () => {
      const luxDataId = addLuxSensor(setup, 30);
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
        buttons: [button.buttonId],
      });

      // Turn on, enter override (user changes dimmer via button-off)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateButtonPress(setup, button.buttonId);
      // Button-off turns lights off + enters override

      // Button-on to turn lights back on in override (turns on but override was set on button-off)
      simulateLightState(setup, "OFF");
      // Override is active, motion is ignored

      // Manually turn lights on (simulate external)
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Lux rises above threshold — should be ignored because override mode
      simulateLuxChange(setup, luxDataId, 60);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeUndefined();
    });

    it("after lux-based turn off, lights re-turn on when lux drops and motion detected", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
      });

      // Motion → lights on
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Lux rises → lights off
      simulateLuxChange(setup, luxDataId, 60);
      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      // Lux drops below threshold
      simulateLuxChange(setup, luxDataId, 40);

      // Next motion event → should turn on again (lux 40 < 50)
      simulateMotion(setup, true);
      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeDefined();
    });

    it("turns off immediately without waiting for off-timer when lux rises", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
      });

      // Motion on → lights on → motion off (off-timer started)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateMotion(setup, false);
      setup.published.length = 0;

      // While off-timer is counting, lux rises above threshold
      vi.advanceTimersByTime(1 * 60 * 1000); // only 1 min of 5 elapsed
      simulateLuxChange(setup, luxDataId, 60);

      // Should turn off immediately, not wait for remaining 4 min
      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeDefined();
    });

    it("does not enter override when recipe turns off lights due to lux rising", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        luxThreshold: 50,
      });

      // Motion → lights on (lux 30 < 50)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Lux rises above threshold+hysteresis → recipe turns off lights
      simulateLuxChange(setup, luxDataId, 60);

      // Advance past grace period to simulate delayed MQTT echo
      vi.advanceTimersByTime(6000);

      // MQTT echo: light reports OFF
      simulateLightState(setup, "OFF");

      // Verify NO override mode was entered
      const instance = setup.manager.getInstances().find((i) => i.recipeId === "motion-light")!;
      const logs = setup.manager.getLog(instance.id);
      expect(
        logs.some(
          (l) => l.message.includes("turned off manually") && l.message.includes("override"),
        ),
      ).toBe(false);

      // Lux drops — motion still active → recipe should auto-turn on (no override blocking)
      setup.published.length = 0;
      simulateLuxChange(setup, luxDataId, 20);
      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeDefined();
    });
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

  it("resets failsafe timer on continued motion", () => {
    setup.manager.createInstance("motion-light", {
      zone: setup.zoneId,
      lights: [setup.lightId],
      timeout: "5m",
      maxOnDuration: "1h",
    });

    // Initial motion → lights on, failsafe started (1h)
    simulateMotion(setup, true);
    simulateLightState(setup, "ON");
    setup.published.length = 0;

    // After 50 min, new motion detection (sensor cycles false → true)
    vi.advanceTimersByTime(50 * 60 * 1000);
    simulateMotion(setup, false);
    simulateMotion(setup, true);

    // At 1h10 from start (but only 20 min since last motion) — no failsafe yet
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(setup.published.find((p) => JSON.parse(p.payload).state === "OFF")).toBeUndefined();

    // At 1h50 from start (1h since last motion) — failsafe fires
    vi.advanceTimersByTime(40 * 60 * 1000);
    expect(setup.published.find((p) => JSON.parse(p.payload).state === "OFF")).toBeDefined();
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

  // ============================================================
  // Button support
  // ============================================================

  describe("Button support", () => {
    it("button press toggles lights off when on", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      simulateButtonPress(setup, button.buttonId);

      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeDefined();
    });

    it("button press turns lights on when off", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });
      setup.published.length = 0;

      simulateButtonPress(setup, button.buttonId);

      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeDefined();
    });

    it("works without buttons configured (backward compat)", () => {
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
      });
      setup.published.length = 0;

      simulateMotion(setup, true);
      expect(setup.published.find((p) => JSON.parse(p.payload).state === "ON")).toBeDefined();
    });

    it("validates button equipment has action data binding", () => {
      // Create button without action binding
      const noActionDevice = seedDevice(setup.db, {
        name: "Bad Button",
        dataKeys: [{ key: "state", type: "boolean", category: "generic", value: "false" }],
      });
      const noActionEq = setup.equipmentManager.create({
        name: "Bad Button",
        type: "button",
        zoneId: setup.zoneId,
      });
      setup.equipmentManager.addDataBinding(noActionEq.id, noActionDevice.dataIds[0], "state");

      expect(() =>
        setup.manager.createInstance("motion-light", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          timeout: "5m",
          buttons: [noActionEq.id],
        }),
      ).toThrow("Invalid params");
    });
  });

  // ============================================================
  // Manual override
  // ============================================================

  describe("Manual override", () => {
    it("motion does not turn on lights during override", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      // Turn on via motion, then button off (enter override)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateButtonPress(setup, button.buttonId);
      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      // New motion should NOT turn on lights (override active)
      simulateMotion(setup, true);

      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeUndefined();
    });

    it("no-motion timeout clears override", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      // Enter override via button
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateButtonPress(setup, button.buttonId);
      simulateLightState(setup, "OFF");

      // No motion
      simulateMotion(setup, false);
      setup.published.length = 0;

      // Wait for timeout
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      // Override should be cleared — next motion should work
      simulateMotion(setup, true);

      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeDefined();
    });

    it("button press when lights ON enters override", () => {
      const button = addButton(setup);
      const instance = setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateButtonPress(setup, button.buttonId);

      const logs = setup.manager.getLog(instance.id);
      expect(logs.some((l) => l.message.includes("override"))).toBe(true);
    });

    it("button press when lights OFF does NOT enter override", () => {
      const button = addButton(setup);
      const instance = setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      // Lights are off, press button to turn on
      simulateButtonPress(setup, button.buttonId);

      const logs = setup.manager.getLog(instance.id);
      expect(logs.some((l) => l.message.includes("override mode"))).toBe(false);
    });

    it("motion resets override clear timer", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        buttons: [button.buttonId],
      });

      // Enter override
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");
      simulateButtonPress(setup, button.buttonId);
      simulateLightState(setup, "OFF");

      // No motion starts timer
      simulateMotion(setup, false);
      vi.advanceTimersByTime(3 * 60 * 1000);

      // Motion detected again — timer should be cancelled
      simulateMotion(setup, true);

      // Wait past original timeout
      vi.advanceTimersByTime(3 * 60 * 1000);
      setup.published.length = 0;

      // Motion goes away again
      simulateMotion(setup, false);

      // Still in override (timer was reset by motion)
      simulateMotion(setup, true);
      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeUndefined();
    });
  });

  // ============================================================
  // Daylight tests
  // ============================================================

  describe("Daylight", () => {
    it("does not turn on when disableWhenDaylight=true and isDaylight=true", () => {
      setup.zoneManager.ensureRootZone();

      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: true }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        disableWhenDaylight: true,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeUndefined();
    });

    it("turns on normally when disableWhenDaylight=true but isDaylight=false", () => {
      setup.zoneManager.ensureRootZone();

      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: false }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        disableWhenDaylight: true,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeDefined();
    });

    it("turns on normally when disableWhenDaylight=false even if isDaylight=true", () => {
      setup.zoneManager.ensureRootZone();

      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: true }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        disableWhenDaylight: false,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeDefined();
    });

    it("lights stay on during daylight transition but do not turn on again", () => {
      setup.zoneManager.ensureRootZone();

      // Start at nighttime
      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: false }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        disableWhenDaylight: true,
      });

      // Motion -> lights on at night
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Transition to daylight — lights should NOT be forced off
      mockSunlight.getSunlightData = () => ({
        sunrise: "07:00",
        sunset: "19:00",
        isDaylight: true,
      });
      setup.aggregator.computeAll();
      setup.published.length = 0;

      // Continued motion — no OFF command should be sent
      simulateMotion(setup, true);
      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeUndefined();

      // Motion stops and lights go off normally
      simulateMotion(setup, false);
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      // New motion during daylight — should NOT turn on
      simulateMotion(setup, true);
      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeUndefined();
    });
  });
});

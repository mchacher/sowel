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
import { MotionLightDimmableRecipe } from "./motion-light-dimmable.js";

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
  brightnessDataId: string;
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
  manager.register(MotionLightDimmableRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Salon" });

  // Create PIR sensor device + equipment
  const pirDevice = seedDevice(db, {
    name: "PIR Salon",
    dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
  });
  const pirEq = equipmentManager.create({ name: "PIR Salon", type: "sensor", zoneId: zone.id });
  equipmentManager.addDataBinding(pirEq.id, pirDevice.dataIds[0], "occupancy");

  // Create dimmable light device + equipment with state data, brightness data, state order, and brightness order
  const lightDevice = seedDevice(db, {
    name: "Spots Salon",
    dataKeys: [
      { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      {
        key: "brightness",
        type: "number",
        category: "light_brightness",
        value: JSON.stringify(0),
      },
    ],
    orderKeys: [
      { key: "state", type: "boolean", payloadKey: "state" },
      { key: "brightness", type: "number", payloadKey: "brightness" },
    ],
  });
  const lightEq = equipmentManager.create({
    name: "Spots Salon",
    type: "light_dimmable",
    zoneId: zone.id,
  });
  equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[0], "state");
  equipmentManager.addDataBinding(lightEq.id, lightDevice.dataIds[1], "brightness");
  equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[0], "state");
  equipmentManager.addOrderBinding(lightEq.id, lightDevice.orderIds[1], "brightness");

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
    brightnessDataId: lightDevice.dataIds[1],
  };
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

function simulateBrightnessChange(
  setup: TestSetup,
  lightId: string,
  brightnessDataId: string,
  value: number,
): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(value), brightnessDataId);
  setup.eventBus.emit({
    type: "equipment.data.changed",
    equipmentId: lightId,
    alias: "brightness",
    value,
    previous: 0,
  });
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

// ============================================================
// Tests
// ============================================================

describe("MotionLightDimmableRecipe", () => {
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
  // 1. Basic motion behavior (verify base class works through dimmable)
  // ============================================================

  it("rejects light_onoff equipment in dimmable recipe", () => {
    // Create a light_onoff equipment
    const onoffDevice = seedDevice(setup.db, {
      name: "Spots Entrée",
      dataKeys: [
        { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
      ],
      orderKeys: [{ key: "state", type: "boolean", payloadKey: "state" }],
    });
    const onoffEq = setup.equipmentManager.create({
      name: "Spots Entrée",
      type: "light_onoff",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(onoffEq.id, onoffDevice.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(onoffEq.id, onoffDevice.orderIds[0], "state");

    expect(() =>
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [onoffEq.id],
        timeout: "5m",
        brightness: 150,
      }),
    ).toThrow("requires light_dimmable or light_color");
  });

  describe("Basic motion behavior", () => {
    it("turns light on when motion detected", () => {
      setup.manager.createInstance("motion-light-dimmable", {
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

    it("turns off after timeout with no motion", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
      });

      simulateLightState(setup, "ON");
      simulateMotion(setup, true);
      simulateMotion(setup, false);
      setup.published.length = 0;

      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      const offCommand = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCommand).toBeDefined();
    });

    it("does not turn on at startup without motion", () => {
      setup.published.length = 0;

      setup.manager.createInstance("motion-light-dimmable", {
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
  });

  // ============================================================
  // 2. Brightness presets
  // ============================================================

  describe("Brightness presets", () => {
    it("turns on at configured brightness", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 200;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("uses slot1 brightness during slot 1 window", () => {
      vi.setSystemTime(new Date("2026-02-27T07:30:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "06:00",
        slot1End: "09:00",
        slot1Brightness: 50,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 50;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("uses slot2 brightness during slot 2 window", () => {
      vi.setSystemTime(new Date("2026-02-27T22:15:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "06:00",
        slot1End: "09:00",
        slot1Brightness: 80,
        slot2Start: "22:00",
        slot2End: "23:30",
        slot2Brightness: 50,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 50;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("uses default brightness outside all slots", () => {
      vi.setSystemTime(new Date("2026-02-27T12:00:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "06:00",
        slot1End: "09:00",
        slot1Brightness: 50,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 200;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("handles wraparound slot (23:30-06:00)", () => {
      vi.setSystemTime(new Date("2026-02-27T02:00:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "23:30",
        slot1End: "06:00",
        slot1Brightness: 20,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 20;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("first matching slot wins on overlap", () => {
      vi.setSystemTime(new Date("2026-02-27T07:30:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "06:00",
        slot1End: "09:00",
        slot1Brightness: 50,
        slot2Start: "07:00",
        slot2End: "10:00",
        slot2Brightness: 100,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      // Slot 1 should win (first match)
      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 50;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("accepts partial slots (only slot 2 filled)", () => {
      vi.setSystemTime(new Date("2026-02-27T22:15:00"));

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot2Start: "22:00",
        slot2End: "23:30",
        slot2Brightness: 50,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const brightnessCmd = setup.published.find((p) => {
        const payload = JSON.parse(p.payload);
        return payload.brightness === 50;
      });
      expect(brightnessCmd).toBeDefined();
    });

    it("falls back to ON/OFF when no brightness configured", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      expect(setup.published.find((p) => JSON.parse(p.payload).state === "ON")).toBeDefined();
      expect(
        setup.published.find((p) => JSON.parse(p.payload).brightness !== undefined),
      ).toBeUndefined();
    });

    it("validates brightness range", () => {
      expect(() =>
        setup.manager.createInstance("motion-light-dimmable", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          timeout: "5m",
          brightness: 300,
        }),
      ).toThrow("Invalid params");
    });

    it("validates slot fields must be all-or-nothing", () => {
      expect(() =>
        setup.manager.createInstance("motion-light-dimmable", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          timeout: "5m",
          brightness: 200,
          slot1Start: "06:00",
        }),
      ).toThrow("Invalid params");
    });

    it("validates slot brightness range", () => {
      expect(() =>
        setup.manager.createInstance("motion-light-dimmable", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          timeout: "5m",
          brightness: 200,
          slot1Start: "06:00",
          slot1End: "09:00",
          slot1Brightness: 300,
        }),
      ).toThrow("Invalid params");
    });

    it("validates slot time format", () => {
      expect(() =>
        setup.manager.createInstance("motion-light-dimmable", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          timeout: "5m",
          brightness: 200,
          slot1Start: "6:00",
          slot1End: "09:00",
          slot1Brightness: 50,
        }),
      ).toThrow("Invalid params");
    });
  });

  // ============================================================
  // 3. Manual override (brightness-based)
  // ============================================================

  describe("Manual override (brightness-based)", () => {
    it("enters override on manual brightness change", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Wait past grace period
      vi.advanceTimersByTime(6000);

      // External brightness change (80 !== 150 configured -> override)
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 80);

      // Verify override log
      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(
        logs.some(
          (l) => l.message.includes("Manual brightness change") && l.message.includes("override"),
        ),
      ).toBe(true);
    });

    it("ignores self-triggered brightness changes", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      // Motion turns on lights (sets lastSentBrightness = 150)
      simulateMotion(setup, true);

      // MQTT echo with same value (150 = 150) — should NOT trigger override
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 150);

      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(logs.some((l) => l.message.includes("override"))).toBe(false);
    });

    it("ignores brightness echo during grace period after turn-on", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      // Motion turns on lights (sends brightness=150, starts 5s grace period)
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Device echoes its PREVIOUS brightness (200) before applying new value
      // This happens within the 5s grace window — should NOT trigger override
      vi.advanceTimersByTime(500);
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 200);

      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(logs.some((l) => l.message.includes("override"))).toBe(false);
    });

    it("detects manual brightness change after grace period", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Wait past the 5s grace period
      vi.advanceTimersByTime(6000);

      // NOW a brightness change should be detected as manual override
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 80);

      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(
        logs.some(
          (l) => l.message.includes("Manual brightness change") && l.message.includes("override"),
        ),
      ).toBe(true);
    });

    it("enters override when manually turned off while motion active", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      // Motion detected → lights turn on
      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // User manually turns off light while there is still motion
      setup.published.length = 0;
      simulateLightState(setup, "OFF");

      // Verify override mode is entered
      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(
        logs.some(
          (l) => l.message.includes("turned off manually") && l.message.includes("override"),
        ),
      ).toBe(true);

      // Motion continues — lights should NOT be turned on again
      setup.published.length = 0;
      simulateMotion(setup, true);
      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeUndefined();
    });

    it("does not enter override when recipe itself turns off lights", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
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
      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
      const logs = setup.manager.getLog(instance.id);
      expect(
        logs.some(
          (l) => l.message.includes("turned off manually") && l.message.includes("override"),
        ),
      ).toBe(false);

      // New motion should turn lights on (no override blocking)
      setup.published.length = 0;
      simulateMotion(setup, true);
      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeDefined();
    });

    it("does not enter override when recipe turns off lights due to lux rising", () => {
      const luxDataId = addLuxSensor(setup, 30);
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
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
      const instance = setup.manager
        .getInstances()
        .find((i) => i.recipeId === "motion-light-dimmable")!;
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

    it("override is cleared after timeout even with lights still on", () => {
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
      });

      simulateMotion(setup, true);
      simulateLightState(setup, "ON");

      // Wait past self-triggered, then change brightness manually
      vi.advanceTimersByTime(6000);
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 80);

      // No motion -> override clear timer starts
      simulateMotion(setup, false);
      setup.published.length = 0;

      // Wait for timeout
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      // Lights should be turned off (override cleared)
      const offCmd = setup.published.find((p) => JSON.parse(p.payload).state === "OFF");
      expect(offCmd).toBeDefined();

      // Simulate MQTT round-trip: light reports OFF
      simulateLightState(setup, "OFF");

      // Next motion should work
      setup.published.length = 0;
      simulateMotion(setup, true);
      const onCmd = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCmd).toBeDefined();
    });
  });

  // ============================================================
  // 4. Integration: combined features
  // ============================================================

  describe("Integration: combined features", () => {
    it("button on sets auto brightness", () => {
      const button = addButton(setup);
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 180,
        buttons: [button.buttonId],
      });
      setup.published.length = 0;

      simulateButtonPress(setup, button.buttonId);

      const brightnessCmd = setup.published.find((p) => JSON.parse(p.payload).brightness === 180);
      expect(brightnessCmd).toBeDefined();
    });

    it("full cycle: motion on -> override via brightness -> vacancy -> auto again", () => {
      vi.setSystemTime(new Date("2026-02-27T12:00:00"));
      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 200,
        slot1Start: "06:00",
        slot1End: "09:00",
        slot1Brightness: 50,
      });

      // 1. Motion -> lights on at normal brightness (noon)
      setup.published.length = 0;
      simulateMotion(setup, true);
      expect(setup.published.find((p) => JSON.parse(p.payload).brightness === 200)).toBeDefined();
      simulateLightState(setup, "ON");

      // 2. User dims to 80 -> override
      vi.advanceTimersByTime(6000);
      simulateBrightnessChange(setup, setup.lightId, setup.brightnessDataId, 80);

      // 3. No motion -> timer starts
      simulateMotion(setup, false);

      // 4. Timeout -> lights off + override cleared
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);
      simulateLightState(setup, "OFF");

      // 5. Next motion -> back to auto brightness
      setup.published.length = 0;
      simulateMotion(setup, true);
      expect(setup.published.find((p) => JSON.parse(p.payload).brightness === 200)).toBeDefined();
    });
  });

  // ============================================================
  // 5. Daylight tests
  // ============================================================

  describe("Daylight", () => {
    it("does not turn on when disableWhenDaylight=true and isDaylight=true", () => {
      // Ensure root zone exists for sunlight injection
      setup.zoneManager.ensureRootZone();

      // Mock SunlightManager with isDaylight=true
      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: true }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
        disableWhenDaylight: true,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeUndefined();
    });

    it("turns on normally when disableWhenDaylight=true but isDaylight=false", () => {
      // Ensure root zone exists for sunlight injection
      setup.zoneManager.ensureRootZone();

      // Mock SunlightManager with isDaylight=false
      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: false }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
        disableWhenDaylight: true,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeDefined();
    });

    it("turns on normally when disableWhenDaylight=false even if isDaylight=true", () => {
      // Ensure root zone exists for sunlight injection
      setup.zoneManager.ensureRootZone();

      // Mock SunlightManager with isDaylight=true
      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: true }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
        disableWhenDaylight: false,
      });
      setup.published.length = 0;

      simulateMotion(setup, true);

      const onCommand = setup.published.find((p) => JSON.parse(p.payload).state === "ON");
      expect(onCommand).toBeDefined();
    });

    it("lights stay on during daylight transition but do not turn on again", () => {
      // Ensure root zone exists for sunlight injection
      setup.zoneManager.ensureRootZone();

      // Start at nighttime
      const mockSunlight = {
        getSunlightData: () => ({ sunrise: "07:00", sunset: "19:00", isDaylight: false }),
        start: () => {},
        stop: () => {},
      };
      setup.aggregator.setSunlightManager(mockSunlight as any);
      setup.aggregator.computeAll();

      setup.manager.createInstance("motion-light-dimmable", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        timeout: "5m",
        brightness: 150,
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

      // Continued motion — no OFF command should be sent (lights stay on)
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

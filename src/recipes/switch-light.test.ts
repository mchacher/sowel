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
import { SwitchLightRecipe } from "./switch-light.js";
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
// Setup
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
  buttonId: string;
  lightDataId: string;
  buttonDataId: string;
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
  manager.register(SwitchLightRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Salon" });

  // Create button device + equipment
  const buttonDevice = seedDevice(db, {
    name: "Button Salon",
    dataKeys: [{ key: "action", type: "enum", category: "action", value: null }],
  });
  const buttonEq = equipmentManager.create({
    name: "Button Salon",
    type: "button",
    zoneId: zone.id,
  });
  equipmentManager.addDataBinding(buttonEq.id, buttonDevice.dataIds[0], "action");

  // Create light device + equipment
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
    buttonId: buttonEq.id,
    lightDataId: lightDevice.dataIds[0],
    buttonDataId: buttonDevice.dataIds[0],
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

function addSecondButton(setup: TestSetup): { buttonId: string; buttonDataId: string } {
  const buttonDevice = seedDevice(setup.db, {
    name: "Button 2",
    dataKeys: [{ key: "action", type: "enum", category: "action", value: null }],
  });
  const buttonEq = setup.equipmentManager.create({
    name: "Button 2",
    type: "button",
    zoneId: setup.zoneId,
  });
  setup.equipmentManager.addDataBinding(buttonEq.id, buttonDevice.dataIds[0], "action");
  return { buttonId: buttonEq.id, buttonDataId: buttonDevice.dataIds[0] };
}

function simulateButtonPress(setup: TestSetup, actionValue: string, dataId?: string): void {
  const id = dataId ?? setup.buttonDataId;
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(actionValue), id);
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "button-device",
    deviceName: "Button Salon",
    dataId: id,
    key: "action",
    value: actionValue,
    previous: null,
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

describe("SwitchLightRecipe", () => {
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

  describe("validation", () => {
    it("rejects missing zone", () => {
      expect(() =>
        setup.manager.createInstance("switch-light", {
          lights: [setup.lightId],
          buttons: [setup.buttonId],
        }),
      ).toThrow("Invalid params");
    });

    it("rejects nonexistent zone", () => {
      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: "nonexistent",
          lights: [setup.lightId],
          buttons: [setup.buttonId],
        }),
      ).toThrow("Zone not found");
    });

    it("rejects empty lights", () => {
      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: setup.zoneId,
          lights: [],
          buttons: [setup.buttonId],
        }),
      ).toThrow("At least one light is required");
    });

    it("rejects light not in zone", () => {
      const otherZone = setup.zoneManager.create({ name: "Other" });
      const lightDevice = seedDevice(setup.db, {
        name: "Other Light",
        dataKeys: [{ key: "state", category: "light_state", value: JSON.stringify("OFF") }],
        orderKeys: [{ key: "state", payloadKey: "state" }],
      });
      const otherLight = setup.equipmentManager.create({
        name: "Other Light",
        type: "light_onoff",
        zoneId: otherZone.id,
      });
      setup.equipmentManager.addDataBinding(otherLight.id, lightDevice.dataIds[0], "state");
      setup.equipmentManager.addOrderBinding(otherLight.id, lightDevice.orderIds[0], "state");

      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: setup.zoneId,
          lights: [otherLight.id],
          buttons: [setup.buttonId],
        }),
      ).toThrow("does not belong to the selected zone");
    });

    it("rejects light without state order", () => {
      const lightDevice = seedDevice(setup.db, {
        name: "No Order Light",
        dataKeys: [{ key: "state", category: "light_state", value: JSON.stringify("OFF") }],
      });
      const noOrderLight = setup.equipmentManager.create({
        name: "No Order Light",
        type: "light_onoff",
        zoneId: setup.zoneId,
      });
      setup.equipmentManager.addDataBinding(noOrderLight.id, lightDevice.dataIds[0], "state");

      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: setup.zoneId,
          lights: [noOrderLight.id],
          buttons: [setup.buttonId],
        }),
      ).toThrow('has no "state" order binding');
    });

    it("rejects empty buttons", () => {
      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          buttons: [],
        }),
      ).toThrow("At least one button is required");
    });

    it("rejects button without action data binding", () => {
      const btnDevice = seedDevice(setup.db, {
        name: "No Action Btn",
        dataKeys: [{ key: "battery", category: "battery" }],
      });
      const noActionBtn = setup.equipmentManager.create({
        name: "No Action Btn",
        type: "button",
        zoneId: setup.zoneId,
      });
      setup.equipmentManager.addDataBinding(noActionBtn.id, btnDevice.dataIds[0], "battery");

      expect(() =>
        setup.manager.createInstance("switch-light", {
          zone: setup.zoneId,
          lights: [setup.lightId],
          buttons: [noActionBtn.id],
        }),
      ).toThrow('has no "action" data binding');
    });

    it("accepts valid params", () => {
      const instance = setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });
      expect(instance).toBeDefined();
      expect(instance.recipeId).toBe("switch-light");
    });
  });

  // ============================================================
  // Toggle behavior
  // ============================================================

  describe("toggle", () => {
    it("turns on lights when all are off", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      simulateButtonPress(setup, "single");

      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"ON"');
    });

    it("turns off lights when any is on", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      simulateLightState(setup, "ON");
      setup.published.length = 0;

      simulateButtonPress(setup, "single");

      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"OFF"');
    });

    it("turns off all lights when mixed state", () => {
      const second = addSecondLight(setup);
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId, second.lightId],
        buttons: [setup.buttonId],
      });

      // One on, one off
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      simulateButtonPress(setup, "single");

      expect(setup.published.length).toBe(2);
      expect(setup.published[0].payload).toContain('"state":"OFF"');
      expect(setup.published[1].payload).toContain('"state":"OFF"');
    });

    it("responds to any action value (single, double, long)", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      // single → on
      simulateButtonPress(setup, "single");
      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"ON"');

      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // double → off
      simulateButtonPress(setup, "double");
      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"OFF"');

      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      // long → on again
      simulateButtonPress(setup, "long");
      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"ON"');
    });

    it("controls multiple lights at once", () => {
      const second = addSecondLight(setup);
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId, second.lightId],
        buttons: [setup.buttonId],
      });

      simulateButtonPress(setup, "single");

      expect(setup.published.length).toBe(2);
      expect(setup.published[0].payload).toContain('"state":"ON"');
      expect(setup.published[1].payload).toContain('"state":"ON"');
    });
  });

  // ============================================================
  // Multiple buttons
  // ============================================================

  describe("multiple buttons", () => {
    it("responds to any registered button", () => {
      const btn2 = addSecondButton(setup);
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId, btn2.buttonId],
      });

      // Button 1
      simulateButtonPress(setup, "single");
      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"ON"');

      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Button 2
      simulateButtonPress(setup, "single", btn2.buttonDataId);
      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"OFF"');
    });

    it("ignores events from unregistered buttons", () => {
      const unregistered = addSecondButton(setup);
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      simulateButtonPress(setup, "single", unregistered.buttonDataId);

      expect(setup.published.length).toBe(0);
    });
  });

  // ============================================================
  // Failsafe timer (maxOnDuration)
  // ============================================================

  describe("failsafe timer", () => {
    it("forces lights off after maxOnDuration", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
        maxOnDuration: "1h",
      });

      simulateButtonPress(setup, "single");
      setup.published.length = 0;

      vi.advanceTimersByTime(60 * 60 * 1000 + 100);

      expect(setup.published.length).toBe(1);
      expect(setup.published[0].payload).toContain('"state":"OFF"');
    });

    it("cancels failsafe when lights turned off", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
        maxOnDuration: "1h",
      });

      simulateButtonPress(setup, "single");
      simulateLightState(setup, "ON");
      setup.published.length = 0;

      // Turn off via button
      simulateButtonPress(setup, "single");
      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      vi.advanceTimersByTime(60 * 60 * 1000 + 100);

      expect(setup.published.length).toBe(0);
    });

    it("cancels failsafe when light turned off externally", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
        maxOnDuration: "1h",
      });

      simulateButtonPress(setup, "single");
      setup.published.length = 0;

      simulateLightState(setup, "OFF");
      setup.published.length = 0;

      vi.advanceTimersByTime(60 * 60 * 1000 + 100);

      expect(setup.published.length).toBe(0);
    });

    it("does not start failsafe when maxOnDuration not set", () => {
      setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      simulateButtonPress(setup, "single");
      setup.published.length = 0;

      vi.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(setup.published.length).toBe(0);
    });
  });

  // ============================================================
  // Cleanup
  // ============================================================

  describe("cleanup", () => {
    it("stop cancels failsafe timer", () => {
      const instance = setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
        maxOnDuration: "1h",
      });

      simulateButtonPress(setup, "single");
      setup.published.length = 0;

      setup.manager.deleteInstance(instance.id);

      vi.advanceTimersByTime(60 * 60 * 1000 + 100);

      expect(setup.published.length).toBe(0);
    });

    it("stop unsubscribes from events", () => {
      const instance = setup.manager.createInstance("switch-light", {
        zone: setup.zoneId,
        lights: [setup.lightId],
        buttons: [setup.buttonId],
      });

      setup.manager.deleteInstance(instance.id);

      simulateButtonPress(setup, "single");

      expect(setup.published.length).toBe(0);
    });
  });
});

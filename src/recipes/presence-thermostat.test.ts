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
import { PresenceThermostatRecipe } from "./presence-thermostat.js";
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
      o.type ?? "number",
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
  thermostatId: string;
  pirDataId: string;
  setpointDataId: string;
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
        _device: unknown,
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
    mockIntegrationRegistry as never,
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
  manager.register(PresenceThermostatRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Salon" });

  // Create PIR sensor device + equipment
  const pirDevice = seedDevice(db, {
    name: "PIR Salon",
    dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
  });
  const pirEq = equipmentManager.create({ name: "PIR Salon", type: "sensor", zoneId: zone.id });
  equipmentManager.addDataBinding(pirEq.id, pirDevice.dataIds[0], "occupancy");

  // Create thermostat device + equipment with setpoint data + order
  const thermoDevice = seedDevice(db, {
    name: "Thermostat Salon",
    dataKeys: [
      {
        key: "current_heating_setpoint",
        type: "number",
        category: "generic",
        value: JSON.stringify(19),
      },
    ],
    orderKeys: [
      { key: "current_heating_setpoint", type: "number", payloadKey: "current_heating_setpoint" },
    ],
  });
  const thermoEq = equipmentManager.create({
    name: "Thermostat Salon",
    type: "thermostat",
    zoneId: zone.id,
  });
  equipmentManager.addDataBinding(thermoEq.id, thermoDevice.dataIds[0], "setpoint");
  equipmentManager.addOrderBinding(thermoEq.id, thermoDevice.orderIds[0], "setpoint");

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
    thermostatId: thermoEq.id,
    pirDataId: pirDevice.dataIds[0],
    setpointDataId: thermoDevice.dataIds[0],
  };
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

function simulateSetpointChange(setup: TestSetup, value: number): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(value), setup.setpointDataId);
  setup.eventBus.emit({
    type: "equipment.data.changed",
    equipmentId: setup.thermostatId,
    alias: "setpoint",
    value,
    previous: 19,
  });
}

function getSetpointCommands(published: Array<{ topic: string; payload: string }>): number[] {
  return published
    .map((p) => JSON.parse(p.payload) as Record<string, unknown>)
    .filter((p) => p.current_heating_setpoint !== undefined)
    .map((p) => p.current_heating_setpoint as number);
}

const BASE_PARAMS = {
  comfortTemp: 21,
  ecoTemp: 17,
  timeout: "30m",
};

function createButton(setup: TestSetup): string {
  const buttonDevice = seedDevice(setup.db, {
    name: "Button Salon",
    dataKeys: [{ key: "action", type: "text", category: "action", value: JSON.stringify("") }],
  });
  const buttonEq = setup.equipmentManager.create({
    name: "Button Salon",
    type: "button",
    zoneId: setup.zoneId,
  });
  setup.equipmentManager.addDataBinding(buttonEq.id, buttonDevice.dataIds[0], "action");
  return buttonEq.id;
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

describe("PresenceThermostatRecipe", () => {
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
    expect(() => setup.manager.createInstance("presence-thermostat", {})).toThrow("Invalid params");
  });

  it("validates zone exists", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: "nonexistent",
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates thermostat exists", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: "nonexistent",
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates thermostat belongs to selected zone", () => {
    const otherZone = setup.zoneManager.create({ name: "Cuisine" });
    const thermoDevice = seedDevice(setup.db, {
      name: "Thermo Cuisine",
      dataKeys: [{ key: "setpoint", type: "number", category: "generic", value: "19" }],
      orderKeys: [{ key: "setpoint", type: "number", payloadKey: "setpoint" }],
    });
    const thermoEq = setup.equipmentManager.create({
      name: "Thermo Cuisine",
      type: "thermostat",
      zoneId: otherZone.id,
    });
    setup.equipmentManager.addDataBinding(thermoEq.id, thermoDevice.dataIds[0], "setpoint");
    setup.equipmentManager.addOrderBinding(thermoEq.id, thermoDevice.orderIds[0], "setpoint");

    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: thermoEq.id,
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates thermostat has setpoint order binding", () => {
    // Create thermostat WITHOUT setpoint order
    const thermoDevice = seedDevice(setup.db, {
      name: "Thermo No Order",
      dataKeys: [{ key: "temp", type: "number", category: "generic", value: "19" }],
    });
    const thermoEq = setup.equipmentManager.create({
      name: "Thermo No Order",
      type: "thermostat",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(thermoEq.id, thermoDevice.dataIds[0], "temperature");

    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: thermoEq.id,
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates nightTemp requires nightStart and nightEnd", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        nightTemp: 18,
      }),
    ).toThrow("Invalid params");
  });

  it("validates preheatStart requires preheatEnd", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        preheatStart: "06:00",
      }),
    ).toThrow("Invalid params");
  });

  it("validates weekendPreheatStart requires weekendPreheatEnd", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        weekendPreheatStart: "07:00",
      }),
    ).toThrow("Invalid params");
  });

  it("validates time format", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        nightTemp: 18,
        nightStart: "invalid",
        nightEnd: "23:00",
      }),
    ).toThrow("Invalid params");
  });

  it("creates a valid instance", () => {
    const instance = setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });
    expect(instance.recipeId).toBe("presence-thermostat");
    expect(instance.enabled).toBe(true);
  });

  // ============================================================
  // Normal cycle: presence → comfort, absence → eco
  // ============================================================

  it("sends comfort setpoint when motion detected", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21);
  });

  it("sends eco setpoint after timeout with no motion", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    // Motion on → comfort
    simulateMotion(setup, true);
    setup.published.length = 0;

    // Motion off → start timer
    simulateMotion(setup, false);

    // Advance past timeout
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17);
  });

  it("does not send redundant comfort command if already in comfort", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true);
    setup.published.length = 0;

    // Another motion event while already in comfort
    simulateMotion(setup, true);

    expect(setup.published).toHaveLength(0);
  });

  it("cancels eco timer when motion resumes", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true);
    simulateMotion(setup, false); // starts eco timer
    setup.published.length = 0;

    // Motion resumes before timeout
    vi.advanceTimersByTime(10 * 60 * 1000);
    simulateMotion(setup, true);

    // Advance past original timeout — should NOT fire
    vi.advanceTimersByTime(25 * 60 * 1000);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(17);
  });

  it("does not send eco command if already in eco", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });
    setup.published.length = 0;

    // No motion, already eco — nothing to do
    simulateMotion(setup, false);

    expect(setup.published).toHaveLength(0);
  });

  // ============================================================
  // Night window
  // ============================================================

  it("sends nightTemp instead of comfortTemp during night window", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // 23:30, inside 22:00-06:00

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      nightTemp: 18,
      nightStart: "22:00",
      nightEnd: "06:00",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(18);
    expect(setpoints).not.toContain(21);
  });

  it("sends comfortTemp outside night window", () => {
    vi.setSystemTime(new Date("2026-02-27T14:00:00")); // 14:00, outside 22:00-06:00

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      nightTemp: 18,
      nightStart: "22:00",
      nightEnd: "06:00",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21);
    expect(setpoints).not.toContain(18);
  });

  it("eco setpoint is not affected by night window", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // during night

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      nightTemp: 18,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    simulateMotion(setup, true);
    simulateMotion(setup, false);
    setup.published.length = 0;

    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // ecoTemp, not nightTemp
  });

  // ============================================================
  // Preheat windows
  // ============================================================

  it("sends comfort during weekday preheat window even without motion", () => {
    // Wednesday 06:30
    vi.setSystemTime(new Date("2026-02-25T06:30:00")); // Wed

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21); // comfort on startup during preheat
  });

  it("does not start eco timer during preheat even without motion", () => {
    // Wednesday 07:00
    vi.setSystemTime(new Date("2026-02-25T07:00:00")); // Wed

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });
    setup.published.length = 0;

    // No motion event — should not switch to eco
    simulateMotion(setup, false);

    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(17);
  });

  it("starts eco timer when preheat window ends and no motion", () => {
    // Wednesday 07:59
    vi.setSystemTime(new Date("2026-02-25T07:59:00")); // Wed

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });
    setup.published.length = 0;

    // Advance past preheat end — periodic check triggers
    vi.setSystemTime(new Date("2026-02-25T08:01:00"));
    vi.advanceTimersByTime(60_000); // trigger preheat check

    // Now advance past eco timeout
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // eco after preheat ended
  });

  it("uses weekend preheat on Saturday", () => {
    // Saturday 08:30
    vi.setSystemTime(new Date("2026-02-28T08:30:00")); // Sat

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
      weekendPreheatStart: "08:00",
      weekendPreheatEnd: "10:00",
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21); // weekend preheat active
  });

  it("does not use weekday preheat on Saturday", () => {
    // Saturday 07:00 — weekday preheat 06:00-08:00 should NOT apply
    vi.setSystemTime(new Date("2026-02-28T07:00:00")); // Sat

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    // No preheat → no comfort command on startup (no motion)
    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(21);
  });

  it("uses weekend preheat on Sunday", () => {
    // Sunday 09:00
    vi.setSystemTime(new Date("2026-03-01T09:00:00")); // Sun

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      weekendPreheatStart: "08:00",
      weekendPreheatEnd: "10:00",
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21);
  });

  it("preheat with night window overlap sends nightTemp", () => {
    // Wednesday 05:30 — preheat 05:00-07:00, night 22:00-06:00
    vi.setSystemTime(new Date("2026-02-25T05:30:00")); // Wed

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      nightTemp: 18,
      nightStart: "22:00",
      nightEnd: "06:00",
      preheatStart: "05:00",
      preheatEnd: "07:00",
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(18); // nightTemp, not comfortTemp
  });

  // ============================================================
  // Manual override
  // ============================================================

  it("enters override on manual setpoint change", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // go to comfort (lastSentSetpoint = 21)
    vi.advanceTimersByTime(6000); // wait past grace period
    setup.published.length = 0;

    // Manual setpoint change (23 ≠ 21 → override)
    simulateSetpointChange(setup, 23);

    // Next motion should be ignored (override)
    simulateMotion(setup, false);
    simulateMotion(setup, true);

    // No comfort command should be sent (override active)
    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(21);
  });

  it("does not enter override on self-triggered setpoint change", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    // Motion on → comfort (lastSentSetpoint = 21)
    simulateMotion(setup, true);

    // MQTT echo with same value (21 = 21) — should NOT trigger override
    simulateSetpointChange(setup, 21);

    // Go to eco and back — should work (no override)
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    setup.published.length = 0;

    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21); // comfort works — not in override
  });

  it("ignores setpoint echo during grace period after command", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    // Motion → comfort (setpoint=21, starts 5s grace)
    simulateMotion(setup, true);

    // Device echoes previous setpoint (17) within grace window — should NOT trigger override
    vi.advanceTimersByTime(1000);
    simulateSetpointChange(setup, 17);

    // Go to eco and back — should work (no override)
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    setup.published.length = 0;

    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21); // comfort works — not in override
  });

  it("clears override after absence timeout", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort (lastSentSetpoint = 21)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateSetpointChange(setup, 25); // manual change (25 ≠ 21 → override)

    // No motion → start override-clear timer
    simulateMotion(setup, false);
    setup.published.length = 0;

    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    // Override cleared → eco sent
    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17);

    // Now motion should work again
    setup.published.length = 0;
    simulateMotion(setup, true);

    const newSetpoints = getSetpointCommands(setup.published);
    expect(newSetpoints).toContain(21);
  });

  it("motion during override cancels eco timer but does not change setpoint", () => {
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort (lastSentSetpoint = 21)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateSetpointChange(setup, 25); // manual change (25 ≠ 21 → override)

    simulateMotion(setup, false); // start override-clear timer
    setup.published.length = 0;

    // Motion resumes during override
    vi.advanceTimersByTime(10 * 60 * 1000);
    simulateMotion(setup, true);

    // No setpoint command (override still active)
    expect(getSetpointCommands(setup.published)).toHaveLength(0);

    // Original timer should NOT fire
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(getSetpointCommands(setup.published)).toHaveLength(0);
  });

  it("preheat does not break override", () => {
    // Wednesday 05:55
    vi.setSystemTime(new Date("2026-02-25T05:55:00"));

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    simulateMotion(setup, true); // comfort (lastSentSetpoint = 21)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateSetpointChange(setup, 25); // manual change (25 ≠ 21 → override)
    setup.published.length = 0;

    // Advance into preheat window
    vi.setSystemTime(new Date("2026-02-25T06:01:00"));
    vi.advanceTimersByTime(60_000); // trigger preheat check

    // No setpoint sent (override takes precedence)
    expect(getSetpointCommands(setup.published)).toHaveLength(0);
  });

  // ============================================================
  // Startup evaluation
  // ============================================================

  it("sends comfort immediately if motion present on startup", () => {
    // Set motion BEFORE creating the recipe
    simulateMotion(setup, true);
    setup.published.length = 0;

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21);
  });

  it("does not send comfort on startup if no motion", () => {
    setup.published.length = 0;

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(21);
  });

  it("sends comfort on startup during preheat even without motion", () => {
    vi.setSystemTime(new Date("2026-02-25T07:00:00")); // Wed, inside 06:00-08:00
    setup.published.length = 0;

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21);
  });

  // ============================================================
  // Full cycle integration
  // ============================================================

  it("full cycle: eco → motion comfort → absence eco → preheat comfort → end eco", () => {
    // Wednesday 12:00
    vi.setSystemTime(new Date("2026-02-25T12:00:00"));

    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    // 1. Motion → comfort
    setup.published.length = 0;
    simulateMotion(setup, true);
    expect(getSetpointCommands(setup.published)).toContain(21);

    // 2. No motion → eco after timeout
    simulateMotion(setup, false);
    setup.published.length = 0;
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    expect(getSetpointCommands(setup.published)).toContain(17);

    // 3. Preheat starts next morning
    vi.setSystemTime(new Date("2026-02-26T06:01:00")); // Thu
    setup.published.length = 0;
    vi.advanceTimersByTime(60_000); // trigger preheat check
    expect(getSetpointCommands(setup.published)).toContain(21);

    // 4. Preheat ends, no motion → eco
    vi.setSystemTime(new Date("2026-02-26T08:01:00"));
    setup.published.length = 0;
    vi.advanceTimersByTime(60_000); // trigger preheat check
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    expect(getSetpointCommands(setup.published)).toContain(17);
  });

  // ============================================================
  // Cocoon mode
  // ============================================================

  it("validates cocoonTemp required when buttons provided", () => {
    const buttonId = createButton(setup);
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        buttons: [buttonId],
      }),
    ).toThrow("Invalid params");
  });

  it("validates buttons required when cocoonTemp provided", () => {
    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        cocoonTemp: 23,
      }),
    ).toThrow("Invalid params");
  });

  it("validates button has action data binding", () => {
    // Create button WITHOUT action binding
    const btnDevice = seedDevice(setup.db, {
      name: "Bad Button",
      dataKeys: [{ key: "battery", type: "number", category: "battery", value: "100" }],
    });
    const btnEq = setup.equipmentManager.create({
      name: "Bad Button",
      type: "button",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(btnEq.id, btnDevice.dataIds[0], "battery");

    expect(() =>
      setup.manager.createInstance("presence-thermostat", {
        zone: setup.zoneId,
        thermostat: setup.thermostatId,
        ...BASE_PARAMS,
        buttons: [btnEq.id],
        cocoonTemp: 23,
      }),
    ).toThrow("Invalid params");
  });

  it("creates valid instance with cocoon config", () => {
    const buttonId = createButton(setup);
    const instance = setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });
    expect(instance.recipeId).toBe("presence-thermostat");
    expect(instance.enabled).toBe(true);
  });

  it("button press activates cocoon mode and sends cocoonTemp", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });
    setup.published.length = 0;

    simulateButtonPress(setup, buttonId);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(23);
  });

  it("second button press exits cocoon — comfort if motion, eco if not", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    // Enter cocoon
    simulateButtonPress(setup, buttonId);
    setup.published.length = 0;

    // Exit cocoon without motion → eco
    simulateButtonPress(setup, buttonId);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // eco (no motion)
  });

  it("second button press during cocoon with motion returns to comfort", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    simulateMotion(setup, true); // comfort
    simulateButtonPress(setup, buttonId); // cocoon
    setup.published.length = 0;

    // Exit cocoon with motion present → comfort
    simulateButtonPress(setup, buttonId);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(21); // comfort (motion present)
    expect(setpoints).not.toContain(23); // not cocoon
  });

  it("cocoon exits to eco after absence timeout", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    simulateMotion(setup, true); // comfort
    simulateButtonPress(setup, buttonId); // cocoon

    // No motion → start eco timer
    simulateMotion(setup, false);
    setup.published.length = 0;

    // Advance past timeout
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // eco
  });

  it("motion during cocoon cancels eco timer and keeps cocoon", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    simulateMotion(setup, true); // comfort
    simulateButtonPress(setup, buttonId); // cocoon
    simulateMotion(setup, false); // start eco timer
    setup.published.length = 0;

    // Motion resumes before timeout → cancel eco timer, stay in cocoon
    vi.advanceTimersByTime(10 * 60 * 1000);
    simulateMotion(setup, true);

    // Advance past original timeout — should NOT fire
    vi.advanceTimersByTime(25 * 60 * 1000);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(17); // no eco
  });

  it("cocoon exits when night window starts", () => {
    vi.setSystemTime(new Date("2026-02-27T21:50:00")); // 21:50, just before night

    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
      nightTemp: 18,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    simulateMotion(setup, true); // comfort
    simulateButtonPress(setup, buttonId); // cocoon
    setup.published.length = 0;

    // Advance into night window — periodic check should exit cocoon
    vi.setSystemTime(new Date("2026-02-27T22:01:00"));
    vi.advanceTimersByTime(60_000); // trigger periodic check

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // eco (night forces eco)
    expect(setpoints).not.toContain(23); // not cocoon
  });

  it("button press during override is ignored", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    simulateMotion(setup, true); // comfort (lastSentSetpoint = 21)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateSetpointChange(setup, 25); // manual change → override
    setup.published.length = 0;

    // Button press during override — should be ignored
    simulateButtonPress(setup, buttonId);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(23); // no cocoon
  });

  it("manual setpoint change during cocoon enters override", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    simulateButtonPress(setup, buttonId); // cocoon (lastSentSetpoint = 23)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateSetpointChange(setup, 25); // manual change (25 ≠ 23 → override)
    setup.published.length = 0;

    // Next motion should be ignored (override)
    simulateMotion(setup, true);
    simulateMotion(setup, false);
    simulateMotion(setup, true);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).not.toContain(21); // no comfort
    expect(setpoints).not.toContain(23); // no cocoon
  });

  it("preheat does not prevent cocoon from exiting on absence", () => {
    // Wednesday 06:30 — inside preheat
    vi.setSystemTime(new Date("2026-02-25T06:30:00"));

    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
      preheatStart: "06:00",
      preheatEnd: "08:00",
    });

    simulateMotion(setup, true); // comfort
    simulateButtonPress(setup, buttonId); // cocoon
    simulateMotion(setup, false); // start eco timer (preheat should NOT protect cocoon)
    setup.published.length = 0;

    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(17); // eco despite being in preheat window
  });

  it("button press from eco enters cocoon directly", () => {
    const buttonId = createButton(setup);
    setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });
    setup.published.length = 0;

    // In eco, no motion — press button
    simulateButtonPress(setup, buttonId);

    const setpoints = getSetpointCommands(setup.published);
    expect(setpoints).toContain(23); // cocoon directly from eco
  });

  it("cocoonMode state is exposed and cleared correctly", () => {
    const buttonId = createButton(setup);
    const instance = setup.manager.createInstance("presence-thermostat", {
      zone: setup.zoneId,
      thermostat: setup.thermostatId,
      ...BASE_PARAMS,
      buttons: [buttonId],
      cocoonTemp: 23,
    });

    // Enter cocoon
    simulateButtonPress(setup, buttonId);
    const stateAfterCocoon = setup.manager.getInstanceState(instance.id);
    expect(stateAfterCocoon.cocoonMode).toBe(true);
    expect(stateAfterCocoon.currentMode).toBe("cocoon");

    // Exit cocoon
    simulateButtonPress(setup, buttonId);
    const stateAfterExit = setup.manager.getInstanceState(instance.id);
    expect(stateAfterExit.cocoonMode).toBeUndefined();
    expect(stateAfterExit.currentMode).not.toBe("cocoon");
  });
});

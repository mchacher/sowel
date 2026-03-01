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
import { PresenceHeaterRecipe } from "./presence-heater.js";
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
      o.type ?? "enum",
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
  heaterId: string;
  pirDataId: string;
  stateDataId: string;
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
  manager.register(PresenceHeaterRecipe);

  // Create zone
  const zone = zoneManager.create({ name: "Chambre" });

  // Create PIR sensor device + equipment
  const pirDevice = seedDevice(db, {
    name: "PIR Chambre",
    dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
  });
  const pirEq = equipmentManager.create({ name: "PIR Chambre", type: "sensor", zoneId: zone.id });
  equipmentManager.addDataBinding(pirEq.id, pirDevice.dataIds[0], "occupancy");

  // Create heater device + equipment with state data + order
  const heaterDevice = seedDevice(db, {
    name: "Heater Chambre",
    dataKeys: [
      {
        key: "state",
        type: "enum",
        category: "generic",
        value: JSON.stringify("OFF"),
      },
    ],
    orderKeys: [{ key: "state", type: "enum", payloadKey: "state" }],
  });
  const heaterEq = equipmentManager.create({
    name: "Radiateur Chambre",
    type: "heater",
    zoneId: zone.id,
  });
  equipmentManager.addDataBinding(heaterEq.id, heaterDevice.dataIds[0], "state");
  equipmentManager.addOrderBinding(heaterEq.id, heaterDevice.orderIds[0], "state");

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
    heaterId: heaterEq.id,
    pirDataId: pirDevice.dataIds[0],
    stateDataId: heaterDevice.dataIds[0],
  };
}

function simulateMotion(setup: TestSetup, active: boolean): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(active), setup.pirDataId);
  setup.eventBus.emit({
    type: "device.data.updated",
    deviceId: "pir-device",
    deviceName: "PIR Chambre",
    dataId: setup.pirDataId,
    key: "occupancy",
    value: active,
    previous: !active,
    timestamp: new Date().toISOString(),
  });
}

function simulateHeaterStateChange(setup: TestSetup, value: string): void {
  setup.db
    .prepare("UPDATE device_data SET value = ? WHERE id = ?")
    .run(JSON.stringify(value), setup.stateDataId);
  setup.eventBus.emit({
    type: "equipment.data.changed",
    equipmentId: setup.heaterId,
    alias: "state",
    value,
    previous: value === "ON" ? "OFF" : "ON",
  });
}

function getStateCommands(published: Array<{ topic: string; payload: string }>): string[] {
  return published
    .map((p) => JSON.parse(p.payload) as Record<string, unknown>)
    .filter((p) => p.state !== undefined)
    .map((p) => p.state as string);
}

const BASE_PARAMS = {
  timeout: "30m",
};

// ============================================================
// Tests
// Fil pilote convention: relay OFF = comfort, relay ON = eco
// ============================================================

describe("PresenceHeaterRecipe", () => {
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
    expect(() => setup.manager.createInstance("presence-heater", {})).toThrow("Invalid params");
  });

  it("validates zone exists", () => {
    expect(() =>
      setup.manager.createInstance("presence-heater", {
        zone: "nonexistent",
        heaters: [setup.heaterId],
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates heater exists", () => {
    expect(() =>
      setup.manager.createInstance("presence-heater", {
        zone: setup.zoneId,
        heaters: ["nonexistent"],
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates heater has state order binding", () => {
    // Create heater WITHOUT state order
    const heaterDevice = seedDevice(setup.db, {
      name: "Heater No Order",
      dataKeys: [{ key: "state", type: "enum", category: "generic", value: JSON.stringify("OFF") }],
    });
    const heaterEq = setup.equipmentManager.create({
      name: "Heater No Order",
      type: "heater",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(heaterEq.id, heaterDevice.dataIds[0], "state");

    expect(() =>
      setup.manager.createInstance("presence-heater", {
        zone: setup.zoneId,
        heaters: [heaterEq.id],
        ...BASE_PARAMS,
      }),
    ).toThrow("Invalid params");
  });

  it("validates nightStart requires nightEnd", () => {
    expect(() =>
      setup.manager.createInstance("presence-heater", {
        zone: setup.zoneId,
        heaters: [setup.heaterId],
        ...BASE_PARAMS,
        nightStart: "22:00",
      }),
    ).toThrow("Invalid params");
  });

  it("validates time format", () => {
    expect(() =>
      setup.manager.createInstance("presence-heater", {
        zone: setup.zoneId,
        heaters: [setup.heaterId],
        ...BASE_PARAMS,
        nightStart: "invalid",
        nightEnd: "06:00",
      }),
    ).toThrow("Invalid params");
  });

  it("creates a valid instance", () => {
    const instance = setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });
    expect(instance.recipeId).toBe("presence-heater");
    expect(instance.enabled).toBe(true);
  });

  // ============================================================
  // Normal cycle: motion → comfort (relay OFF), absence → eco (relay ON)
  // ============================================================

  it("sends comfort (relay OFF) when motion detected", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const states = getStateCommands(setup.published);
    expect(states).toContain("OFF"); // comfort = relay OFF
  });

  it("sends eco (relay ON) after timeout with no motion", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    // Motion on → comfort
    simulateMotion(setup, true);
    setup.published.length = 0;

    // Motion off → start timer
    simulateMotion(setup, false);

    // Advance past timeout
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON
  });

  it("does not send redundant comfort command if already in comfort", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true);
    setup.published.length = 0;

    // Another motion event while already in comfort
    simulateMotion(setup, true);

    expect(setup.published).toHaveLength(0);
  });

  it("cancels eco timer when motion resumes", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
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

    const states = getStateCommands(setup.published);
    expect(states).not.toContain("ON"); // eco (relay ON) did not fire
  });

  it("does not send eco command if already in eco", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
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

  it("forces eco when recipe starts during night window", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // inside 22:00-06:00

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON
  });

  it("forces eco on night window entry when in comfort", () => {
    vi.setSystemTime(new Date("2026-02-27T21:50:00")); // just before night

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    simulateMotion(setup, true); // comfort
    setup.published.length = 0;

    // Advance into night window — periodic check triggers
    vi.setSystemTime(new Date("2026-02-27T22:01:00"));
    vi.advanceTimersByTime(60_000); // trigger night check

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON
  });

  it("ignores motion during night window", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // during night

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    // Should NOT send comfort (night forces eco)
    const states = getStateCommands(setup.published);
    expect(states).not.toContain("OFF"); // comfort (relay OFF) blocked
  });

  it("resumes comfort after night window ends if motion present", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // during night

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    // Simulate motion present (but night forces eco)
    simulateMotion(setup, true);
    setup.published.length = 0;

    // Advance past night end
    vi.setSystemTime(new Date("2026-02-28T06:01:00"));
    vi.advanceTimersByTime(60_000); // trigger night check

    const states = getStateCommands(setup.published);
    expect(states).toContain("OFF"); // comfort = relay OFF
  });

  it("stays eco after night window ends if no motion", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // during night

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });
    setup.published.length = 0;

    // Advance past night end — no motion
    vi.setSystemTime(new Date("2026-02-28T06:01:00"));
    vi.advanceTimersByTime(60_000); // trigger night check

    // Should stay eco (no motion detected)
    const states = getStateCommands(setup.published);
    expect(states).not.toContain("OFF"); // comfort (relay OFF) not sent
  });

  // ============================================================
  // Manual override
  // ============================================================

  it("enters override on manual relay change", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort (relay OFF)
    vi.advanceTimersByTime(6000); // wait past grace period
    setup.published.length = 0;

    // Manual relay change — ON while recipe expects OFF → override
    simulateHeaterStateChange(setup, "ON");

    // Next motion should be ignored (override active)
    simulateMotion(setup, false);
    simulateMotion(setup, true);

    const states = getStateCommands(setup.published);
    expect(states).not.toContain("OFF"); // no comfort command
  });

  it("does not enter override on self-triggered state change", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    // Motion on → comfort (relay OFF)
    simulateMotion(setup, true);

    // MQTT echo with same value (OFF during comfort) — should NOT trigger override
    simulateHeaterStateChange(setup, "OFF");

    // Go to eco and back — should work (no override)
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    setup.published.length = 0;

    simulateMotion(setup, true);

    const states = getStateCommands(setup.published);
    expect(states).toContain("OFF"); // comfort works — not in override
  });

  it("ignores state echo during grace period after command", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    // Motion → comfort (starts 5s grace)
    simulateMotion(setup, true);

    // Device echoes ON within grace window — should NOT trigger override
    vi.advanceTimersByTime(1000);
    simulateHeaterStateChange(setup, "ON");

    // Go to eco and back — should work (no override)
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    setup.published.length = 0;

    simulateMotion(setup, true);

    const states = getStateCommands(setup.published);
    expect(states).toContain("OFF"); // comfort works — not in override
  });

  it("clears override after absence timeout", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort (relay OFF)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateHeaterStateChange(setup, "ON"); // manual change → override

    // No motion → start override-clear timer
    simulateMotion(setup, false);
    setup.published.length = 0;

    vi.advanceTimersByTime(30 * 60 * 1000 + 100);

    // Override cleared → eco sent
    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON

    // Now motion should work again
    setup.published.length = 0;
    simulateMotion(setup, true);

    const newStates = getStateCommands(setup.published);
    expect(newStates).toContain("OFF"); // comfort = relay OFF
  });

  it("motion during override cancels eco timer but does not change state", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort (relay OFF)
    vi.advanceTimersByTime(6000); // wait past grace period
    simulateHeaterStateChange(setup, "ON"); // manual change → override

    simulateMotion(setup, false); // start override-clear timer
    setup.published.length = 0;

    // Motion resumes during override
    vi.advanceTimersByTime(10 * 60 * 1000);
    simulateMotion(setup, true);

    // No state command (override still active)
    expect(getStateCommands(setup.published)).toHaveLength(0);

    // Original timer should NOT fire
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(getStateCommands(setup.published)).toHaveLength(0);
  });

  // ============================================================
  // Max comfort duration (failsafe)
  // ============================================================

  it("forces eco after maxOnDuration even with continued motion", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      maxOnDuration: "2h",
    });

    simulateMotion(setup, true); // comfort
    setup.published.length = 0;

    // Advance past maxOnDuration
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 100);

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // failsafe → eco = relay ON
  });

  it("does not trigger failsafe if eco happens before maxOnDuration", () => {
    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      maxOnDuration: "2h",
    });

    simulateMotion(setup, true); // comfort
    simulateMotion(setup, false); // start eco timer
    vi.advanceTimersByTime(30 * 60 * 1000 + 100); // eco fires at 30m
    setup.published.length = 0;

    // Advance well past maxOnDuration — no failsafe since already eco
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);

    const states = getStateCommands(setup.published);
    expect(states).not.toContain("ON"); // no extra eco
  });

  // ============================================================
  // Startup evaluation
  // ============================================================

  it("sends comfort immediately if motion present on startup", () => {
    // Set motion BEFORE creating the recipe
    simulateMotion(setup, true);
    setup.published.length = 0;

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    const states = getStateCommands(setup.published);
    expect(states).toContain("OFF"); // comfort = relay OFF
  });

  it("sends eco on startup if no motion", () => {
    setup.published.length = 0;

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON
  });

  it("sends eco on startup during night window even with motion", () => {
    vi.setSystemTime(new Date("2026-02-27T23:30:00")); // during night

    simulateMotion(setup, true);
    setup.published.length = 0;

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    const states = getStateCommands(setup.published);
    expect(states).toContain("ON"); // eco = relay ON (night forced)
    expect(states).not.toContain("OFF"); // no comfort
  });

  // ============================================================
  // Multiple heaters
  // ============================================================

  it("commands all heaters on comfort", () => {
    // Create second heater
    const heater2Device = seedDevice(setup.db, {
      name: "Heater 2",
      dataKeys: [{ key: "state", type: "enum", category: "generic", value: JSON.stringify("OFF") }],
      orderKeys: [{ key: "state", type: "enum", payloadKey: "state" }],
    });
    const heater2Eq = setup.equipmentManager.create({
      name: "Radiateur 2",
      type: "heater",
      zoneId: setup.zoneId,
    });
    setup.equipmentManager.addDataBinding(heater2Eq.id, heater2Device.dataIds[0], "state");
    setup.equipmentManager.addOrderBinding(heater2Eq.id, heater2Device.orderIds[0], "state");

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId, heater2Eq.id],
      ...BASE_PARAMS,
    });
    setup.published.length = 0;

    simulateMotion(setup, true);

    const states = getStateCommands(setup.published);
    // Both heaters should receive OFF (comfort = relay OFF)
    expect(states.filter((s) => s === "OFF")).toHaveLength(2);
  });

  // ============================================================
  // Full cycle integration
  // ============================================================

  it("full cycle: eco → motion comfort → absence eco → night eco → morning resume", () => {
    vi.setSystemTime(new Date("2026-02-27T14:00:00")); // afternoon

    setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
      nightStart: "22:00",
      nightEnd: "06:00",
    });

    // 1. Motion → comfort (relay OFF)
    setup.published.length = 0;
    simulateMotion(setup, true);
    expect(getStateCommands(setup.published)).toContain("OFF");

    // 2. No motion → eco (relay ON) after timeout
    simulateMotion(setup, false);
    setup.published.length = 0;
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    expect(getStateCommands(setup.published)).toContain("ON");

    // 3. Evening motion → comfort again (relay OFF)
    vi.setSystemTime(new Date("2026-02-27T20:00:00"));
    setup.published.length = 0;
    simulateMotion(setup, true);
    expect(getStateCommands(setup.published)).toContain("OFF");

    // 4. Night window starts → forced eco (relay ON)
    vi.setSystemTime(new Date("2026-02-27T22:01:00"));
    setup.published.length = 0;
    vi.advanceTimersByTime(60_000); // trigger night check
    expect(getStateCommands(setup.published)).toContain("ON");

    // 5. Morning motion after night ends → comfort (relay OFF)
    vi.setSystemTime(new Date("2026-02-28T06:01:00"));
    simulateMotion(setup, true); // motion present
    setup.published.length = 0;
    vi.advanceTimersByTime(60_000); // trigger night check
    expect(getStateCommands(setup.published)).toContain("OFF");
  });

  // ============================================================
  // State exposed
  // ============================================================

  it("currentMode state is exposed correctly", () => {
    const instance = setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    // Start in eco
    const stateEco = setup.manager.getInstanceState(instance.id);
    expect(stateEco.currentMode).toBe("eco");

    // Motion → comfort
    simulateMotion(setup, true);
    const stateComfort = setup.manager.getInstanceState(instance.id);
    expect(stateComfort.currentMode).toBe("comfort");

    // No motion → eco after timeout
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    const stateEcoAgain = setup.manager.getInstanceState(instance.id);
    expect(stateEcoAgain.currentMode).toBe("eco");
  });

  it("overrideMode state is exposed and cleared correctly", () => {
    const instance = setup.manager.createInstance("presence-heater", {
      zone: setup.zoneId,
      heaters: [setup.heaterId],
      ...BASE_PARAMS,
    });

    simulateMotion(setup, true); // comfort
    vi.advanceTimersByTime(6000); // wait past grace period

    // Manual relay change → override
    simulateHeaterStateChange(setup, "ON"); // ON while comfort expects OFF
    const stateOverride = setup.manager.getInstanceState(instance.id);
    expect(stateOverride.overrideMode).toBe(true);

    // Clear override via absence timeout
    simulateMotion(setup, false);
    vi.advanceTimersByTime(30 * 60 * 1000 + 100);
    const stateCleared = setup.manager.getInstanceState(instance.id);
    expect(stateCleared.overrideMode).toBeUndefined();
  });
});

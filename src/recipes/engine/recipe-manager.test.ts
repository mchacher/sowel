import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZoneManager } from "../../zones/zone-manager.js";
import { ZoneAggregator } from "../../zones/zone-aggregator.js";
import { EquipmentManager } from "../../equipments/equipment-manager.js";
import { DeviceManager } from "../../devices/device-manager.js";
import { EventBus } from "../../core/event-bus.js";
import { createLogger } from "../../core/logger.js";
import { RecipeManager, RecipeError } from "./recipe-manager.js";
import { Recipe } from "./recipe.js";
import type { SunlightManager } from "../../zones/sunlight-manager.js";
import type { TariffClassifier } from "../../energy/tariff-classifier.js";
import type {
  RecipeSlotDef,
  EngineEvent,
  RecipeDefinition,
  RecipeTariff,
  TariffConfig,
} from "../../shared/types.js";

/** Captures `ctx.helpers.getSunlight()` from a running instance (spec 126). */
let capturedSun: {
  sunrise: string | null;
  sunset: string | null;
  isDaylight: boolean | null;
} | null = null;

/** Captures `ctx.helpers.getTariff()` from a running instance (spec 138). */
let capturedTariff: RecipeTariff | null = null;

/**
 * Backing config for the mock classifier. Handed out by reference on purpose —
 * that is what the real TariffClassifier does, and it is what lets the tests
 * prove the snapshot is copied out rather than aliased.
 */
let tariffConfig: TariffConfig | null = null;
const tariffClassifier = {
  getConfig: () => tariffConfig,
} as unknown as TariffClassifier;

// ============================================================
// Test helpers
// ============================================================

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
    "014_device_orders_value_on_off.sql",
  ];
  for (const file of migrations) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../../migrations", file),
      "utf-8",
    );
    db.exec(sql);
  }
  return db;
}

const logger = createLogger("silent").logger;

// ============================================================
// Test recipe — minimal implementation
// ============================================================

class TestRecipe extends Recipe {
  readonly id = "test-recipe";
  readonly name = "Test Recipe";
  readonly description = "A test recipe";
  readonly slots: RecipeSlotDef[] = [
    { id: "value", name: "Value", description: "A test value", type: "number", required: true },
  ];

  started = false;
  stopped = false;
  validateCalled = false;
  lastParams: Record<string, unknown> = {};

  validate(params: Record<string, unknown>): void {
    this.validateCalled = true;
    if (params.value === undefined) {
      throw new Error("value is required");
    }
  }

  start(params: Record<string, unknown>): void {
    this.started = true;
    this.lastParams = params;
  }

  stop(): void {
    this.stopped = true;
  }
}

// ============================================================
// Tests
// ============================================================

describe("RecipeManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let zoneManager: ZoneManager;
  let equipmentManager: EquipmentManager;
  let aggregator: ZoneAggregator;
  let sunlightManager: SunlightManager;
  let manager: RecipeManager;
  let events: EngineEvent[];

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    const mockIntegrationRegistry = { getById: () => undefined };
    const deviceManager = new DeviceManager(db, eventBus, logger);
    equipmentManager = new EquipmentManager(
      db,
      eventBus,
      mockIntegrationRegistry as any,
      deviceManager,
      logger,
    );
    aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
    sunlightManager = {
      getSunlightData: () => ({ sunrise: "07:30", sunset: "21:00", isDaylight: true }),
    } as unknown as SunlightManager;
    manager = new RecipeManager(
      db,
      eventBus,
      equipmentManager,
      zoneManager,
      aggregator,
      sunlightManager,
      tariffClassifier,
      logger,
    );
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    manager.stopAll();
    db.close();
  });

  // ============================================================
  // Registration
  // ============================================================

  it("registers a recipe and lists it", () => {
    manager.register(TestRecipe);

    const recipes = manager.getRecipes();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].id).toBe("test-recipe");
    expect(recipes[0].name).toBe("Test Recipe");
    expect(recipes[0].slots).toHaveLength(1);
  });

  it("gets a recipe by id", () => {
    manager.register(TestRecipe);

    const recipe = manager.getRecipeById("test-recipe");
    expect(recipe).not.toBeNull();
    expect(recipe!.id).toBe("test-recipe");

    const missing = manager.getRecipeById("nonexistent");
    expect(missing).toBeNull();
  });

  // ============================================================
  // Spec 126 — `select` slot serialization + getSunlight helper
  // ============================================================

  it("serializes a `select` slot's options through getRecipes()", () => {
    const def: RecipeDefinition = {
      id: "select-def",
      name: "Select Def",
      description: "has a select slot",
      slots: [
        {
          id: "kind",
          name: "Kind",
          description: "Pick a kind",
          type: "select",
          required: true,
          defaultValue: "time",
          options: [
            { value: "time", label: "Fixed time" },
            { value: "sunset", label: "Sunset" },
          ],
        },
      ],
      validate: () => {},
      createInstance: () => ({ stop: () => {} }),
    };
    manager.registerExternal(def);

    const recipe = manager.getRecipeById("select-def");
    expect(recipe).not.toBeNull();
    const slot = recipe!.slots.find((s) => s.id === "kind");
    expect(slot?.type).toBe("select");
    expect(slot?.options).toHaveLength(2);
    expect(slot?.options?.[1]).toEqual({ value: "sunset", label: "Sunset" });
  });

  // ============================================================
  // Spec 138 — read-only getTariff helper
  // ============================================================

  /** Registers a recipe that captures the tariff snapshot at start. */
  function registerTariffProbe(id: string): void {
    manager.registerExternal({
      id,
      name: id,
      description: "reads the tariff",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        capturedTariff = ctx.helpers.getTariff();
        return { stop: () => {} };
      },
    } satisfies RecipeDefinition);
  }

  it("reports the tariff as unconfigured when no schedule is set", () => {
    tariffConfig = null;
    registerTariffProbe("tariff-none");
    capturedTariff = null;
    manager.createInstance("tariff-none", {});

    expect(capturedTariff).toEqual({
      configured: false,
      offPeakToday: [],
      isOffPeakNow: null,
    });
  });

  it("exposes today's off-peak slots and prices", () => {
    const today = new Date().getDay();
    tariffConfig = {
      schedules: [
        {
          days: [0, 1, 2, 3, 4, 5, 6],
          slots: [
            { start: "22:00", end: "06:00", tariff: "hc" },
            { start: "06:00", end: "22:00", tariff: "hp" },
          ],
        },
        // A schedule for no day at all must not leak into the snapshot.
        { days: [(today + 3) % 7], slots: [{ start: "01:00", end: "02:00", tariff: "hc" }] },
      ],
      prices: { hp: 0.2516, hc: 0.2068 },
    };
    registerTariffProbe("tariff-set");
    capturedTariff = null;
    manager.createInstance("tariff-set", {});

    expect(capturedTariff?.configured).toBe(true);
    // Only HC slots, and only the schedule covering today.
    expect(capturedTariff?.offPeakToday).toEqual([{ start: "22:00", end: "06:00", tariff: "hc" }]);
    // Prices are commercial data and must never reach a recipe package.
    expect(capturedTariff).not.toHaveProperty("prices");
    expect(JSON.stringify(capturedTariff)).not.toContain("0.2516");
    expect(JSON.stringify(capturedTariff)).not.toContain("0.2068");
  });

  it("resolves whether the current time is off-peak across a midnight wrap", () => {
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    // Build a window that certainly contains "now" and certainly wraps midnight,
    // whatever time the suite happens to run at.
    const pad = (n: number) => String(n).padStart(2, "0");
    const hm = (m: number) =>
      `${pad(Math.floor((((m % 1440) + 1440) % 1440) / 60))}:${pad((((m % 1440) + 1440) % 1440) % 60)}`;
    tariffConfig = {
      schedules: [
        {
          days: [now.getDay()],
          slots: [{ start: hm(minute - 60), end: hm(minute - 120), tariff: "hc" }],
        },
      ],
      prices: { hp: 0.25, hc: 0.2 },
    };
    registerTariffProbe("tariff-wrap");
    capturedTariff = null;
    manager.createInstance("tariff-wrap", {});

    expect(capturedTariff?.isOffPeakNow).toBe(true);
  });

  it("hands recipes a copy — mutating the snapshot cannot corrupt the config", () => {
    tariffConfig = {
      schedules: [
        { days: [0, 1, 2, 3, 4, 5, 6], slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] },
      ],
      prices: { hp: 0.25, hc: 0.2 },
    };
    registerTariffProbe("tariff-copy");
    capturedTariff = null;
    manager.createInstance("tariff-copy", {});

    // A hostile (or careless) recipe package rewrites everything it was given.
    capturedTariff!.offPeakToday[0].start = "00:00";
    capturedTariff!.offPeakToday.push({ start: "12:00", end: "13:00", tariff: "hc" });

    expect(tariffConfig.schedules[0].slots[0].start).toBe("22:00");
    expect(tariffConfig.schedules[0].slots).toHaveLength(1);
    expect(tariffConfig.prices.hc).toBe(0.2);

    // And the next reader still sees the real schedule.
    capturedTariff = null;
    manager.createInstance("tariff-copy", {});
    expect(capturedTariff?.offPeakToday).toEqual([{ start: "22:00", end: "06:00", tariff: "hc" }]);
  });

  it("exposes ctx.helpers.getSunlight() to a running instance", () => {
    const def: RecipeDefinition = {
      id: "sun-def",
      name: "Sun Def",
      description: "reads sun times",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        capturedSun = ctx.helpers.getSunlight();
        return { stop: () => {} };
      },
    };
    manager.registerExternal(def);

    capturedSun = null;
    manager.createInstance("sun-def", {});
    expect(capturedSun).toEqual({ sunrise: "07:30", sunset: "21:00", isDaylight: true });
  });

  // ============================================================
  // Instance lifecycle
  // ============================================================

  it("creates an instance with valid params", () => {
    manager.register(TestRecipe);

    const instance = manager.createInstance("test-recipe", { value: 42 });
    expect(instance.recipeId).toBe("test-recipe");
    expect(instance.params).toEqual({ value: 42 });
    expect(instance.enabled).toBe(true);

    // Check persisted
    const instances = manager.getInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].id).toBe(instance.id);

    // Check events
    const createEvent = events.find((e) => e.type === "recipe.instance.created");
    expect(createEvent).toBeDefined();
    const startEvent = events.find((e) => e.type === "recipe.instance.started");
    expect(startEvent).toBeDefined();
  });

  it("rejects instance with invalid params", () => {
    manager.register(TestRecipe);

    expect(() => manager.createInstance("test-recipe", {})).toThrow(RecipeError);
    expect(() => manager.createInstance("test-recipe", {})).toThrow("Invalid params");
  });

  it("rejects instance for unknown recipe", () => {
    expect(() => manager.createInstance("nonexistent", {})).toThrow(RecipeError);
    expect(() => manager.createInstance("nonexistent", {})).toThrow("Recipe not found");
  });

  it("deletes an instance — stops and removes from DB", () => {
    manager.register(TestRecipe);
    const instance = manager.createInstance("test-recipe", { value: 42 });

    manager.deleteInstance(instance.id);

    expect(manager.getInstances()).toHaveLength(0);

    const removeEvent = events.find((e) => e.type === "recipe.instance.removed");
    expect(removeEvent).toBeDefined();
  });

  it("throws when deleting nonexistent instance", () => {
    expect(() => manager.deleteInstance("nonexistent")).toThrow(RecipeError);
  });

  // ============================================================
  // Restore on init
  // ============================================================

  it("restores enabled instances on init", () => {
    manager.register(TestRecipe);
    manager.createInstance("test-recipe", { value: 1 });
    manager.createInstance("test-recipe", { value: 2 });

    // Create a new manager to simulate restart
    manager.stopAll();
    const newManager = new RecipeManager(
      db,
      eventBus,
      equipmentManager,
      zoneManager,
      aggregator,
      sunlightManager,
      tariffClassifier,
      logger,
    );
    newManager.register(TestRecipe);
    newManager.init();

    // Instances should be in DB
    expect(newManager.getInstances()).toHaveLength(2);

    newManager.stopAll();
  });

  // ============================================================
  // Logging
  // ============================================================

  it("writes and retrieves log entries", () => {
    manager.register(TestRecipe);
    const instance = manager.createInstance("test-recipe", { value: 42 });

    const logs = manager.getLog(instance.id);
    // Should have at least "Instance created" log
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((l) => l.message === "Instance created")).toBe(true);
  });
});

// ============================================================
// restartInstancesOfRecipe (issue #349)
// ============================================================

describe("restartInstancesOfRecipe", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let manager: RecipeManager;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    const zoneManager = new ZoneManager(db, eventBus, logger);
    const mockIntegrationRegistry = { getById: () => undefined };
    const deviceManager = new DeviceManager(db, eventBus, logger);
    const equipmentManager = new EquipmentManager(
      db,
      eventBus,
      mockIntegrationRegistry as any,
      deviceManager,
      logger,
    );
    const aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
    const sunlightManager = {
      getSunlightData: () => ({ sunrise: "07:30", sunset: "21:00", isDaylight: true }),
    } as unknown as SunlightManager;
    manager = new RecipeManager(
      db,
      eventBus,
      equipmentManager,
      zoneManager,
      aggregator,
      sunlightManager,
      tariffClassifier,
      logger,
    );
  });

  afterEach(() => {
    manager.stopAll();
    db.close();
  });

  function externalDef(marker: { started: number; stopped: number }): RecipeDefinition {
    return {
      id: "ext-recipe",
      name: "Ext",
      description: "external",
      slots: [],
      validate: () => {},
      createInstance: () => {
        marker.started++;
        return {
          stop: () => {
            marker.stopped++;
          },
        };
      },
    };
  }

  it("restarts enabled instances with the newly registered definition", () => {
    const v1 = { started: 0, stopped: 0 };
    manager.registerExternal(externalDef(v1));
    const inst = manager.createInstance("ext-recipe", {});
    expect(v1.started).toBe(1);

    // Package update: new definition registered under the same id.
    const v2 = { started: 0, stopped: 0 };
    manager.registerExternal(externalDef(v2));
    const restarted = manager.restartInstancesOfRecipe("ext-recipe");

    expect(restarted).toBe(1);
    expect(v1.stopped).toBe(1); // old closure stopped
    expect(v2.started).toBe(1); // new closure started
    expect(manager.getInstances().find((i) => i.id === inst.id)?.enabled).toBe(true);
  });

  it("leaves disabled instances alone", () => {
    const v1 = { started: 0, stopped: 0 };
    manager.registerExternal(externalDef(v1));
    const inst = manager.createInstance("ext-recipe", {});
    manager.disableInstance(inst.id);
    expect(v1.stopped).toBe(1);

    const v2 = { started: 0, stopped: 0 };
    manager.registerExternal(externalDef(v2));
    const restarted = manager.restartInstancesOfRecipe("ext-recipe");

    expect(restarted).toBe(0);
    expect(v2.started).toBe(0);
  });

  it("returns 0 for an unknown recipe id", () => {
    expect(manager.restartInstancesOfRecipe("nope")).toBe(0);
  });

  it("a failing new definition is logged, not thrown, and other instances still restart", () => {
    const v1 = { started: 0, stopped: 0 };
    manager.registerExternal(externalDef(v1));
    manager.createInstance("ext-recipe", {});
    manager.createInstance("ext-recipe", {});
    expect(v1.started).toBe(2);

    let calls = 0;
    manager.registerExternal({
      id: "ext-recipe",
      name: "Ext",
      description: "external",
      slots: [],
      validate: () => {},
      createInstance: () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return { stop: () => {} };
      },
    });

    const restarted = manager.restartInstancesOfRecipe("ext-recipe");
    expect(restarted).toBe(1); // second instance restarted despite first failing
  });
});

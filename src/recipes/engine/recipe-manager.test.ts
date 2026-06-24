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
import type { RecipeSlotDef, EngineEvent, RecipeDefinition } from "../../shared/types.js";

/** Captures `ctx.helpers.getSunlight()` from a running instance (spec 126). */
let capturedSun: {
  sunrise: string | null;
  sunset: string | null;
  isDaylight: boolean | null;
} | null = null;

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

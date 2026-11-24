import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ZoneManager } from "../../zones/zone-manager.js";
import { applyMigrations } from "../../test-helpers/migrations.js";
import { ZoneAggregator } from "../../zones/zone-aggregator.js";
import { EquipmentManager } from "../../equipments/equipment-manager.js";
import { DeviceManager } from "../../devices/device-manager.js";
import { EventBus } from "../../core/event-bus.js";
import { createLogger } from "../../core/logger.js";
import { RecipeManager, RecipeError } from "./recipe-manager.js";
import { CapacityArbiter } from "../../energy/capacity-arbiter.js";
import { Recipe } from "./recipe.js";
import type { SunlightManager } from "../../zones/sunlight-manager.js";
import type { TariffClassifier } from "../../energy/tariff-classifier.js";
import type { InfluxClient } from "../../core/influx-client.js";
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
 * Read what the recipe captured.
 *
 * `capturedTariff` is assigned inside a recipe callback, which control-flow
 * analysis cannot see, so a direct read narrows to `null` and every property
 * access is typed `never`. Invisible while test files were excluded from the
 * typecheck (#834).
 */
function readCapturedTariff(): RecipeTariff | null {
  return capturedTariff;
}

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
  applyMigrations(db);
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
  // Spec 169 — the tile a recipe declares
  // ============================================================

  it("carries a declared tile into RecipeInfo", () => {
    manager.registerExternal({
      id: "tile-def",
      name: "Tile",
      description: "declares a tile",
      slots: [],
      actions: [
        { id: "set_mode", type: "cycle", stateKey: "mode", options: [{ value: "a", label: "A" }] },
      ],
      tile: { icon: "Truck", countdownKey: "until", actions: ["set_mode"] },
      validate: () => {},
      createInstance: () => ({ stop: () => {} }),
    } satisfies RecipeDefinition);

    expect(manager.getRecipeById("tile-def")?.tile).toEqual({
      icon: "Truck",
      countdownKey: "until",
      actions: ["set_mode"],
    });
  });

  it("leaves the key out entirely when no tile is declared", () => {
    // Absence is the signal the Dashboard reads to know a recipe is not
    // pinnable, so it has to be a missing key, not an explicit undefined.
    manager.registerExternal({
      id: "no-tile-def",
      name: "No tile",
      description: "declares none",
      slots: [],
      validate: () => {},
      createInstance: () => ({ stop: () => {} }),
    } satisfies RecipeDefinition);

    const info = manager.getRecipeById("no-tile-def");
    expect(info).not.toBeNull();
    expect("tile" in info!).toBe(false);
  });

  // ============================================================
  // Spec 198 — the manifest icon
  // ============================================================

  const bareDef = (id: string): RecipeDefinition => ({
    id,
    name: id,
    description: "",
    slots: [],
    validate: () => {},
    createInstance: () => ({ stop: () => {} }),
  });

  it("carries the manifest icon into RecipeInfo", () => {
    manager.registerExternal(bareDef("icon-def"), { icon: "Eye" });
    expect(manager.getRecipes().find((r) => r.id === "icon-def")?.icon).toBe("Eye");
  });

  it("leaves the icon key out when the manifest declares none", () => {
    manager.registerExternal(bareDef("no-meta"));
    manager.registerExternal(bareDef("empty-icon"), { icon: "" });
    expect("icon" in manager.getRecipeById("no-meta")!).toBe(false);
    expect("icon" in manager.getRecipeById("empty-icon")!).toBe(false);
  });

  // ============================================================
  // Spec 214 — a recipe publishes data on an equipment
  // ============================================================

  describe("publishing data on an equipment (spec 214)", () => {
    const RUN_STATES = ["off", "ready", "running", "finished"];
    let publishFromStart: unknown;
    let lastPublish: ((value: unknown) => unknown) | null;

    function cycleDef(id = "cycle"): RecipeDefinition {
      return {
        id,
        name: "Appliance cycle",
        description: "",
        slots: [
          { id: "equipment", name: "Machine", description: "", type: "equipment", required: true },
        ],
        publishes: [
          {
            slot: "equipment",
            alias: "state",
            type: "enum",
            category: "appliance_state",
            enumValues: RUN_STATES,
          },
        ],
        validate: () => {},
        createInstance: (params, ctx) => {
          const eq = params.equipment as string;
          lastPublish = (value) => ctx.helpers.equipmentData.publish(eq, "state", value);
          if (publishFromStart !== undefined) lastPublish(publishFromStart);
          return { stop: () => {} };
        },
      };
    }

    function washer(withDeviceState = false): string {
      const zone = zoneManager.create({ name: "Buanderie" });
      const eq = equipmentManager.create({
        name: "Lave-linge",
        type: "appliance",
        zoneId: zone.id,
      });
      if (withDeviceState) {
        const deviceId = crypto.randomUUID();
        const dataId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
           VALUES (?, 'z/w', 'w', 'Washer', 'zigbee2mqtt', 'online', 'zigbee2mqtt', 'w')`,
        ).run(deviceId);
        db.prepare(
          `INSERT INTO device_data (id, device_id, key, type, category, value) VALUES (?, ?, 'state', 'enum', 'appliance_state', '"run"')`,
        ).run(dataId, deviceId);
        equipmentManager.addDataBinding(eq.id, dataId, "state");
      }
      return eq.id;
    }

    const stateOf = (equipmentId: string) =>
      equipmentManager.getDataBindingsWithValues(equipmentId).find((b) => b.alias === "state");

    beforeEach(() => {
      publishFromStart = undefined;
      lastPublish = null;
    });

    it("refuses a declaration on a slot that is not an equipment slot", () => {
      expect(() =>
        manager.registerExternal({
          ...cycleDef("bad"),
          publishes: [{ ...cycleDef().publishes![0]!, slot: "delay" }],
        }),
      ).toThrow(/not an equipment slot/);
      expect(manager.getRecipeById("bad")).toBeNull();
    });

    it("carries the declaration into RecipeInfo", () => {
      manager.registerExternal(cycleDef());
      expect(manager.getRecipeById("cycle")?.publishes?.[0]?.alias).toBe("state");
    });

    it("shows the published value as a binding of the equipment", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      publishFromStart = "ready";
      const instance = manager.createInstance("cycle", { equipment: eqId });
      expect(stateOf(eqId)).toMatchObject({
        id: `virtual:recipe:${instance.id}:state`,
        value: "ready",
        enumValues: RUN_STATES,
        deviceName: "Appliance cycle",
      });
      events = [];
      expect(lastPublish!("running")).toEqual({ ok: true });
      const changes = events.filter(
        (e) => e.type === "equipment.data.changed" && e.alias === "state",
      );
      expect(changes).toHaveLength(1);
      expect(lastPublish!("spinning")).toMatchObject({ ok: false });
    });

    it("refuses an instance over a device-bound alias", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer(true);
      expect(() => manager.createInstance("cycle", { equipment: eqId })).toThrow(RecipeError);
      expect(() => manager.createInstance("cycle", { equipment: eqId })).toThrow(/from a device/);
    });

    it("refuses a second instance publishing the same alias", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      manager.createInstance("cycle", { equipment: eqId });
      expect(() => manager.createInstance("cycle", { equipment: eqId })).toThrow(/already gets/);
    });

    it("removes the binding when the instance stops, and moves it on update", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      const other = washer();
      const instance = manager.createInstance("cycle", { equipment: eqId });
      expect(stateOf(eqId)).toBeDefined();
      manager.updateInstance(instance.id, { equipment: other });
      expect(stateOf(eqId)).toBeUndefined();
      expect(stateOf(other)).toBeDefined();
      manager.disableInstance(instance.id);
      expect(stateOf(other)).toBeUndefined();
    });

    it("leaves nothing behind when start throws", () => {
      manager.registerExternal({
        ...cycleDef("boom"),
        createInstance: () => {
          throw new Error("boom");
        },
      });
      const eqId = washer();
      manager.createInstance("boom", { equipment: eqId });
      expect(stateOf(eqId)).toBeUndefined();
    });

    it("removes the binding when the instance is deleted", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      const instance = manager.createInstance("cycle", { equipment: eqId });
      manager.deleteInstance(instance.id);
      expect(stateOf(eqId)).toBeUndefined();
    });

    it("publishes on every equipment of a list slot", () => {
      const def = cycleDef("list");
      def.slots[0] = { ...def.slots[0]!, list: true };
      manager.registerExternal(def);
      const a = washer();
      const b = washer();
      manager.createInstance("list", { equipment: [a, b] });
      expect(stateOf(a)?.value).toBeNull();
      expect(stateOf(b)?.value).toBeNull();
    });

    it("refuses to enable an instance over an alias an enabled instance publishes", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      const first = manager.createInstance("cycle", { equipment: eqId });
      manager.disableInstance(first.id);
      manager.createInstance("cycle", { equipment: eqId });
      expect(() => manager.enableInstance(first.id)).toThrow(/already gets/);
      expect(manager.getInstances().find((i) => i.id === first.id)?.enabled).toBe(false);
    });

    it("refuses an instance over an alias an enabled but stopped instance publishes", () => {
      manager.registerExternal({
        ...cycleDef("broken"),
        createInstance: () => {
          throw new Error("start fails");
        },
      });
      manager.registerExternal(cycleDef());
      const eqId = washer();
      manager.createInstance("broken", { equipment: eqId }); // enabled, not running
      expect(() => manager.createInstance("cycle", { equipment: eqId })).toThrow(/already gets/);
    });

    it("denies a closure left over from an earlier start of the same instance", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      const instance = manager.createInstance("cycle", { equipment: eqId });
      const oldPublish = lastPublish!;
      manager.restartInstancesOfRecipe("cycle");
      expect(stateOf(eqId)?.value).toBeNull(); // back, null until the new start publishes
      expect(oldPublish("running")).toMatchObject({ ok: false });
      expect(lastPublish!("running")).toEqual({ ok: true });
      expect(stateOf(eqId)?.id).toBe(`virtual:recipe:${instance.id}:state`);
    });

    it("refuses an alias the core derives on the equipment (a gate's state)", () => {
      manager.registerExternal(cycleDef());
      const zone = zoneManager.create({ name: "Allée" });
      const gate = equipmentManager.create({ name: "Portail", type: "gate", zoneId: zone.id });
      expect(() => manager.createInstance("cycle", { equipment: gate.id })).toThrow(
        /derives "state" itself/,
      );
    });

    it("clears the last value for live consumers when the instance stops", () => {
      manager.registerExternal(cycleDef());
      const eqId = washer();
      publishFromStart = "running";
      const instance = manager.createInstance("cycle", { equipment: eqId });
      events = [];
      manager.disableInstance(instance.id);
      const cleared = events.filter(
        (e) => e.type === "equipment.data.changed" && e.alias === "state",
      );
      expect(cleared).toHaveLength(1);
      expect(cleared[0]).toMatchObject({ value: null, previous: "running" });
    });

    it("publishes nothing from the validation context", () => {
      let fromValidate: unknown;
      manager.registerExternal({
        ...cycleDef("probe"),
        validate: (params, ctx) => {
          fromValidate = ctx.helpers.equipmentData.publish(params.equipment, "state", "ready");
        },
      });
      const eqId = washer();
      manager.createInstance("probe", { equipment: eqId });
      expect(fromValidate).toMatchObject({ ok: false });
    });
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

    expect(readCapturedTariff()?.configured).toBe(true);
    // Only HC slots, and only the schedule covering today.
    expect(readCapturedTariff()?.offPeakToday).toEqual([
      { start: "22:00", end: "06:00", tariff: "hc" },
    ]);
    // Prices are commercial data and must never reach a recipe package.
    expect(readCapturedTariff()).not.toHaveProperty("prices");
    expect(JSON.stringify(readCapturedTariff())).not.toContain("0.2516");
    expect(JSON.stringify(readCapturedTariff())).not.toContain("0.2068");
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

    expect(readCapturedTariff()?.isOffPeakNow).toBe(true);
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
    expect(readCapturedTariff()?.offPeakToday).toEqual([
      { start: "22:00", end: "06:00", tariff: "hc" },
    ]);
  });

  it("exposes the off-peak slots of today's season (spec 204)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 2026-07-15 is a Wednesday, in the default summer.
      vi.setSystemTime(new Date("2026-07-15T13:00:00"));
      const allDays = [0, 1, 2, 3, 4, 5, 6];
      tariffConfig = {
        schedules: [{ days: allDays, slots: [{ start: "22:00", end: "06:00", tariff: "hc" }] }],
        summer: {
          from: "04-01",
          to: "10-31",
          schedules: [
            {
              days: allDays,
              slots: [
                { start: "02:00", end: "06:00", tariff: "hc" },
                { start: "12:00", end: "15:00", tariff: "hc" },
                { start: "15:00", end: "02:00", tariff: "hp" },
              ],
            },
          ],
        },
        prices: { hp: 0.25, hc: 0.2 },
      };
      registerTariffProbe("tariff-summer");
      capturedTariff = null;
      manager.createInstance("tariff-summer", {});
      expect(readCapturedTariff()?.offPeakToday).toEqual([
        { start: "02:00", end: "06:00", tariff: "hc" },
        { start: "12:00", end: "15:00", tariff: "hc" },
      ]);
      expect(readCapturedTariff()?.isOffPeakNow).toBe(true);

      // The same config in January reads the winter schedule.
      vi.setSystemTime(new Date("2026-01-15T13:00:00"));
      capturedTariff = null;
      manager.createInstance("tariff-summer", {});
      expect(readCapturedTariff()?.offPeakToday).toEqual([
        { start: "22:00", end: "06:00", tariff: "hc" },
      ]);
      expect(readCapturedTariff()?.isOffPeakNow).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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

  // Issue #1122 — the activity feed showed every disable/enable twice.
  it("disable then enable emits exactly one stopped and one started", () => {
    manager.register(TestRecipe);
    const instance = manager.createInstance("test-recipe", { value: 1 });
    events.length = 0;

    manager.disableInstance(instance.id);
    manager.enableInstance(instance.id);

    const lifecycle = events
      .filter((e) => e.type === "recipe.instance.started" || e.type === "recipe.instance.stopped")
      .map((e) => e.type);
    expect(lifecycle).toEqual(["recipe.instance.stopped", "recipe.instance.started"]);
  });

  it("enabling an instance whose start throws announces a state change, not a start", () => {
    let failing = false;
    class FlakyRecipe extends TestRecipe {
      override start(params: Record<string, unknown>): void {
        if (failing) throw new Error("boom");
        super.start(params);
      }
    }
    manager.register(FlakyRecipe);
    const instance = manager.createInstance("test-recipe", { value: 1 });
    manager.disableInstance(instance.id);
    failing = true;
    events.length = 0;

    manager.enableInstance(instance.id);

    expect(events.some((e) => e.type === "recipe.instance.started")).toBe(false);
    expect(
      events.some(
        (e) => e.type === "recipe.instance.state.changed" && e.instanceId === instance.id,
      ),
    ).toBe(true);
  });

  it("disabling an enabled instance that is not running announces a state change, not a stop", () => {
    manager.register(TestRecipe);
    const instance = manager.createInstance("test-recipe", { value: 1 });
    manager.stopAll(); // runner gone, DB row still enabled
    events.length = 0;

    manager.disableInstance(instance.id);

    expect(events.some((e) => e.type === "recipe.instance.stopped")).toBe(false);
    expect(
      events.some(
        (e) => e.type === "recipe.instance.state.changed" && e.instanceId === instance.id,
      ),
    ).toBe(true);
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

// ============================================================
// Spec 140 — ctx.helpers.energy wiring (review finding H2: the
// stopInstance → releaseAllFor path was previously untested because
// every RecipeManager in this file was built with a null arbiter).
// ============================================================

describe("RecipeManager × CapacityArbiter (spec 140)", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let equipmentManager: EquipmentManager;
  let arbiter: CapacityArbiter;
  let manager: RecipeManager;
  let pumpId: string;

  function setup(opts: { withArbiter: boolean }): void {
    db = createTestDb();
    eventBus = new EventBus(logger);
    const zoneManager = new ZoneManager(db, eventBus, logger);
    const deviceManager = new DeviceManager(db, eventBus, logger);
    equipmentManager = new EquipmentManager(
      db,
      eventBus,
      { getById: () => undefined } as never,
      deviceManager,
      logger,
    );
    const aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
    const sunlightManager = {
      getSunlightData: () => ({ sunrise: "07:30", sunset: "21:00", isDaylight: true }),
    } as unknown as SunlightManager;

    const zone = zoneManager.create({ name: "Piscine" });
    const pump = equipmentManager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id });
    pumpId = pump.id;
    equipmentManager.update(pumpId, {
      energyProfile: { class: "deferrable", nominalPowerW: 600, minOnS: 0, minOffS: 0 },
    });

    const settingsMap = new Map<string, string>([
      ["energy.arbiter.enabled", "true"],
      ["energy.arbiter.priority", JSON.stringify([pumpId])],
    ]);
    const settings = {
      get: (k: string) => settingsMap.get(k),
      set: (k: string, v: string) => settingsMap.set(k, v),
    } as never;
    arbiter = new CapacityArbiter(eventBus, settings, equipmentManager, logger);
    arbiter.start();

    manager = new RecipeManager(
      db,
      eventBus,
      equipmentManager,
      zoneManager,
      aggregator,
      sunlightManager,
      tariffClassifier,
      logger,
      false,
      opts.withArbiter ? arbiter : null,
    );
  }

  afterEach(() => {
    manager.stopAll();
    arbiter.stop();
    db.close();
  });

  /** Recipe whose instance claims capacity for the pump on start. */
  function registerClaimer(id: string, onDenied?: (reason: string | undefined) => void): void {
    manager.registerExternal({
      id,
      name: id,
      description: "claims capacity",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        const handle = ctx.helpers.energy.claimCapacity({
          equipmentId: pumpId,
          onGranted: () => {},
          onRevoked: () => {},
        });
        onDenied?.(handle.deniedReason);
        return { stop: () => {} };
      },
    } satisfies RecipeDefinition);
  }

  it("auto-releases a recipe's claim when the instance is stopped", () => {
    setup({ withArbiter: true });
    registerClaimer("claimer");
    const instance = manager.createInstance("claimer", {});
    // No meter data → the claim is pending, but it is registered.
    expect(arbiter.getPublicState().pending.map((p) => p.equipmentId)).toContain(pumpId);
    manager.deleteInstance(instance.id);
    expect(arbiter.getPublicState().pending).toHaveLength(0);
  });

  it("passes a modulating claim through and exposes budgetW() (spec 185)", () => {
    setup({ withArbiter: true });
    let budgetOf: (() => number | null) | undefined;
    manager.registerExternal({
      id: "modulator",
      name: "modulator",
      description: "modulating claim",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        const handle = ctx.helpers.energy.claimCapacity({
          equipmentId: pumpId,
          modulation: { minW: 300, maxW: 600, stepW: 100 },
          onGranted: () => {},
          onRevoked: () => {},
          onBudget: () => {},
        });
        budgetOf = handle.budgetW;
        return { stop: () => {} };
      },
    } satisfies RecipeDefinition);
    manager.createInstance("modulator", {});
    const pending = arbiter.getPublicState().loads.find((l) => l.equipmentId === pumpId);
    expect(pending?.modulation).toEqual({ minW: 300, maxW: 600, stepW: 100 });
    expect(budgetOf?.()).toBeNull(); // pending: no budget yet
  });

  it("the no-arbiter stub answers budgetW() with null", () => {
    setup({ withArbiter: false });
    let budget: number | null | undefined = 0;
    manager.registerExternal({
      id: "modulator-null",
      name: "modulator-null",
      description: "modulating claim without arbiter",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        budget = ctx.helpers.energy
          .claimCapacity({
            equipmentId: pumpId,
            modulation: { minW: 300, maxW: 600, stepW: 100 },
            onGranted: () => {},
            onRevoked: () => {},
          })
          .budgetW?.();
        return { stop: () => {} };
      },
    } satisfies RecipeDefinition);
    manager.createInstance("modulator-null", {});
    expect(budget).toBeNull();
  });

  it("denies the claim with arbiter-disabled when no arbiter is wired", () => {
    setup({ withArbiter: false });
    let denied: string | undefined = "unset";
    registerClaimer("claimer-null", (r) => {
      denied = r;
    });
    manager.createInstance("claimer-null", {});
    expect(denied).toBe("arbiter-disabled");
  });

  it("does not leak a claim when a recipe claims then throws during start", () => {
    setup({ withArbiter: true });
    // First recipe claims the pump, then throws → the claim must be released,
    // not leaked (which would block the equipment until restart).
    manager.registerExternal({
      id: "thrower",
      name: "thrower",
      description: "claims then throws",
      slots: [],
      validate: () => {},
      createInstance: (_params, ctx) => {
        ctx.helpers.energy.claimCapacity({
          equipmentId: pumpId,
          onGranted: () => {},
          onRevoked: () => {},
        });
        throw new Error("boom after claim");
      },
    } satisfies RecipeDefinition);
    manager.createInstance("thrower", {}); // swallows the start error internally
    expect(arbiter.getPublicState().pending).toHaveLength(0);

    // The equipment is claimable again — proof the claim did not leak.
    let denied: string | undefined = "unset";
    registerClaimer("claimer-after", (r) => {
      denied = r;
    });
    manager.createInstance("claimer-after", {});
    expect(denied).toBeUndefined();
    expect(arbiter.getPublicState().pending.map((p) => p.equipmentId)).toContain(pumpId);
  });
});

// ============================================================
// Spec 211 — ctx.helpers.history wiring
// ============================================================

describe("RecipeManager × ctx.helpers.history (spec 211)", () => {
  let db: Database.Database;
  let manager: RecipeManager;
  let thermoId: string;

  const fakeInflux = {
    isConnected: () => true,
    getConfig: () => ({ org: "o", bucket: "sowel" }),
    getClient: () => ({
      getQueryApi: () => ({
        iterateRows: () => ({ async *[Symbol.asyncIterator]() {} }),
      }),
    }),
  } as unknown as InfluxClient;

  function setup(influx: InfluxClient | null): void {
    db = createTestDb();
    const eventBus = new EventBus(logger);
    const zoneManager = new ZoneManager(db, eventBus, logger);
    const deviceManager = new DeviceManager(db, eventBus, logger);
    const equipmentManager = new EquipmentManager(
      db,
      eventBus,
      { getById: () => undefined } as never,
      deviceManager,
      logger,
    );
    const aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
    const sunlightManager = {
      getSunlightData: () => ({ sunrise: null, sunset: null, isDaylight: null }),
    } as unknown as SunlightManager;

    const zone = zoneManager.create({ name: "Séjour" });
    thermoId = equipmentManager.create({ name: "Thermo", type: "sensor", zoneId: zone.id }).id;
    const deviceId = "dev-thermo";
    db.prepare(
      `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
       VALUES (?, 'z2m/t', 'T', 'T', 'zigbee2mqtt', 'online', 'zigbee2mqtt', 'T')`,
    ).run(deviceId);
    db.prepare(
      `INSERT INTO device_data (id, device_id, key, type, category) VALUES ('dd-t', ?, 'temperature', 'number', 'temperature')`,
    ).run(deviceId);
    equipmentManager.addDataBinding(thermoId, "dd-t", "temperature");

    manager = new RecipeManager(
      db,
      eventBus,
      equipmentManager,
      zoneManager,
      aggregator,
      sunlightManager,
      tariffClassifier,
      logger,
      false,
      null,
      influx,
    );
  }

  afterEach(() => {
    manager.stopAll();
    db.close();
  });

  /** Records the history helper each context received, validate's first. */
  function registerReader(seen: { validate: unknown[]; instance: unknown[] }): void {
    manager.registerExternal({
      id: "reader",
      name: "reader",
      description: "reads history",
      slots: [],
      validate: (_params, ctx) => {
        seen.validate.push(ctx.helpers.history);
      },
      createInstance: (_params, ctx) => {
        seen.instance.push(ctx.helpers.history);
        return { stop: () => {} };
      },
    } satisfies RecipeDefinition);
  }

  it("without an Influx client, ctx.helpers.history is absent", () => {
    setup(null);
    const seen = { validate: [] as unknown[], instance: [] as unknown[] };
    registerReader(seen);
    manager.createInstance("reader", {});
    expect(seen.instance[0]).toBeUndefined();
  });

  it("with an Influx client, ctx.helpers.history.query is a function", () => {
    setup(fakeInflux);
    const seen = { validate: [] as unknown[], instance: [] as unknown[] };
    registerReader(seen);
    manager.createInstance("reader", {});
    expect(typeof (seen.instance[0] as { query: unknown }).query).toBe("function");
  });

  it("the validate() temporary context has its own counter: draining it leaves the instance's budget", async () => {
    setup(fakeInflux);
    const seen = { validate: [] as unknown[], instance: [] as unknown[] };
    registerReader(seen);
    manager.createInstance("reader", {});
    type H = { query: (p: unknown) => Promise<unknown> };
    const tmp = seen.validate[0] as H;
    const inst = seen.instance[0] as H;
    expect(tmp).not.toBe(inst);

    const q = { equipmentId: thermoId, alias: "temperature", from: "-24h", aggregation: "1h" };
    for (let i = 0; i < 10; i++) await tmp.query(q);
    await expect(tmp.query(q)).rejects.toThrow("history rate limit");
    await expect(inst.query(q)).resolves.toEqual({ points: [], ok: true });
  });

  it("a stopped instance's leftover helper reads nothing (bound to its start)", async () => {
    setup(fakeInflux);
    const seen = { validate: [] as unknown[], instance: [] as unknown[] };
    registerReader(seen);
    const instance = manager.createInstance("reader", {});
    const inst = seen.instance[0] as { query: (p: unknown) => Promise<unknown> };
    const q = { equipmentId: thermoId, alias: "temperature", from: "-24h", aggregation: "1h" };
    await expect(inst.query(q)).resolves.toEqual({ points: [], ok: true });

    manager.deleteInstance(instance.id);
    await expect(inst.query(q)).resolves.toEqual({ points: [], ok: false });
  });
});

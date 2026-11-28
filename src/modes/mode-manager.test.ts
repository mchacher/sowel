import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { ModeManager, ModeError } from "./mode-manager.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

const logger = createLogger("silent").logger;

// Minimal mocks for EquipmentManager and RecipeManager
function createMockEquipmentManager() {
  return {
    executeOrder: vi.fn(),
    getById: vi.fn().mockReturnValue({ name: "Mock Equipment" }),
  } as any;
}

function createMockRecipeManager() {
  return {
    enableInstance: vi.fn(),
    disableInstance: vi.fn(),
    updateInstanceParams: vi.fn(),
  } as any;
}

describe("ModeManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let equipmentManager: ReturnType<typeof createMockEquipmentManager>;
  let recipeManager: ReturnType<typeof createMockRecipeManager>;
  let manager: ModeManager;
  let events: EngineEvent[];

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    equipmentManager = createMockEquipmentManager();
    recipeManager = createMockRecipeManager();
    manager = new ModeManager(db, eventBus, equipmentManager, recipeManager, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ── CRUD ─────────────────────────────────────────────────────

  describe("CRUD", () => {
    it("creates a mode", () => {
      const mode = manager.createMode("Cocoon");
      expect(mode.name).toBe("Cocoon");
      expect(mode.active).toBe(false);
      expect(mode.id).toBeTruthy();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "mode.created",
          mode: expect.objectContaining({ name: "Cocoon" }),
        }),
      );
    });

    it("creates a mode with description and icon", () => {
      const mode = manager.createMode("Night", "moon", "Nighttime mode");
      expect(mode.name).toBe("Night");
      expect(mode.icon).toBe("moon");
      expect(mode.description).toBe("Nighttime mode");
    });

    it("lists modes sorted by name", () => {
      manager.createMode("Zebra");
      manager.createMode("Alpha");
      const modes = manager.listModes();
      expect(modes).toHaveLength(2);
      expect(modes[0].name).toBe("Alpha");
      expect(modes[1].name).toBe("Zebra");
    });

    it("gets a mode by id", () => {
      const created = manager.createMode("Test");
      const found = manager.getMode(created.id);
      expect(found).toBeTruthy();
      expect(found!.name).toBe("Test");
    });

    it("returns null for unknown mode", () => {
      expect(manager.getMode("non-existent")).toBeNull();
    });

    it("updates a mode", () => {
      const created = manager.createMode("Old Name");
      const updated = manager.updateMode(created.id, { name: "New Name", description: "desc" });
      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("desc");
      expect(events).toContainEqual(expect.objectContaining({ type: "mode.updated" }));
    });

    it("throws when updating a non-existent mode", () => {
      expect(() => manager.updateMode("nope", { name: "x" })).toThrow(ModeError);
    });

    it("deletes a mode", () => {
      const created = manager.createMode("ToDelete");
      manager.deleteMode(created.id);
      expect(manager.getMode(created.id)).toBeNull();
      expect(events).toContainEqual(
        expect.objectContaining({ type: "mode.removed", modeId: created.id }),
      );
    });

    it("throws when deleting a non-existent mode", () => {
      expect(() => manager.deleteMode("nope")).toThrow(ModeError);
    });
  });

  // ── Activation / Deactivation ──────────────────────────────

  describe("activation", () => {
    it("activates a mode", () => {
      const mode = manager.createMode("Test");
      manager.activateMode(mode.id);
      const activated = manager.getMode(mode.id)!;
      expect(activated.active).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "mode.activated", modeId: mode.id }),
      );
    });

    it("skips activation if already active", () => {
      const mode = manager.createMode("Test");
      manager.activateMode(mode.id);
      events.length = 0;
      manager.activateMode(mode.id);
      expect(events.filter((e) => e.type === "mode.activated")).toHaveLength(0);
    });

    it("deactivates a mode", () => {
      const mode = manager.createMode("Test");
      manager.activateMode(mode.id);
      manager.deactivateMode(mode.id);
      const deactivated = manager.getMode(mode.id)!;
      expect(deactivated.active).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ type: "mode.deactivated", modeId: mode.id }),
      );
    });

    it("skips deactivation if already inactive", () => {
      const mode = manager.createMode("Test");
      events.length = 0;
      manager.deactivateMode(mode.id);
      expect(events.filter((e) => e.type === "mode.deactivated")).toHaveLength(0);
    });

    it("throws when activating a non-existent mode", () => {
      expect(() => manager.activateMode("nope")).toThrow(ModeError);
    });

    it("throws when deactivating a non-existent mode", () => {
      expect(() => manager.deactivateMode("nope")).toThrow(ModeError);
    });

    it("allows multiple modes to be active simultaneously", () => {
      const m1 = manager.createMode("Mode A");
      const m2 = manager.createMode("Mode B");
      manager.activateMode(m1.id);
      manager.activateMode(m2.id);
      expect(manager.getMode(m1.id)!.active).toBe(true);
      expect(manager.getMode(m2.id)!.active).toBe(true);
    });
  });

  // ── Zone Impacts ───────────────────────────────────────────

  describe("zone impacts", () => {
    let modeId: string;
    const zoneId = "zone-1";

    beforeEach(() => {
      // Insert a zone row for FK
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");
      modeId = manager.createMode("Impact Test").id;
    });

    it("sets a zone impact", () => {
      const impact = manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      expect(impact.modeId).toBe(modeId);
      expect(impact.zoneId).toBe(zoneId);
      expect(impact.actions).toHaveLength(1);
    });

    it("upserts a zone impact (replaces actions)", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "OFF" },
        { type: "order", equipmentId: "eq-2", orderAlias: "state", value: "ON" },
      ]);
      const impacts = manager.getImpactsByMode(modeId);
      expect(impacts).toHaveLength(1);
      expect(impacts[0].actions).toHaveLength(2);
      // ZoneModeImpactAction is a union and only the `order` variant carries
      // a value; asserting on it unnarrowed was reading a property the type
      // does not have on every branch (#834).
      const action = impacts[0].actions[0];
      expect(action.type).toBe("order");
      if (action.type !== "order") throw new Error("expected an order action");
      expect(action.value).toBe("OFF");
    });

    it("removes a zone impact", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      manager.removeZoneImpact(modeId, zoneId);
      expect(manager.getImpactsByMode(modeId)).toHaveLength(0);
    });

    it("gets impacts by zone", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      const impacts = manager.getImpactsByZone(zoneId);
      expect(impacts).toHaveLength(1);
      expect(impacts[0].modeId).toBe(modeId);
    });

    it("throws when setting impact on non-existent mode", () => {
      expect(() => manager.setZoneImpact("nope", zoneId, [])).toThrow(ModeError);
    });

    it("executes order impacts on activation", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      manager.activateMode(modeId);
      expect(equipmentManager.executeOrder).toHaveBeenCalledWith(
        "eq-1",
        "state",
        "ON",
        expect.objectContaining({ kind: "mode", modeId, modeName: expect.any(String) }),
      );
    });

    it("executes recipe_toggle impacts on activation", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "recipe_toggle", instanceId: "inst-1", enabled: false },
      ]);
      manager.activateMode(modeId);
      expect(recipeManager.disableInstance).toHaveBeenCalledWith("inst-1");
    });

    it("executes recipe_params impacts on activation", () => {
      manager.setZoneImpact(modeId, zoneId, [
        { type: "recipe_params", instanceId: "inst-1", params: { threshold: 22 } },
      ]);
      manager.activateMode(modeId);
      expect(recipeManager.updateInstanceParams).toHaveBeenCalledWith("inst-1", { threshold: 22 });
    });
  });

  // ── Apply to Zone (local) ──────────────────────────────────

  describe("applyModeToZone", () => {
    let modeId: string;
    const zone1 = "zone-1";
    const zone2 = "zone-2";

    beforeEach(() => {
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zone1, "Salon");
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zone2, "Chambre");
      modeId = manager.createMode("Local Test").id;
      manager.setZoneImpact(modeId, zone1, [
        { type: "order", equipmentId: "eq-1", orderAlias: "state", value: "ON" },
      ]);
      manager.setZoneImpact(modeId, zone2, [
        { type: "order", equipmentId: "eq-2", orderAlias: "state", value: "OFF" },
      ]);
    });

    it("executes only the zone-specific impacts", () => {
      manager.applyModeToZone(modeId, zone1);
      expect(equipmentManager.executeOrder).toHaveBeenCalledWith(
        "eq-1",
        "state",
        "ON",
        expect.objectContaining({ kind: "mode", modeId }),
      );
      expect(equipmentManager.executeOrder).not.toHaveBeenCalledWith(
        "eq-2",
        "state",
        "OFF",
        expect.anything(),
      );
    });

    it("does not change mode active status", () => {
      manager.applyModeToZone(modeId, zone1);
      expect(manager.getMode(modeId)!.active).toBe(false);
    });

    it("throws when no impacts for zone", () => {
      expect(() => manager.applyModeToZone(modeId, "zone-unknown")).toThrow(ModeError);
    });

    it("throws for non-existent mode", () => {
      expect(() => manager.applyModeToZone("nope", zone1)).toThrow(ModeError);
    });
  });

  // ── ModeWithDetails ────────────────────────────────────────

  describe("getModeWithDetails", () => {
    it("returns mode with impacts", () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");

      const mode = manager.createMode("Full", "sun", "Full detail");
      manager.setZoneImpact(mode.id, zoneId, [
        { type: "order", equipmentId: "eq-2", orderAlias: "state", value: "ON" },
      ]);

      const details = manager.getModeWithDetails(mode.id);
      expect(details).toBeTruthy();
      expect(details!.name).toBe("Full");
      expect(details!.impacts).toHaveLength(1);
      expect(details!.impacts[0].actions).toHaveLength(1);
    });

    it("returns null for unknown mode", () => {
      expect(manager.getModeWithDetails("nope")).toBeNull();
    });
  });

  // ── Cascade delete ─────────────────────────────────────────

  describe("cascade delete", () => {
    it("deletes impacts when mode is deleted", () => {
      const zoneId = "zone-1";
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run(zoneId, "Salon");

      const mode = manager.createMode("ToDelete");
      manager.setZoneImpact(mode.id, zoneId, [
        { type: "order", equipmentId: "eq-2", orderAlias: "state", value: "ON" },
      ]);

      manager.deleteMode(mode.id);

      const impacts = db.prepare("SELECT * FROM zone_mode_impacts WHERE mode_id = ?").all(mode.id);
      expect(impacts).toHaveLength(0);
    });
  });

  // ── Groups (spec 219) ──────────────────────────────────────

  describe("groups", () => {
    const setActivatedAt = (id: string, iso: string) =>
      db.prepare("UPDATE modes SET activated_at = ? WHERE id = ?").run(iso, id);

    it("stores a trimmed group on create, none when blank", () => {
      expect(manager.createMode("Home", undefined, undefined, "  Presence ").group).toBe(
        "Presence",
      );
      expect(manager.createMode("Night", undefined, undefined, "   ").group).toBeUndefined();
      expect(manager.createMode("Guests").group).toBeUndefined();
    });

    it("rejects a group longer than 50 characters", () => {
      expect(() => manager.createMode("Home", undefined, undefined, "x".repeat(51))).toThrow(
        ModeError,
      );
    });

    it("changes, clears or keeps the group on update", () => {
      const mode = manager.createMode("Home", undefined, undefined, "Presence");
      expect(manager.updateMode(mode.id, { group: "Heating" }).group).toBe("Heating");
      expect(manager.updateMode(mode.id, { name: "House" }).group).toBe("Heating");
      expect(manager.updateMode(mode.id, { group: null }).group).toBeUndefined();
    });

    it("deactivates the active sibling before activating, impacts of the new mode only", () => {
      db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run("zone-1", "Salon");
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      const away = manager.createMode("Away", undefined, undefined, "Presence");
      manager.setZoneImpact(home.id, "zone-1", [
        { type: "order", equipmentId: "eq-home", orderAlias: "state", value: "ON" },
      ]);
      manager.setZoneImpact(away.id, "zone-1", [
        { type: "order", equipmentId: "eq-away", orderAlias: "state", value: "OFF" },
      ]);
      equipmentManager.executeOrder.mockResolvedValue({ success: true });
      manager.activateMode(home.id);
      equipmentManager.executeOrder.mockClear();
      events.length = 0;

      manager.activateMode(away.id);

      expect(manager.getMode(home.id)!.active).toBe(false);
      expect(manager.getMode(away.id)!.active).toBe(true);
      expect(events.map((e) => e.type)).toEqual(["mode.deactivated", "mode.activated"]);
      expect(events[0]).toMatchObject({ modeId: home.id });
      expect(equipmentManager.executeOrder).toHaveBeenCalledTimes(1);
      expect(equipmentManager.executeOrder.mock.calls[0][0]).toBe("eq-away");
    });

    it("leaves other groups and ungrouped modes untouched", () => {
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      const away = manager.createMode("Away", undefined, undefined, "Presence");
      const comfort = manager.createMode("Comfort", undefined, undefined, "Heating");
      const night = manager.createMode("Night");
      manager.activateMode(home.id);
      manager.activateMode(comfort.id);
      manager.activateMode(night.id);

      manager.activateMode(away.id);

      expect(manager.getMode(comfort.id)!.active).toBe(true);
      expect(manager.getMode(night.id)!.active).toBe(true);
      expect(manager.getMode(home.id)!.active).toBe(false);
    });

    it("keeps ungrouped modes cumulative", () => {
      const a = manager.createMode("Night");
      const b = manager.createMode("Guests");
      manager.activateMode(a.id);
      manager.activateMode(b.id);
      expect(manager.listModes().filter((m) => m.active)).toHaveLength(2);
    });

    it("allows a group with no active mode", () => {
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      manager.createMode("Away", undefined, undefined, "Presence");
      manager.activateMode(home.id);
      manager.deactivateMode(home.id);
      expect(manager.listModes().filter((m) => m.active)).toHaveLength(0);
    });

    it("records the activation time", () => {
      const mode = manager.createMode("Home");
      expect(mode.activatedAt).toBeUndefined();
      manager.activateMode(mode.id);
      expect(manager.getMode(mode.id)!.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it("moving an active mode into a group keeps the more recent one", () => {
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      const holidays = manager.createMode("Holidays");
      manager.activateMode(home.id);
      manager.activateMode(holidays.id);
      setActivatedAt(home.id, "2026-11-01T08:00:00.000Z");
      setActivatedAt(holidays.id, "2026-11-20T08:00:00.000Z");
      events.length = 0;

      manager.updateMode(holidays.id, { group: "Presence" });

      expect(manager.getMode(holidays.id)!.active).toBe(true);
      expect(manager.getMode(home.id)!.active).toBe(false);
      expect(events.find((e) => e.type === "mode.deactivated")).toMatchObject({
        modeId: home.id,
      });
    });

    it("moving an active mode into a group with a more recent one deactivates it", () => {
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      const holidays = manager.createMode("Holidays");
      manager.activateMode(home.id);
      manager.activateMode(holidays.id);
      setActivatedAt(home.id, "2026-11-20T08:00:00.000Z");
      setActivatedAt(holidays.id, "2026-11-01T08:00:00.000Z");

      manager.updateMode(holidays.id, { group: "Presence" });

      expect(manager.getMode(holidays.id)!.active).toBe(false);
      expect(manager.getMode(home.id)!.active).toBe(true);
    });

    it("moving an inactive mode into a group deactivates nothing", () => {
      const home = manager.createMode("Home", undefined, undefined, "Presence");
      const holidays = manager.createMode("Holidays");
      manager.activateMode(home.id);
      events.length = 0;

      manager.updateMode(holidays.id, { group: "Presence" });

      expect(manager.getMode(home.id)!.active).toBe(true);
      expect(events.some((e) => e.type === "mode.deactivated")).toBe(false);
    });
  });
});

describe("migration 047 (spec 219)", () => {
  it("keeps active modes, without a group, activatedAt from their last update", () => {
    const dir = resolve(import.meta.dirname, "../../migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const db = new Database(":memory:");
    for (const file of files.filter((f) => f < "047_")) {
      db.exec(readFileSync(resolve(dir, file), "utf-8"));
    }
    db.prepare(
      "INSERT INTO modes (id, name, active, updated_at) VALUES ('m1', 'Night', 1, '2026-11-02 21:30:00')",
    ).run();
    for (const file of files.filter((f) => f >= "047_")) {
      db.exec(readFileSync(resolve(dir, file), "utf-8"));
    }
    const manager = new ModeManager(
      db,
      new EventBus(logger),
      createMockEquipmentManager(),
      createMockRecipeManager(),
      logger,
    );
    const mode = manager.getMode("m1")!;
    expect(mode.active).toBe(true);
    expect(mode.group).toBeUndefined();
    expect(mode.activatedAt).toBe("2026-11-02T21:30:00.000Z");
    db.close();
  });
});

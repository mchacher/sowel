import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ModeManager, ModeError } from "./mode-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Load required migrations
  for (const file of [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
    "005_device_data_enum_values.sql",
  ]) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", `../../migrations/${file}`),
      "utf-8",
    );
    db.exec(sql);
  }
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
      expect(impacts[0].actions[0].value).toBe("OFF");
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
      expect(equipmentManager.executeOrder).toHaveBeenCalledWith("eq-1", "state", "ON");
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
      expect(equipmentManager.executeOrder).toHaveBeenCalledWith("eq-1", "state", "ON");
      expect(equipmentManager.executeOrder).not.toHaveBeenCalledWith("eq-2", "state", "OFF");
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
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ButtonActionManager } from "./button-action-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of [
    "001_devices.sql",
    "002_zones.sql",
    "003_equipments.sql",
    "010_modes.sql",
    "013_button_action_bindings.sql",
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

function createMockEquipmentManager() {
  return { executeOrder: vi.fn() } as any;
}

function createMockModeManager() {
  return {
    activateMode: vi.fn(),
    deactivateMode: vi.fn(),
    getMode: vi.fn(),
  } as any;
}

function createMockRecipeManager() {
  return {
    enableInstance: vi.fn(),
    disableInstance: vi.fn(),
  } as any;
}

describe("ButtonActionManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let equipmentManager: ReturnType<typeof createMockEquipmentManager>;
  let modeManager: ReturnType<typeof createMockModeManager>;
  let recipeManager: ReturnType<typeof createMockRecipeManager>;
  let manager: ButtonActionManager;

  // Insert a fake equipment for FK constraints
  const eqId = "eq-btn-1";

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    equipmentManager = createMockEquipmentManager();
    modeManager = createMockModeManager();
    recipeManager = createMockRecipeManager();
    manager = new ButtonActionManager(
      db,
      eventBus,
      equipmentManager,
      modeManager,
      recipeManager,
      logger,
    );

    // Insert zone + equipment for FK
    db.prepare("INSERT INTO zones (id, name) VALUES (?, ?)").run("zone-1", "Salon");
    db.prepare(
      "INSERT INTO equipments (id, name, type, zone_id, enabled) VALUES (?, ?, ?, ?, 1)",
    ).run(eqId, "Button Salon", "button", "zone-1");
  });

  afterEach(() => {
    db.close();
  });

  // ── CRUD ──────────────────────────────────────────────────

  describe("CRUD", () => {
    it("adds a binding", () => {
      const binding = manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      expect(binding.id).toBeTruthy();
      expect(binding.equipmentId).toBe(eqId);
      expect(binding.actionValue).toBe("single");
      expect(binding.effectType).toBe("mode_activate");
      expect(binding.config).toEqual({ modeId: "mode-1" });
    });

    it("lists bindings by equipment", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.addBinding(eqId, "double", "equipment_order", {
        equipmentId: "eq-2",
        orderAlias: "state",
        value: "ON",
      });
      const bindings = manager.getBindingsByEquipment(eqId);
      expect(bindings).toHaveLength(2);
    });

    it("removes a binding", () => {
      const binding = manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.removeBinding(binding.id);
      expect(manager.getBindingsByEquipment(eqId)).toHaveLength(0);
    });

    it("updates a binding", () => {
      const binding = manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      const updated = manager.updateBinding(binding.id, "double", "equipment_order", {
        equipmentId: "eq-light-1",
        orderAlias: "state",
        value: "ON",
      });
      expect(updated.id).toBe(binding.id);
      expect(updated.actionValue).toBe("double");
      expect(updated.effectType).toBe("equipment_order");
      expect(updated.config).toEqual({
        equipmentId: "eq-light-1",
        orderAlias: "state",
        value: "ON",
      });
    });

    it("throws when updating non-existent binding", () => {
      expect(() =>
        manager.updateBinding("non-existent", "single", "mode_activate", { modeId: "m1" }),
      ).toThrow("Binding non-existent not found");
    });

    it("returns empty array for equipment with no bindings", () => {
      expect(manager.getBindingsByEquipment("eq-unknown")).toHaveLength(0);
    });
  });

  // ── Effect Execution ──────────────────────────────────────

  describe("mode_activate effect", () => {
    it("activates mode when action matches", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(modeManager.activateMode).toHaveBeenCalledWith("mode-1");
    });

    it("ignores non-matching action value", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "double",
        previous: null,
      });

      expect(modeManager.activateMode).not.toHaveBeenCalled();
    });

    it("ignores non-action alias", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "battery",
        value: "single",
        previous: null,
      });

      expect(modeManager.activateMode).not.toHaveBeenCalled();
    });
  });

  describe("mode_toggle effect", () => {
    it("deactivates A and activates B when A is active", () => {
      manager.addBinding(eqId, "single", "mode_toggle", { modeAId: "mode-a", modeBId: "mode-b" });
      modeManager.getMode.mockImplementation((id: string) =>
        id === "mode-a" ? { id: "mode-a", active: true } : { id: "mode-b", active: false },
      );
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(modeManager.deactivateMode).toHaveBeenCalledWith("mode-a");
      expect(modeManager.activateMode).toHaveBeenCalledWith("mode-b");
    });

    it("deactivates B and activates A when A is inactive", () => {
      manager.addBinding(eqId, "single", "mode_toggle", { modeAId: "mode-a", modeBId: "mode-b" });
      modeManager.getMode.mockImplementation((id: string) =>
        id === "mode-a" ? { id: "mode-a", active: false } : { id: "mode-b", active: true },
      );
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(modeManager.deactivateMode).toHaveBeenCalledWith("mode-b");
      expect(modeManager.activateMode).toHaveBeenCalledWith("mode-a");
    });
  });

  describe("equipment_order effect", () => {
    it("executes order on target equipment", () => {
      manager.addBinding(eqId, "single", "equipment_order", {
        equipmentId: "eq-light-1",
        orderAlias: "state",
        value: "ON",
      });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(equipmentManager.executeOrder).toHaveBeenCalledWith("eq-light-1", "state", "ON");
    });
  });

  describe("recipe_toggle effect", () => {
    it("enables a recipe instance", () => {
      manager.addBinding(eqId, "single", "recipe_toggle", { instanceId: "inst-1", enabled: true });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(recipeManager.enableInstance).toHaveBeenCalledWith("inst-1");
    });

    it("disables a recipe instance", () => {
      manager.addBinding(eqId, "single", "recipe_toggle", { instanceId: "inst-1", enabled: false });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(recipeManager.disableInstance).toHaveBeenCalledWith("inst-1");
    });
  });

  describe("multiple effects per action", () => {
    it("executes all matching bindings for the same action", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      manager.addBinding(eqId, "single", "equipment_order", {
        equipmentId: "eq-light-1",
        orderAlias: "state",
        value: "ON",
      });
      manager.init();

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eqId,
        alias: "action",
        value: "single",
        previous: null,
      });

      expect(modeManager.activateMode).toHaveBeenCalledWith("mode-1");
      expect(equipmentManager.executeOrder).toHaveBeenCalledWith("eq-light-1", "state", "ON");
    });
  });

  describe("cascade delete", () => {
    it("deletes bindings when equipment is deleted", () => {
      manager.addBinding(eqId, "single", "mode_activate", { modeId: "mode-1" });
      expect(manager.getBindingsByEquipment(eqId)).toHaveLength(1);

      db.prepare("DELETE FROM equipments WHERE id = ?").run(eqId);
      expect(manager.getBindingsByEquipment(eqId)).toHaveLength(0);
    });
  });
});

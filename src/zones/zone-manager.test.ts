import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZoneManager, ZoneError } from "./zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const migration1 = readFileSync(
    resolve(import.meta.dirname ?? ".", "../../migrations/001_devices.sql"),
    "utf-8",
  );
  const migration2 = readFileSync(
    resolve(import.meta.dirname ?? ".", "../../migrations/002_zones.sql"),
    "utf-8",
  );
  const migration3 = readFileSync(
    resolve(import.meta.dirname ?? ".", "../../migrations/003_equipments.sql"),
    "utf-8",
  );
  db.exec(migration1);
  db.exec(migration2);
  db.exec(migration3);
  return db;
}

const logger = createLogger("silent");

describe("ZoneManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let manager: ZoneManager;
  let events: EngineEvent[];

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    manager = new ZoneManager(db, eventBus, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Create
  // ============================================================

  describe("create", () => {
    it("creates a root zone", () => {
      const zone = manager.create({ name: "Maison" });

      expect(zone.name).toBe("Maison");
      expect(zone.parentId).toBeNull();
      expect(zone.displayOrder).toBe(0);
      expect(zone.id).toBeDefined();
      expect(zone.createdAt).toBeDefined();
    });

    it("creates a child zone", () => {
      const parent = manager.create({ name: "Maison" });
      const child = manager.create({ name: "Salon", parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
      expect(child.name).toBe("Salon");
    });

    it("emits zone.created event", () => {
      manager.create({ name: "Maison" });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("zone.created");
    });

    it("rejects non-existent parent", () => {
      expect(() => {
        manager.create({ name: "Salon", parentId: "non-existent" });
      }).toThrow(ZoneError);
    });

    it("stores optional fields", () => {
      const zone = manager.create({
        name: "Salon",
        icon: "sofa",
        description: "Pièce principale, 35m²",
        displayOrder: 5,
      });

      expect(zone.icon).toBe("sofa");
      expect(zone.description).toBe("Pièce principale, 35m²");
      expect(zone.displayOrder).toBe(5);
    });
  });

  // ============================================================
  // Read
  // ============================================================

  describe("getById", () => {
    it("returns zone by id", () => {
      const created = manager.create({ name: "Maison" });
      const fetched = manager.getById(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("Maison");
    });

    it("returns null for non-existent id", () => {
      expect(manager.getById("non-existent")).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all zones", () => {
      manager.create({ name: "Maison" });
      manager.create({ name: "Garage" });

      const all = manager.getAll();
      expect(all).toHaveLength(2);
    });

    it("returns empty array when no zones", () => {
      expect(manager.getAll()).toHaveLength(0);
    });
  });

  describe("getTree", () => {
    it("builds tree structure", () => {
      const maison = manager.create({ name: "Maison" });
      const rdc = manager.create({ name: "RDC", parentId: maison.id });
      manager.create({ name: "Salon", parentId: rdc.id });
      manager.create({ name: "Cuisine", parentId: rdc.id });
      const etage = manager.create({ name: "Étage", parentId: maison.id });
      manager.create({ name: "Chambre", parentId: etage.id });

      const tree = manager.getTree();

      expect(tree).toHaveLength(1); // One root: Maison
      expect(tree[0].name).toBe("Maison");
      expect(tree[0].children).toHaveLength(2); // RDC, Étage

      const rdcNode = tree[0].children.find((c) => c.name === "RDC");
      expect(rdcNode).toBeDefined();
      expect(rdcNode!.children).toHaveLength(2); // Salon, Cuisine
    });

    it("handles multiple root zones", () => {
      manager.create({ name: "Maison" });
      manager.create({ name: "Bureau" });

      const tree = manager.getTree();
      expect(tree).toHaveLength(2);
    });
  });

  // ============================================================
  // Update
  // ============================================================

  describe("update", () => {
    it("updates zone name", () => {
      const zone = manager.create({ name: "Salon" });
      const updated = manager.update(zone.id, { name: "Grand Salon" });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Grand Salon");
    });

    it("updates zone parent", () => {
      const maison = manager.create({ name: "Maison" });
      const salon = manager.create({ name: "Salon" });

      const updated = manager.update(salon.id, { parentId: maison.id });
      expect(updated!.parentId).toBe(maison.id);
    });

    it("emits zone.updated event", () => {
      const zone = manager.create({ name: "Salon" });
      events.length = 0; // Clear create event

      manager.update(zone.id, { name: "Grand Salon" });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("zone.updated");
    });

    it("returns null for non-existent zone", () => {
      expect(manager.update("non-existent", { name: "Test" })).toBeNull();
    });

    it("rejects self-parent", () => {
      const zone = manager.create({ name: "Salon" });

      expect(() => {
        manager.update(zone.id, { parentId: zone.id });
      }).toThrow("cannot be its own parent");
    });

    it("rejects circular reference", () => {
      const a = manager.create({ name: "A" });
      const b = manager.create({ name: "B", parentId: a.id });
      const c = manager.create({ name: "C", parentId: b.id });

      // Try to make A a child of C → would create A → B → C → A
      expect(() => {
        manager.update(a.id, { parentId: c.id });
      }).toThrow("circular reference");
    });

    it("allows moving a zone to a valid parent", () => {
      const maison = manager.create({ name: "Maison" });
      const rdc = manager.create({ name: "RDC", parentId: maison.id });
      const etage = manager.create({ name: "Étage", parentId: maison.id });
      const salon = manager.create({ name: "Salon", parentId: rdc.id });

      // Move Salon from RDC to Étage — valid
      const updated = manager.update(salon.id, { parentId: etage.id });
      expect(updated!.parentId).toBe(etage.id);
    });

    it("clears optional fields with null", () => {
      const zone = manager.create({ name: "Salon", icon: "sofa", description: "Test" });

      const updated = manager.update(zone.id, { icon: null, description: null });
      expect(updated!.icon).toBeUndefined();
      expect(updated!.description).toBeUndefined();
    });
  });

  // ============================================================
  // Delete
  // ============================================================

  describe("delete", () => {
    it("deletes a zone", () => {
      const zone = manager.create({ name: "Salon" });
      manager.delete(zone.id);

      expect(manager.getById(zone.id)).toBeNull();
    });

    it("emits zone.removed event", () => {
      const zone = manager.create({ name: "Salon" });
      events.length = 0;

      manager.delete(zone.id);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("zone.removed");
      if (events[0].type === "zone.removed") {
        expect(events[0].zoneName).toBe("Salon");
      }
    });

    it("rejects delete when zone has children", () => {
      const parent = manager.create({ name: "Maison" });
      manager.create({ name: "Salon", parentId: parent.id });

      expect(() => {
        manager.delete(parent.id);
      }).toThrow("child zone");
    });

    it("throws for non-existent zone", () => {
      expect(() => {
        manager.delete("non-existent");
      }).toThrow("not found");
    });
  });
});

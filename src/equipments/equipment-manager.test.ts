import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { EquipmentManager, EquipmentError } from "./equipment-manager.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

const logger = createLogger("silent").logger;

// Helper to seed a device with data and orders
function seedDevice(
  db: Database.Database,
  opts: {
    deviceId?: string;
    name?: string;
    dataKeys?: {
      id?: string;
      key: string;
      type?: string;
      category?: string;
      value?: string;
      enumValues?: string[];
    }[];
    orderKeys?: {
      id?: string;
      key: string;
      type?: string;
      category?: string;
      enumValues?: string[];
      valueOn?: string | number | boolean;
      valueOff?: string | number | boolean;
    }[];
  } = {},
) {
  const deviceId = opts.deviceId ?? crypto.randomUUID();
  const name = opts.name ?? "Test Device";
  db.prepare(
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
     VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online', 'zigbee2mqtt', ?)`,
  ).run(deviceId, `z2m/${name}`, name, name, name);

  const dataIds: string[] = [];
  for (const d of opts.dataKeys ?? []) {
    const id = d.id ?? crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_data (id, device_id, key, type, category, value, enum_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      deviceId,
      d.key,
      d.type ?? "boolean",
      d.category ?? "generic",
      d.value ?? null,
      d.enumValues ? JSON.stringify(d.enumValues) : null,
    );
    dataIds.push(id);
  }

  const orderIds: string[] = [];
  for (const o of opts.orderKeys ?? []) {
    const id = o.id ?? crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_orders (id, device_id, key, type, category, enum_values, value_on, value_off)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      deviceId,
      o.key,
      o.type ?? "boolean",
      o.category ?? null,
      o.enumValues ? JSON.stringify(o.enumValues) : null,
      o.valueOn !== undefined ? JSON.stringify(o.valueOn) : null,
      o.valueOff !== undefined ? JSON.stringify(o.valueOff) : null,
    );
    orderIds.push(id);
  }

  return { deviceId, dataIds, orderIds };
}

describe("EquipmentManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let zoneManager: ZoneManager;
  let manager: EquipmentManager;
  let events: EngineEvent[];
  let mockPublished: { topic: string; payload: string }[];
  let deviceManager: DeviceManager;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    mockPublished = [];
    deviceManager = new DeviceManager(db, eventBus, logger);
    const mockPlugin = {
      id: "zigbee2mqtt",
      getStatus: () => "connected" as const,
      executeOrder: async (_device: any, orderKey: string, value: unknown) => {
        mockPublished.push({
          topic: `z2m/${_device.name}/set`,
          payload: JSON.stringify({ [orderKey]: value }),
        });
      },
    };
    const mockIntegrationRegistry = {
      getById: () => mockPlugin,
      dispatchOrder: async (
        _integrationId: string,
        device: any,
        orderKey: string,
        value: unknown,
      ) => {
        await mockPlugin.executeOrder(device, orderKey, value);
      },
    };
    manager = new EquipmentManager(
      db,
      eventBus,
      mockIntegrationRegistry as any,
      deviceManager,
      logger,
    );
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Energy profile (spec 140)
  // ============================================================

  describe("energy profile", () => {
    it("round-trips the profile through update and the learned writer", () => {
      const zone = zoneManager.create({ name: "Piscine" });
      const eq = manager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id });
      expect(eq.energyProfile).toBeUndefined();

      manager.update(eq.id, {
        energyProfile: { class: "deferrable", nominalPowerW: 600, minOnS: 900, minOffS: 300 },
      });
      const read = manager.getById(eq.id);
      expect(read?.energyProfile?.class).toBe("deferrable");
      expect(read?.energyProfile?.nominalPowerW).toBe(600);

      manager.setEnergyProfileLearned(eq.id, {
        watts: 640,
        atIso: "2026-08-12T10:00:00Z",
        runs: 1,
      });
      expect(manager.getById(eq.id)?.energyProfile?.learned?.watts).toBe(640);

      // Clearing removes the profile (and the learned estimate with it).
      manager.update(eq.id, { energyProfile: null });
      expect(manager.getById(eq.id)?.energyProfile).toBeUndefined();
      // Learned writer on an unprofiled equipment is a no-op, never a crash.
      manager.setEnergyProfileLearned(eq.id, {
        watts: 700,
        atIso: "2026-08-12T10:00:00Z",
        runs: 2,
      });
      expect(manager.getById(eq.id)?.energyProfile).toBeUndefined();
    });

    it("treats invalid profile JSON in the DB as unprofiled without crashing", () => {
      const zone = zoneManager.create({ name: "Piscine" });
      const eq = manager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id });
      db.prepare("UPDATE equipments SET energy_profile = ? WHERE id = ?").run("{not json", eq.id);
      expect(manager.getById(eq.id)?.energyProfile).toBeUndefined();
    });
  });

  // ============================================================
  // Require confirmation (spec 146)
  // ============================================================

  describe("require confirmation", () => {
    it("defaults to false on a freshly created equipment", () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({ name: "Portail", type: "gate", zoneId: zone.id });
      expect(eq.requireConfirmation).toBe(false);
      expect(manager.getById(eq.id)?.requireConfirmation).toBe(false);
    });

    it("round-trips true and false through update", () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({ name: "Portail", type: "gate", zoneId: zone.id });

      manager.update(eq.id, { requireConfirmation: true });
      expect(manager.getById(eq.id)?.requireConfirmation).toBe(true);

      manager.update(eq.id, { requireConfirmation: false });
      expect(manager.getById(eq.id)?.requireConfirmation).toBe(false);
    });

    it("preserves the flag when an update omits it", () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({ name: "Portail", type: "gate", zoneId: zone.id });
      manager.update(eq.id, { requireConfirmation: true });

      // An unrelated update (rename) must not reset the flag.
      manager.update(eq.id, { name: "Portail entrée" });
      const read = manager.getById(eq.id);
      expect(read?.name).toBe("Portail entrée");
      expect(read?.requireConfirmation).toBe(true);
    });
  });

  describe("create", () => {
    it("creates an equipment in a zone", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });

      expect(eq.name).toBe("Spots");
      expect(eq.type).toBe("light_dimmable");
      expect(eq.zoneId).toBe(zone.id);
      expect(eq.enabled).toBe(true);
      expect(eq.id).toBeDefined();
    });

    it("emits equipment.created event", () => {
      const zone = zoneManager.create({ name: "Salon" });
      events = [];
      manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });

      const eqEvents = events.filter((e) => e.type === "equipment.created");
      expect(eqEvents).toHaveLength(1);
    });

    it("rejects invalid equipment type", () => {
      const zone = zoneManager.create({ name: "Salon" });
      expect(() => {
        manager.create({ name: "Test", type: "invalid" as never, zoneId: zone.id });
      }).toThrow(EquipmentError);
    });

    it("creates a water_valve equipment", () => {
      const zone = zoneManager.create({ name: "Jardin" });
      const eq = manager.create({
        name: "Vanne potager",
        type: "water_valve",
        zoneId: zone.id,
      });
      expect(eq.type).toBe("water_valve");
      expect(eq.name).toBe("Vanne potager");
    });

    it("creates an awning equipment", () => {
      const zone = zoneManager.create({ name: "Terrasse" });
      const eq = manager.create({
        name: "Store banne",
        type: "awning",
        zoneId: zone.id,
      });
      expect(eq.type).toBe("awning");
      expect(eq.name).toBe("Store banne");
    });

    // Spec 120 — display equipment.
    it("creates a display equipment", () => {
      const zone = zoneManager.create({ name: "Cuisine" });
      const eq = manager.create({
        name: "Cadran énergie",
        type: "display",
        zoneId: zone.id,
      });
      expect(eq.type).toBe("display");
      expect(eq.name).toBe("Cadran énergie");
    });

    // Spec 133 — camera equipment.
    it("creates a camera equipment", () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({
        name: "Caméra entrée",
        type: "camera",
        zoneId: zone.id,
      });
      expect(eq.type).toBe("camera");
      expect(eq.name).toBe("Caméra entrée");
    });

    it("rejects non-existent zone", () => {
      expect(() => {
        manager.create({ name: "Test", type: "light_onoff", zoneId: "non-existent" });
      }).toThrow(EquipmentError);
    });
  });

  describe("getById", () => {
    it("returns equipment by id", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const found = manager.getById(eq.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe("Spots");
    });

    it("returns null for non-existent id", () => {
      expect(manager.getById("non-existent")).toBeNull();
    });
  });

  describe("getAll", () => {
    it("returns all equipments sorted by name", () => {
      const zone = zoneManager.create({ name: "Salon" });
      manager.create({ name: "Zebra", type: "light_onoff", zoneId: zone.id });
      manager.create({ name: "Alpha", type: "light_dimmable", zoneId: zone.id });

      const all = manager.getAll();
      expect(all).toHaveLength(2);
      expect(all[0].name).toBe("Alpha");
      expect(all[1].name).toBe("Zebra");
    });
  });

  describe("update", () => {
    it("updates equipment name", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const updated = manager.update(eq.id, { name: "Spots Plafond" });

      expect(updated!.name).toBe("Spots Plafond");
    });

    it("updates enabled status", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const updated = manager.update(eq.id, { enabled: false });

      expect(updated!.enabled).toBe(false);
    });

    it("emits equipment.updated event", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      events = [];
      manager.update(eq.id, { name: "Updated" });

      const updateEvents = events.filter((e) => e.type === "equipment.updated");
      expect(updateEvents).toHaveLength(1);
    });

    it("returns null for non-existent id", () => {
      expect(manager.update("non-existent", { name: "test" })).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes an equipment", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      manager.delete(eq.id);

      expect(manager.getById(eq.id)).toBeNull();
    });

    it("emits equipment.removed event", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      events = [];
      manager.delete(eq.id);

      const removeEvents = events.filter((e) => e.type === "equipment.removed");
      expect(removeEvents).toHaveLength(1);
    });

    it("throws for non-existent equipment", () => {
      expect(() => manager.delete("non-existent")).toThrow(EquipmentError);
    });

    it("cascades to bindings", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds, orderIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
        orderKeys: [{ key: "state" }],
      });
      manager.addDataBinding(eq.id, dataIds[0], "state");
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      manager.delete(eq.id);
      // No error — bindings are cascade-deleted
      expect(manager.getById(eq.id)).toBeNull();
    });
  });

  // ============================================================
  // Zone delete guard
  // ============================================================

  describe("zone delete guard", () => {
    it("prevents deleting zone with equipments", () => {
      const zone = zoneManager.create({ name: "Salon" });
      manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });

      expect(() => zoneManager.delete(zone.id)).toThrow(/equipment/i);
    });
  });

  // ============================================================
  // DataBinding
  // ============================================================

  describe("getEquipmentsForDeviceId (spec 143/#472)", () => {
    it("returns every equipment bound to any data of the device, ordered by name", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eqB = manager.create({ name: "Beta", type: "light_dimmable", zoneId: zone.id });
      const eqA = manager.create({ name: "Alpha", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        deviceId: "dev-x",
        dataKeys: [
          { key: "temperature", category: "temperature" },
          { key: "battery", category: "battery" },
        ],
      });
      // Two equipments each bind a different data of the same device.
      manager.addDataBinding(eqB.id, dataIds[0], "temperature");
      manager.addDataBinding(eqA.id, dataIds[1], "battery");

      expect(manager.getEquipmentsForDeviceId("dev-x").map((e) => e.name)).toEqual([
        "Alpha",
        "Beta",
      ]);
    });

    it("returns an empty array for an unbound device", () => {
      seedDevice(db, {
        deviceId: "dev-unbound",
        dataKeys: [{ key: "battery", category: "battery" }],
      });
      expect(manager.getEquipmentsForDeviceId("dev-unbound")).toEqual([]);
    });
  });

  describe("addDataBinding", () => {
    it("creates a data binding", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
      });

      const binding = manager.addDataBinding(eq.id, dataIds[0], "state");
      expect(binding.alias).toBe("state");
      expect(binding.equipmentId).toBe(eq.id);
      expect(binding.deviceDataId).toBe(dataIds[0]);
    });

    it("rejects duplicate alias on same equipment", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [
          { key: "state", category: "light_state" },
          { key: "brightness", category: "light_brightness" },
        ],
      });

      manager.addDataBinding(eq.id, dataIds[0], "state");
      expect(() => {
        manager.addDataBinding(eq.id, dataIds[1], "state"); // Same alias
      }).toThrow(EquipmentError);
    });

    it("rejects non-existent equipment", () => {
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state" }],
      });
      expect(() => {
        manager.addDataBinding("non-existent", dataIds[0], "state");
      }).toThrow(EquipmentError);
    });

    it("rejects non-existent device data", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      expect(() => {
        manager.addDataBinding(eq.id, "non-existent", "state");
      }).toThrow(EquipmentError);
    });
  });

  describe("removeDataBinding", () => {
    it("removes a data binding", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
      });
      const binding = manager.addDataBinding(eq.id, dataIds[0], "state");

      manager.removeDataBinding(eq.id, binding.id);
      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.dataBindings).toHaveLength(0);
    });

    it("throws for non-existent binding", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      expect(() => {
        manager.removeDataBinding(eq.id, "non-existent");
      }).toThrow(EquipmentError);
    });
  });

  describe("binding mutations emit equipment.updated", () => {
    // Downstream caches (HistoryWriter, EnergyAggregator) refresh on
    // equipment.updated — without this event, freshly added bindings would
    // be invisible until the equipment itself is otherwise modified.
    it("addDataBinding emits equipment.updated", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
      });
      events.length = 0;

      manager.addDataBinding(eq.id, dataIds[0], "state");

      const updated = events.filter((e) => e.type === "equipment.updated");
      expect(updated).toHaveLength(1);
      if (updated[0].type === "equipment.updated") {
        expect(updated[0].equipment.id).toBe(eq.id);
      }
    });

    it("removeDataBinding emits equipment.updated", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
      });
      const binding = manager.addDataBinding(eq.id, dataIds[0], "state");
      events.length = 0;

      manager.removeDataBinding(eq.id, binding.id);

      const updated = events.filter((e) => e.type === "equipment.updated");
      expect(updated).toHaveLength(1);
    });

    it("setHistorize emits equipment.updated", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "state", category: "light_state" }],
      });
      const binding = manager.addDataBinding(eq.id, dataIds[0], "state");
      events.length = 0;

      manager.setHistorize(binding.id, 1);

      const updated = events.filter((e) => e.type === "equipment.updated");
      expect(updated).toHaveLength(1);
    });

    it("addOrderBinding emits equipment.updated", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [{ key: "state", category: "light_toggle" }],
      });
      events.length = 0;

      manager.addOrderBinding(eq.id, orderIds[0], "state");

      const updated = events.filter((e) => e.type === "equipment.updated");
      expect(updated).toHaveLength(1);
    });

    it("removeOrderBinding emits equipment.updated", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [{ key: "state", category: "light_toggle" }],
      });
      const binding = manager.addOrderBinding(eq.id, orderIds[0], "state");
      events.length = 0;

      manager.removeOrderBinding(eq.id, binding.id);

      const updated = events.filter((e) => e.type === "equipment.updated");
      expect(updated).toHaveLength(1);
    });
  });

  describe("getDataBindingsWithValues", () => {
    it("returns bindings with resolved device data values", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        name: "Variateur",
        dataKeys: [
          { key: "state", category: "light_state", value: JSON.stringify(true) },
          { key: "brightness", category: "light_brightness", value: JSON.stringify(180) },
        ],
      });
      manager.addDataBinding(eq.id, dataIds[0], "state");
      manager.addDataBinding(eq.id, dataIds[1], "brightness");

      const bindings = manager.getDataBindingsWithValues(eq.id);
      expect(bindings).toHaveLength(2);

      const stateBinding = bindings.find((b) => b.alias === "state");
      expect(stateBinding!.value).toBe(true);
      expect(stateBinding!.deviceName).toBe("Variateur");

      const brightnessBinding = bindings.find((b) => b.alias === "brightness");
      expect(brightnessBinding!.value).toBe(180);
    });
  });

  // ============================================================
  // OrderBinding
  // ============================================================

  describe("addOrderBinding", () => {
    it("creates an order binding", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [{ key: "state" }],
      });

      const binding = manager.addOrderBinding(eq.id, orderIds[0], "state");
      expect(binding.alias).toBe("state");
    });

    it.skip("allows same alias with different device orders (multi-device)", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const device1 = seedDevice(db, { name: "D1", orderKeys: [{ key: "state" }] });
      const device2 = seedDevice(db, { name: "D2", orderKeys: [{ key: "state" }] });

      manager.addOrderBinding(eq.id, device1.orderIds[0], "state");
      manager.addOrderBinding(eq.id, device2.orderIds[0], "state");

      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.orderBindings).toHaveLength(2);
    });

    it("rejects duplicate (alias + same device order)", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { orderIds } = seedDevice(db, { orderKeys: [{ key: "state" }] });

      manager.addOrderBinding(eq.id, orderIds[0], "state");
      expect(() => {
        manager.addOrderBinding(eq.id, orderIds[0], "state");
      }).toThrow(EquipmentError);
    });
  });

  // ============================================================
  // Order execution
  // ============================================================

  describe("executeOrder", () => {
    it("publishes MQTT message to bound device", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "Switch",
        orderKeys: [{ key: "state", payloadKey: "state" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      events = [];
      await manager.executeOrder(eq.id, "state", "ON");

      expect(mockPublished).toHaveLength(1);
      expect(mockPublished[0].topic).toBe("z2m/Switch/set");
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "ON" });

      const execEvents = events.filter((e) => e.type === "equipment.order.executed");
      expect(execEvents).toHaveLength(1);
    });

    it.skip("dispatches to multiple devices (multi-device)", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "All Lights", type: "light_onoff", zoneId: zone.id });
      const d1 = seedDevice(db, { name: "L1", orderKeys: [{ key: "state", payloadKey: "state" }] });
      const d2 = seedDevice(db, { name: "L2", orderKeys: [{ key: "state", payloadKey: "state" }] });
      manager.addOrderBinding(eq.id, d1.orderIds[0], "state");
      manager.addOrderBinding(eq.id, d2.orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", "ON");

      expect(mockPublished).toHaveLength(2);
      expect(mockPublished.map((p) => p.topic).sort()).toEqual(["z2m/L1/set", "z2m/L2/set"]);
    });

    it("throws for non-existent equipment", async () => {
      await expect(manager.executeOrder("non-existent", "state", "ON")).rejects.toThrow(
        EquipmentError,
      );
    });

    it("throws for disabled equipment", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      manager.update(eq.id, { enabled: false });

      await expect(manager.executeOrder(eq.id, "state", "ON")).rejects.toThrow(/disabled/i);
    });

    it("throws for non-existent alias", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });

      await expect(manager.executeOrder(eq.id, "non-existent", "ON")).rejects.toThrow(/not found/i);
    });

    it("throws when integration not found", async () => {
      // Create a manager with a registry that returns undefined (no integration)
      const emptyRegistry = { getById: () => undefined };
      const noIntegrationManager = new EquipmentManager(
        db,
        eventBus,
        emptyRegistry as any,
        deviceManager,
        logger,
      );
      const zone = zoneManager.create({ name: "Salon" });
      const eq = noIntegrationManager.create({
        name: "Spots",
        type: "light_onoff",
        zoneId: zone.id,
      });
      const { orderIds } = seedDevice(db, { orderKeys: [{ key: "state" }] });
      noIntegrationManager.addOrderBinding(eq.id, orderIds[0], "state");

      await expect(noIntegrationManager.executeOrder(eq.id, "state", "ON")).rejects.toThrow(
        /integration/i,
      );
    });

    it("dispatches via dispatchOrder with orderKey", async () => {
      const zone = zoneManager.create({ name: "Garage" });
      const eq = manager.create({ name: "Gate", type: "gate", zoneId: zone.id });
      const { orderIds } = seedDevice(db, { name: "garage", orderKeys: [{ key: "R1" }] });
      manager.addOrderBinding(eq.id, orderIds[0], "command");

      await manager.executeOrder(eq.id, "command", "latch");

      expect(mockPublished).toHaveLength(1);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ R1: "latch" });
    });

    it("maps boolean values onto declared wire values (issue #360)", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Relay", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "WHD02",
        orderKeys: [{ key: "state", type: "boolean", valueOn: "ON", valueOff: "OFF" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", true);
      await manager.executeOrder(eq.id, "state", false);

      expect(mockPublished).toHaveLength(2);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "ON" });
      expect(JSON.parse(mockPublished[1].payload)).toEqual({ state: "OFF" });
    });

    it("keeps accepting on/off strings when wire values are declared", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Relay", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "WHD02",
        orderKeys: [{ key: "state", type: "boolean", valueOn: "ON", valueOff: "OFF" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", "ON");
      await manager.executeOrder(eq.id, "state", "off");

      expect(mockPublished).toHaveLength(2);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "ON" });
      expect(JSON.parse(mockPublished[1].payload)).toEqual({ state: "OFF" });
    });

    it("maps booleans onto non-standard wire values (LOCK/UNLOCK)", async () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({ name: "Serrure", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "Lock",
        orderKeys: [{ key: "state", type: "boolean", valueOn: "LOCK", valueOff: "UNLOCK" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", true);

      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "LOCK" });
    });

    it("dispatches booleans untouched when no wire values are declared", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Cloud Switch", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "CloudPlug",
        orderKeys: [{ key: "power", type: "boolean" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "power");

      await manager.executeOrder(eq.id, "power", true);

      expect(JSON.parse(mockPublished[0].payload)).toEqual({ power: true });
    });

    it("leaves non-boolean-ish values untouched even with wire values declared", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Relay", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "WHD02",
        orderKeys: [{ key: "state", type: "boolean", valueOn: "ON", valueOff: "OFF" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", "TOGGLE");

      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "TOGGLE" });
    });

    it("resolves enum value case-insensitively", async () => {
      const zone = zoneManager.create({ name: "Garage" });
      const eq = manager.create({ name: "Light", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "LoraLight",
        orderKeys: [{ key: "state", enumValues: ["on", "off"] }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      await manager.executeOrder(eq.id, "state", "ON");

      expect(mockPublished).toHaveLength(1);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "on" });
    });
  });

  // ============================================================
  // Zone orders with order categories
  // ============================================================

  describe("zone orders with order categories", () => {
    it("finds order binding by order category (light_toggle)", async () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "ZLight",
        orderKeys: [{ key: "state", category: "light_toggle", enumValues: ["ON", "OFF"] }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      const result = await manager.executeZoneOrder([zone.id], "allLightsOn");
      expect(result.executed).toBe(1);
      expect(result.errors).toBe(0);
      expect(mockPublished).toHaveLength(1);
    });

    it("finds order binding by order category (shutter_move)", async () => {
      const zone = zoneManager.create({ name: "Bureau" });
      const eq = manager.create({ name: "Volet", type: "shutter", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "ZShutter",
        orderKeys: [
          { key: "position", category: "set_shutter_position" },
          { key: "state", category: "shutter_move", enumValues: ["OPEN", "CLOSE", "STOP"] },
        ],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "position");
      manager.addOrderBinding(eq.id, orderIds[1], "state");

      const result = await manager.executeZoneOrder([zone.id], "allShuttersOpen");
      expect(result.executed).toBe(1);
      expect(mockPublished).toHaveLength(1);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "OPEN" });
    });

    it("skips equipment without matching order category", async () => {
      const zone = zoneManager.create({ name: "Empty" });
      manager.create({ name: "Sensor", type: "light_onoff", zoneId: zone.id });
      // No order bindings at all
      const result = await manager.executeZoneOrder([zone.id], "allLightsOn");
      expect(result.executed).toBe(0);
    });

    it("allAwningsExtend hits awnings only, never shutters in the same zone", async () => {
      const zone = zoneManager.create({ name: "Terrasse" });
      const shutter = manager.create({ name: "Volet", type: "shutter", zoneId: zone.id });
      const awning = manager.create({ name: "Store", type: "awning", zoneId: zone.id });

      const { orderIds: shutterOrderIds } = seedDevice(db, {
        name: "ZShutterX",
        orderKeys: [
          { key: "state", category: "shutter_move", enumValues: ["OPEN", "CLOSE", "STOP"] },
        ],
      });
      manager.addOrderBinding(shutter.id, shutterOrderIds[0], "state");

      const { orderIds: awningOrderIds } = seedDevice(db, {
        name: "ZAwningX",
        orderKeys: [
          { key: "state", category: "shutter_move", enumValues: ["OPEN", "CLOSE", "STOP"] },
        ],
      });
      manager.addOrderBinding(awning.id, awningOrderIds[0], "state");

      mockPublished.length = 0;
      const result = await manager.executeZoneOrder([zone.id], "allAwningsExtend");
      expect(result.executed).toBe(1);
      expect(mockPublished).toHaveLength(1);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "CLOSE" });

      mockPublished.length = 0;
      const shutterResult = await manager.executeZoneOrder([zone.id], "allShuttersOpen");
      expect(shutterResult.executed).toBe(1);
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "OPEN" });
    });

    it("allAwningsRetract maps to RF OPEN, allAwningsExtend to CLOSE", async () => {
      const zone = zoneManager.create({ name: "Terrasse2" });
      const awning = manager.create({ name: "Store2", type: "awning", zoneId: zone.id });

      const { orderIds } = seedDevice(db, {
        name: "ZAwning2",
        orderKeys: [
          { key: "state", category: "shutter_move", enumValues: ["OPEN", "CLOSE", "STOP"] },
        ],
      });
      manager.addOrderBinding(awning.id, orderIds[0], "state");

      mockPublished.length = 0;
      await manager.executeZoneOrder([zone.id], "allAwningsRetract");
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "OPEN" });

      mockPublished.length = 0;
      await manager.executeZoneOrder([zone.id], "allAwningsStop");
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "STOP" });
    });
  });

  // ============================================================
  // Reactive pipeline: device.data.updated -> equipment.data.changed
  // ============================================================

  describe("reactive pipeline", () => {
    it("emits equipment.data.changed when bound device data updates", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ id: "data-1", key: "state", category: "light_state" }],
      });
      manager.addDataBinding(eq.id, dataIds[0], "state");

      events = [];
      // Simulate device.data.updated event
      eventBus.emit({
        type: "device.data.updated",
        deviceId: "any",
        deviceName: "any",
        dataId: "data-1",
        key: "state",
        value: true,
        previous: false,
        timestamp: new Date().toISOString(),
      });

      const eqEvents = events.filter((e) => e.type === "equipment.data.changed");
      expect(eqEvents).toHaveLength(1);
      if (eqEvents[0].type === "equipment.data.changed") {
        expect(eqEvents[0].equipmentId).toBe(eq.id);
        expect(eqEvents[0].alias).toBe("state");
        expect(eqEvents[0].value).toBe(true);
        expect(eqEvents[0].previous).toBe(false);
      }
    });

    // Spec 133 — camera_detection reuses the button "action" pattern: a
    // momentary event reflected as a normal bound data category, riding
    // the existing equipment.data.changed pipeline with zero bespoke
    // EventBus wiring. This is the acceptance criterion that a recipe can
    // trigger on a camera detection the same way it triggers on a button.
    it("emits equipment.data.changed for a camera_detection binding, same as any other bound category", () => {
      const zone = zoneManager.create({ name: "Entrée" });
      const eq = manager.create({ name: "Caméra entrée", type: "camera", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ id: "data-detect", key: "last_event", category: "camera_detection" }],
      });
      manager.addDataBinding(eq.id, dataIds[0], "detection");

      events = [];
      eventBus.emit({
        type: "device.data.updated",
        deviceId: "any",
        deviceName: "any",
        dataId: "data-detect",
        key: "last_event",
        value: "person",
        previous: null,
        timestamp: new Date().toISOString(),
      });

      const eqEvents = events.filter((e) => e.type === "equipment.data.changed");
      expect(eqEvents).toHaveLength(1);
      if (eqEvents[0].type === "equipment.data.changed") {
        expect(eqEvents[0].equipmentId).toBe(eq.id);
        expect(eqEvents[0].alias).toBe("detection");
        expect(eqEvents[0].value).toBe("person");
      }
    });

    it("does not emit for unbound device data", () => {
      events = [];
      eventBus.emit({
        type: "device.data.updated",
        deviceId: "any",
        deviceName: "any",
        dataId: "unbound-data",
        key: "state",
        value: true,
        previous: false,
        timestamp: new Date().toISOString(),
      });

      const eqEvents = events.filter((e) => e.type === "equipment.data.changed");
      expect(eqEvents).toHaveLength(0);
    });
  });

  // ============================================================
  // getByIdWithDetails
  // ============================================================

  describe("getByIdWithDetails", () => {
    it("returns equipment with resolved bindings", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      const { dataIds, orderIds } = seedDevice(db, {
        name: "Variateur",
        dataKeys: [{ key: "state", category: "light_state", value: JSON.stringify("ON") }],
        orderKeys: [{ key: "state" }],
      });
      manager.addDataBinding(eq.id, dataIds[0], "state");
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      const details = manager.getByIdWithDetails(eq.id);
      expect(details).not.toBeNull();
      expect(details!.dataBindings).toHaveLength(1);
      expect(details!.dataBindings[0].alias).toBe("state");
      expect(details!.dataBindings[0].value).toBe("ON");
      expect(details!.dataBindings[0].deviceName).toBe("Variateur");
      expect(details!.orderBindings).toHaveLength(1);
      expect(details!.orderBindings[0].alias).toBe("state");
      expect(details!.orderBindings[0].deviceName).toBe("Variateur");
    });

    it("returns null for non-existent equipment", () => {
      expect(manager.getByIdWithDetails("non-existent")).toBeNull();
    });
  });

  // ============================================================
  // countByZone
  // ============================================================

  describe("countByZone", () => {
    it("counts equipments in a zone", () => {
      const zone = zoneManager.create({ name: "Salon" });
      manager.create({ name: "Spots", type: "light_dimmable", zoneId: zone.id });
      manager.create({ name: "Lampe", type: "light_onoff", zoneId: zone.id });

      expect(manager.countByZone(zone.id)).toBe(2);
    });

    it("returns 0 for empty zone", () => {
      const zone = zoneManager.create({ name: "Salon" });
      expect(manager.countByZone(zone.id)).toBe(0);
    });
  });

  describe("data binding enum values", () => {
    it("includes enumValues in data binding response", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Remote", type: "button", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [
          {
            key: "action",
            type: "enum",
            category: "action",
            enumValues: ["1_single", "1_double", "2_single"],
          },
        ],
      });
      manager.addDataBinding(eq.id, dataIds[0], "action");

      const detail = manager.getByIdWithDetails(eq.id);
      const actionBinding = detail?.dataBindings.find((b) => b.alias === "action");
      expect(actionBinding?.enumValues).toEqual(["1_single", "1_double", "2_single"]);
    });

    it("returns undefined enumValues for non-enum data", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Remote", type: "button", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [{ key: "battery", type: "number", category: "battery" }],
      });
      manager.addDataBinding(eq.id, dataIds[0], "battery");

      const detail = manager.getByIdWithDetails(eq.id);
      const batteryBinding = detail?.dataBindings.find((b) => b.alias === "battery");
      expect(batteryBinding?.enumValues).toBeUndefined();
    });
  });

  // ============================================================
  // Pool equipments — category override + virtual cover_state
  // ============================================================

  describe("pool category overrides", () => {
    it("addOrderBinding on pool_pump persists pool_pump_toggle override", () => {
      const zone = zoneManager.create({ name: "Piscine" });
      const eq = manager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [{ key: "R1", type: "enum", enumValues: ["ON", "OFF"] }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.orderBindings[0].category).toBe("pool_pump_toggle");
    });

    it("addOrderBinding on plain switch keeps device order category (no override)", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Lampe", type: "switch", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [
          { key: "R1", type: "enum", category: "toggle_power", enumValues: ["ON", "OFF"] },
        ],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.orderBindings[0].category).toBe("toggle_power");
    });

    it("update({type: pool_pump}) re-tags existing binding to pool_pump_toggle", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Relais", type: "switch", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [
          { key: "R1", type: "enum", category: "toggle_power", enumValues: ["ON", "OFF"] },
        ],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      manager.update(eq.id, { type: "pool_pump" });
      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.orderBindings[0].category).toBe("pool_pump_toggle");
    });

    it("update({type: switch}) clears pool_pump override (back to device order category)", () => {
      const zone = zoneManager.create({ name: "Piscine" });
      const eq = manager.create({ name: "Pompe", type: "pool_pump", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        orderKeys: [
          { key: "R1", type: "enum", category: "toggle_power", enumValues: ["ON", "OFF"] },
        ],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      manager.update(eq.id, { type: "switch" });
      const details = manager.getByIdWithDetails(eq.id);
      expect(details!.orderBindings[0].category).toBe("toggle_power");
    });
  });

  describe("pool_cover virtual cover_state binding", () => {
    function setupCover(positionValue: string | null) {
      const zone = zoneManager.create({ name: "Piscine" });
      const eq = manager.create({ name: "Volet", type: "pool_cover", zoneId: zone.id });
      const { dataIds } = seedDevice(db, {
        dataKeys: [
          {
            key: "shutter_position",
            type: "number",
            category: "shutter_position",
            value: positionValue,
          },
        ],
      });
      manager.addDataBinding(eq.id, dataIds[0], "position");
      return eq;
    }

    it("position=2 → CLOSED", () => {
      const eq = setupCover("2");
      const bindings = manager.getDataBindingsWithValues(eq.id);
      const cover = bindings.find((b) => b.alias === "cover_state");
      expect(cover?.value).toBe("CLOSED");
    });

    it("position=50 → PARTIAL", () => {
      const eq = setupCover("50");
      const bindings = manager.getDataBindingsWithValues(eq.id);
      const cover = bindings.find((b) => b.alias === "cover_state");
      expect(cover?.value).toBe("PARTIAL");
    });

    it("position=98 → OPEN", () => {
      const eq = setupCover("98");
      const bindings = manager.getDataBindingsWithValues(eq.id);
      const cover = bindings.find((b) => b.alias === "cover_state");
      expect(cover?.value).toBe("OPEN");
    });

    it("position=null → null", () => {
      const eq = setupCover(null);
      const bindings = manager.getDataBindingsWithValues(eq.id);
      const cover = bindings.find((b) => b.alias === "cover_state");
      expect(cover?.value).toBe(null);
    });
  });
});

// ============================================================
// deriveCoverState (pure helper)
// ============================================================

describe("deriveCoverState", () => {
  function pos(value: unknown) {
    return {
      id: "x",
      equipmentId: "x",
      deviceDataId: "x",
      alias: "position",
      deviceId: "x",
      deviceName: "x",
      key: "x",
      type: "number" as const,
      category: "shutter_position" as const,
      value,
      lastUpdated: null,
      lastChanged: null,
    };
  }

  it("position 0 → CLOSED", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(pos(0))).toBe("CLOSED");
  });

  it("position 100 → OPEN", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(pos(100))).toBe("OPEN");
  });

  it("position 50 → PARTIAL", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(pos(50))).toBe("PARTIAL");
  });

  it("position 3 (tolerance) → CLOSED", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(pos(3))).toBe("CLOSED");
  });

  it("position 97 (tolerance) → OPEN", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(pos(97))).toBe("OPEN");
  });

  it("undefined / null position → null", async () => {
    const { deriveCoverState } = await import("./equipment-manager.js");
    expect(deriveCoverState(undefined)).toBe(null);
    expect(deriveCoverState(pos(null))).toBe(null);
  });
});

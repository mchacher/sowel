import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EquipmentManager, EquipmentError } from "./equipment-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
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

// Helper to seed a device with data and orders
function seedDevice(
  db: Database.Database,
  opts: {
    deviceId?: string;
    name?: string;
    dataKeys?: { id?: string; key: string; type?: string; category?: string; value?: string }[];
    orderKeys?: { id?: string; key: string; type?: string; payloadKey?: string }[];
  } = {},
) {
  const deviceId = opts.deviceId ?? crypto.randomUUID();
  const name = opts.name ?? "Test Device";
  db.prepare(
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status)
     VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online')`,
  ).run(deviceId, `z2m/${name}`, name, name);

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
      `INSERT INTO device_orders (id, device_id, key, type, mqtt_set_topic, payload_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, deviceId, o.key, o.type ?? "boolean", `z2m/${name}/set`, o.payloadKey ?? o.key);
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
  let mockMqtt: { publish: (topic: string, payload: string | Buffer) => void; isConnected: () => boolean };

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    mockPublished = [];
    mockMqtt = {
      publish: (topic: string, payload: string | Buffer) => {
        mockPublished.push({ topic, payload: payload.toString() });
      },
      isConnected: () => true,
    };
    manager = new EquipmentManager(db, eventBus, mockMqtt as never, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // Equipment CRUD
  // ============================================================

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

    it("allows same alias with different device orders (multi-device)", () => {
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
    it("publishes MQTT message to bound device", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, {
        name: "Switch",
        orderKeys: [{ key: "state", payloadKey: "state" }],
      });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      events = [];
      manager.executeOrder(eq.id, "state", "ON");

      expect(mockPublished).toHaveLength(1);
      expect(mockPublished[0].topic).toBe("z2m/Switch/set");
      expect(JSON.parse(mockPublished[0].payload)).toEqual({ state: "ON" });

      const execEvents = events.filter((e) => e.type === "equipment.order.executed");
      expect(execEvents).toHaveLength(1);
    });

    it("dispatches to multiple devices (multi-device)", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "All Lights", type: "light_onoff", zoneId: zone.id });
      const d1 = seedDevice(db, { name: "L1", orderKeys: [{ key: "state", payloadKey: "state" }] });
      const d2 = seedDevice(db, { name: "L2", orderKeys: [{ key: "state", payloadKey: "state" }] });
      manager.addOrderBinding(eq.id, d1.orderIds[0], "state");
      manager.addOrderBinding(eq.id, d2.orderIds[0], "state");

      manager.executeOrder(eq.id, "state", "ON");

      expect(mockPublished).toHaveLength(2);
      expect(mockPublished.map((p) => p.topic).sort()).toEqual(["z2m/L1/set", "z2m/L2/set"]);
    });

    it("throws for non-existent equipment", () => {
      expect(() => {
        manager.executeOrder("non-existent", "state", "ON");
      }).toThrow(EquipmentError);
    });

    it("throws for disabled equipment", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      manager.update(eq.id, { enabled: false });

      expect(() => {
        manager.executeOrder(eq.id, "state", "ON");
      }).toThrow(/disabled/i);
    });

    it("throws for non-existent alias", () => {
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });

      expect(() => {
        manager.executeOrder(eq.id, "non-existent", "ON");
      }).toThrow(/not found/i);
    });

    it("throws when MQTT not connected", () => {
      mockMqtt.isConnected = () => false;
      const zone = zoneManager.create({ name: "Salon" });
      const eq = manager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      const { orderIds } = seedDevice(db, { orderKeys: [{ key: "state" }] });
      manager.addOrderBinding(eq.id, orderIds[0], "state");

      expect(() => {
        manager.executeOrder(eq.id, "state", "ON");
      }).toThrow(/MQTT/i);
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
        dataKeys: [
          { key: "state", category: "light_state", value: JSON.stringify("ON") },
        ],
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
});

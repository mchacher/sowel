import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DeviceManager } from "./device-manager.js";
import { applyMigrations } from "../test-helpers/migrations.js";
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

describe("DeviceManager", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let manager: DeviceManager;
  let events: EngineEvent[];

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    manager = new DeviceManager(db, eventBus, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  const sampleDevice = {
    ieeeAddress: "0x00158d0001a2b3c4",
    friendlyName: "salon_pir",
    manufacturer: "Xiaomi",
    model: "RTCGQ11LM",
    data: [
      { key: "occupancy", type: "boolean" as const, category: "motion" as const },
      { key: "battery", type: "number" as const, category: "battery" as const, unit: "%" },
      { key: "linkquality", type: "number" as const, category: "generic" as const, unit: "lqi" },
    ],
    orders: [],
    rawExpose: [],
  };

  const sampleLight = {
    ieeeAddress: "0x00158d0001a2b3c5",
    friendlyName: "salon_lampe",
    manufacturer: "IKEA",
    model: "LED1545G12",
    data: [
      { key: "state", type: "enum" as const, category: "light_state" as const },
      { key: "brightness", type: "number" as const, category: "light_brightness" as const },
    ],
    orders: [
      {
        key: "state",
        type: "enum" as const,
        category: "light_toggle" as const,
        enumValues: ["ON", "OFF", "TOGGLE"],
      },
      {
        key: "brightness",
        type: "number" as const,
        category: "set_brightness" as const,
        min: 0,
        max: 254,
      },
    ],
    rawExpose: [],
  };

  describe("upsertFromDiscovery", () => {
    it("creates a new device", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);

      const devices = manager.getAll();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toBe("salon_pir");
      expect(devices[0].manufacturer).toBe("Xiaomi");
      expect(devices[0].ieeeAddress).toBe("0x00158d0001a2b3c4");
      expect(devices[0].source).toBe("zigbee2mqtt");
    });

    it("creates device data", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);

      const devices = manager.getAll();
      const data = manager.getDeviceData(devices[0].id);
      expect(data).toHaveLength(3);
      expect(data.map((d) => d.key).sort()).toEqual(["battery", "linkquality", "occupancy"]);
      expect(data.find((d) => d.key === "occupancy")?.category).toBe("motion");
      expect(data.find((d) => d.key === "battery")?.unit).toBe("%");
    });

    it("creates device orders", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);

      const devices = manager.getAll();
      const orders = manager.getDeviceOrders(devices[0].id);
      expect(orders).toHaveLength(2);
      expect(orders.find((o) => o.key === "brightness")?.min).toBe(0);
      expect(orders.find((o) => o.key === "brightness")?.max).toBe(254);
      expect(orders.find((o) => o.key === "state")?.enumValues).toEqual(["ON", "OFF", "TOGGLE"]);
    });

    it("persists and re-syncs order wire values (value_on/value_off)", () => {
      const relay = {
        friendlyName: "whd02_relay",
        data: [{ key: "state", type: "boolean" as const, category: "light_state" as const }],
        orders: [
          {
            key: "state",
            type: "boolean" as const,
            category: "light_toggle" as const,
            valueOn: "ON",
            valueOff: "OFF",
          },
        ],
        rawExpose: [],
      };
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", relay);

      const device = manager.getAll()[0];
      let order = manager.getDeviceOrders(device.id).find((o) => o.key === "state");
      expect(order?.valueOn).toBe("ON");
      expect(order?.valueOff).toBe("OFF");

      // Re-discovery updates wire values in place (stable order id)
      const updated = {
        ...relay,
        orders: [{ ...relay.orders[0], valueOn: true as const, valueOff: false as const }],
      };
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", updated);
      order = manager.getDeviceOrders(device.id).find((o) => o.key === "state");
      expect(order?.valueOn).toBe(true);
      expect(order?.valueOff).toBe(false);
    });

    it("leaves wire values undefined when not declared", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      const device = manager.getAll()[0];
      const order = manager.getDeviceOrders(device.id).find((o) => o.key === "state");
      expect(order?.valueOn).toBeUndefined();
      expect(order?.valueOff).toBeUndefined();
    });

    it("emits device.discovered event", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);

      const discovered = events.find((e) => e.type === "device.discovered");
      expect(discovered).toBeDefined();
      if (discovered?.type === "device.discovered") {
        expect(discovered.device.name).toBe("salon_pir");
      }
    });

    it("does not emit device.discovered on re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);

      expect(events.filter((e) => e.type === "device.discovered")).toHaveLength(0);
    });

    it("preserves existing device name on re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      const device = manager.getAll()[0];
      manager.update(device.id, { name: "PIR Salon" });

      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      expect(manager.getById(device.id)?.name).toBe("PIR Salon");
    });

    // Regression for the pool_cover incident: a partial discovery announcement
    // must not destroy device data/order rows that an equipment still binds to,
    // because the FK CASCADE on data_bindings/order_bindings would wipe the
    // equipment binding silently. See specs/109-device-discovery-preserve-bound.
    it("keeps device_order rows that are bound to an equipment when the key is missing from a re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      const device = manager.getAll()[0];
      const stateOrder = manager.getDeviceOrders(device.id).find((o) => o.key === "state");
      expect(stateOrder).toBeDefined();

      // Bind the `state` order to an equipment (directly via SQL — DeviceManager
      // does not own the equipment tables).
      db.prepare("INSERT INTO zones (id, name) VALUES ('zone-1', 'Salon')").run();
      db.prepare(
        "INSERT INTO equipments (id, name, zone_id, type) VALUES ('eq-1', 'Lampe', 'zone-1', 'light')",
      ).run();
      db.prepare(
        "INSERT INTO order_bindings (id, equipment_id, device_order_id, alias) VALUES (?, 'eq-1', ?, 'state')",
      ).run("ob-1", stateOrder!.id);

      // Partial re-discovery: `state` is omitted, only `brightness` is reported.
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", {
        ...sampleLight,
        orders: sampleLight.orders.filter((o) => o.key === "brightness"),
      });

      // The order row must survive (binding kept it alive).
      const orders = manager.getDeviceOrders(device.id);
      expect(orders.map((o) => o.key).sort()).toContain("state");
      // Binding still references the same device_order id.
      const binding = db.prepare("SELECT * FROM order_bindings WHERE id = 'ob-1'").get() as
        | { device_order_id: string }
        | undefined;
      expect(binding?.device_order_id).toBe(stateOrder!.id);
    });

    it("keeps device_data rows that are bound to an equipment when the key is missing from a re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      const device = manager.getAll()[0];
      const stateData = manager.getDeviceData(device.id).find((d) => d.key === "state");
      expect(stateData).toBeDefined();

      db.prepare("INSERT INTO zones (id, name) VALUES ('zone-1', 'Salon')").run();
      db.prepare(
        "INSERT INTO equipments (id, name, zone_id, type) VALUES ('eq-1', 'Lampe', 'zone-1', 'light')",
      ).run();
      db.prepare(
        "INSERT INTO data_bindings (id, equipment_id, device_data_id, alias) VALUES (?, 'eq-1', ?, 'state')",
      ).run("db-1", stateData!.id);

      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", {
        ...sampleLight,
        data: sampleLight.data.filter((d) => d.key === "brightness"),
      });

      const data = manager.getDeviceData(device.id);
      expect(data.map((d) => d.key).sort()).toContain("state");
      const binding = db.prepare("SELECT * FROM data_bindings WHERE id = 'db-1'").get() as
        | { device_data_id: string }
        | undefined;
      expect(binding?.device_data_id).toBe(stateData!.id);
    });

    it("still removes unbound stale entries on re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      const device = manager.getAll()[0];
      expect(
        manager
          .getDeviceOrders(device.id)
          .map((o) => o.key)
          .sort(),
      ).toEqual(["brightness", "state"]);

      // No binding on `brightness` — it must still be cleaned up when missing.
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", {
        ...sampleLight,
        orders: sampleLight.orders.filter((o) => o.key === "state"),
        data: sampleLight.data.filter((d) => d.key === "state"),
      });

      expect(manager.getDeviceOrders(device.id).map((o) => o.key)).toEqual(["state"]);
      expect(manager.getDeviceData(device.id).map((d) => d.key)).toEqual(["state"]);
    });
  });

  describe("updateDeviceData", () => {
    it("updates data values and emits events", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "salon_pir", {
        occupancy: true,
        battery: 88,
      });

      const dataEvents = events.filter((e) => e.type === "device.data.updated");
      expect(dataEvents).toHaveLength(2);
    });

    it("includes deviceName in events", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { occupancy: true });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type === "device.data.updated") {
        expect(event.deviceName).toBe("salon_pir");
        expect(event.key).toBe("occupancy");
        expect(event.value).toBe(true);
      }
    });

    it("emits event even if value unchanged (keeps last_updated fresh)", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { occupancy: true });
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { occupancy: true });

      const dataEvents = events.filter((e) => e.type === "device.data.updated");
      expect(dataEvents).toHaveLength(1);
    });

    it("marks device as online when receiving data", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      const device = manager.getAll()[0];
      expect(device.status).toBe("unknown");

      events.length = 0;
      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { occupancy: false });

      expect(manager.getById(device.id)?.status).toBe("online");
      const statusEvent = events.find((e) => e.type === "device.status_changed");
      expect(statusEvent).toBeDefined();
    });

    it("ignores unknown properties", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { unknown_field: 42 });

      const dataEvents = events.filter((e) => e.type === "device.data.updated");
      expect(dataEvents).toHaveLength(0);
    });

    it("ignores unknown devices", () => {
      events.length = 0;
      manager.updateDeviceData("zigbee2mqtt", "nonexistent", { occupancy: true });
      expect(events).toHaveLength(0);
    });
  });

  describe("value normalization (spec 150)", () => {
    function makeManagerWithWarnSpy(): { mgr: DeviceManager; warns: unknown[][] } {
      const warns: unknown[][] = [];
      const stubLogger = {
        child: () => stubLogger,
        warn: (...args: unknown[]) => warns.push(args),
        info: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
        fatal: () => undefined,
      };
      const mgr = new DeviceManager(db, eventBus, stubLogger as unknown as typeof logger);
      return { mgr, warns };
    }

    const boolRelay = {
      friendlyName: "garage_relay",
      data: [{ key: "state", type: "boolean" as const, category: "light_state" as const }],
      orders: [],
      rawExpose: [],
    };

    it("coerces 'ON'/'OFF' strings to booleans on a boolean-declared key", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", boolRelay);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "ON" });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.value).toBe(true);
      expect(manager.getDeviceDataValue("zigbee2mqtt", "garage_relay", "state")).toBe(true);

      events.length = 0;
      manager.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "OFF" });
      const event2 = events.find((e) => e.type === "device.data.updated");
      if (event2?.type !== "device.data.updated") throw new Error("missing event");
      expect(event2.value).toBe(false);
    });

    it("exposes the previous value normalized after coercion", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", boolRelay);
      manager.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "ON" });
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "OFF" });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.previous).toBe(true);
    });

    it("parses numeric strings on a number-declared key", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "salon_pir", { battery: "88.5" });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.value).toBe(88.5);
    });

    it("recases enum values to their canonical casing", () => {
      const relay = {
        friendlyName: "tasmota_relay",
        data: [
          {
            key: "power1",
            type: "enum" as const,
            category: "light_state" as const,
            enumValues: ["ON", "OFF"],
          },
        ],
        orders: [],
        rawExpose: [],
      };
      manager.upsertFromDiscovery("tasmota", "tasmota", relay);
      events.length = 0;

      manager.updateDeviceData("tasmota", "tasmota_relay", { power1: "on" });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.value).toBe("ON");
    });

    it("stores un-coercible values raw and warns exactly once per key", () => {
      const { mgr, warns } = makeManagerWithWarnSpy();
      mgr.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", boolRelay);
      events.length = 0;

      mgr.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "OPEN" });
      mgr.updateDeviceData("zigbee2mqtt", "garage_relay", { state: "OPEN" });

      const dataEvents = events.filter((e) => e.type === "device.data.updated");
      expect(dataEvents).toHaveLength(2);
      if (dataEvents[0]?.type === "device.data.updated") {
        expect(dataEvents[0].value).toBe("OPEN");
      }
      const coercionWarns = warns.filter(
        (w) => typeof w[1] === "string" && w[1].includes("does not match declared type"),
      );
      expect(coercionWarns).toHaveLength(1);
    });

    it("keeps typeof-inferred behavior for auto-created keys (no declared row)", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      events.length = 0;

      // "temperature" is not declared by sampleLight but is a known property:
      // the row is auto-created with typeof-inferred type, so no coercion applies.
      manager.updateDeviceData("zigbee2mqtt", "salon_lampe", { temperature: 21.5 });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.value).toBe(21.5);
    });

    it("passes null through untouched", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", boolRelay);
      events.length = 0;

      manager.updateDeviceData("zigbee2mqtt", "garage_relay", { state: null });

      const event = events.find((e) => e.type === "device.data.updated");
      if (event?.type !== "device.data.updated") throw new Error("missing event");
      expect(event.value).toBeNull();
    });

    it("warns at discovery when the declared type contradicts the category contract", () => {
      const { mgr, warns } = makeManagerWithWarnSpy();
      const weird = {
        friendlyName: "weird_contact",
        data: [{ key: "contact", type: "text" as const, category: "contact_door" as const }],
        orders: [],
        rawExpose: [],
      };

      mgr.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", weird);
      mgr.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", weird);

      const declWarns = warns.filter(
        (w) => typeof w[1] === "string" && w[1].includes("contradicts category contract"),
      );
      expect(declWarns).toHaveLength(1);
      // Row still created as declared
      const device = mgr.getAll()[0];
      expect(mgr.getDeviceData(device.id).find((d) => d.key === "contact")?.type).toBe("text");
    });

    it("does not warn for an ON/OFF enum on a boolean-expected category (Tasmota pattern)", () => {
      const { mgr, warns } = makeManagerWithWarnSpy();
      const relay = {
        friendlyName: "tasmota_relay",
        data: [
          {
            key: "power1",
            type: "enum" as const,
            category: "light_state" as const,
            enumValues: ["ON", "OFF"],
          },
        ],
        orders: [],
        rawExpose: [],
      };

      mgr.upsertFromDiscovery("tasmota", "tasmota", relay);

      const declWarns = warns.filter(
        (w) => typeof w[1] === "string" && w[1].includes("contradicts category contract"),
      );
      expect(declWarns).toHaveLength(0);
    });

    it("does not warn for coherent declarations", () => {
      const { mgr, warns } = makeManagerWithWarnSpy();
      mgr.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      expect(warns).toHaveLength(0);
    });
  });

  describe("updateDeviceStatus", () => {
    it("updates status to online and emits event", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceStatus("zigbee2mqtt", "salon_pir", "online");

      const device = manager.getAll()[0];
      expect(device.status).toBe("online");

      const statusEvent = events.find((e) => e.type === "device.status_changed");
      if (statusEvent?.type === "device.status_changed") {
        expect(statusEvent.status).toBe("online");
        expect(statusEvent.deviceName).toBe("salon_pir");
      }
    });

    it("marks device as offline and preserves data", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.updateDeviceStatus("zigbee2mqtt", "salon_pir", "offline");

      const devices = manager.getAll();
      expect(devices).toHaveLength(1);
      expect(devices[0].status).toBe("offline");

      const statusEvent = events.find((e) => e.type === "device.status_changed");
      expect(statusEvent).toBeDefined();
      if (statusEvent?.type === "device.status_changed") {
        expect(statusEvent.status).toBe("offline");
      }
      expect(events.find((e) => e.type === "device.removed")).toBeUndefined();
    });

    it("does not emit event if status unchanged", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.updateDeviceStatus("zigbee2mqtt", "salon_pir", "online");
      events.length = 0;

      manager.updateDeviceStatus("zigbee2mqtt", "salon_pir", "online");
      expect(events.filter((e) => e.type === "device.status_changed")).toHaveLength(0);
    });
  });

  describe("CRUD", () => {
    it("getAll returns all devices sorted by name", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);

      const devices = manager.getAll();
      expect(devices).toHaveLength(2);
      // Sorted by name: salon_lampe < salon_pir
      expect(devices[0].name).toBe("salon_lampe");
      expect(devices[1].name).toBe("salon_pir");
    });

    it("getByIdWithDetails includes data and orders", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      const id = manager.getAll()[0].id;

      const detail = manager.getByIdWithDetails(id);
      expect(detail).not.toBeNull();
      expect(detail!.data).toHaveLength(2);
      expect(detail!.orders).toHaveLength(2);
    });

    it("update changes name", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      const id = manager.getAll()[0].id;

      const updated = manager.update(id, { name: "PIR Salon" });
      expect(updated?.name).toBe("PIR Salon");
    });

    it("update changes zoneId", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      const id = manager.getAll()[0].id;

      const updated = manager.update(id, { zoneId: "zone-123" });
      expect(updated?.zoneId).toBe("zone-123");
    });

    it("delete removes device and emits event", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      const id = manager.getAll()[0].id;
      events.length = 0;

      const result = manager.delete(id);
      expect(result).toBe(true);
      expect(manager.getAll()).toHaveLength(0);
      expect(events.find((e) => e.type === "device.removed")).toBeDefined();
    });

    it("delete returns false for nonexistent device", () => {
      expect(manager.delete("nonexistent")).toBe(false);
    });

    it("getById returns null for nonexistent device", () => {
      expect(manager.getById("nonexistent")).toBeNull();
    });
  });

  describe("markRemoved", () => {
    it("deletes device from DB and emits event", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      manager.markRemoved("zigbee2mqtt", "salon_pir");

      expect(manager.getAll()).toHaveLength(0);
      expect(events.find((e) => e.type === "device.removed")).toBeDefined();
    });
  });

  describe("removeStaleDevices", () => {
    it("deletes devices not in active set", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      events.length = 0;

      // Only salon_lampe is active — salon_pir should be removed
      manager.removeStaleDevices("zigbee2mqtt", new Set(["salon_lampe"]));

      const devices = manager.getAll();
      expect(devices).toHaveLength(1);
      expect(devices[0].name).toBe("salon_lampe");
      expect(events.filter((e) => e.type === "device.removed")).toHaveLength(1);
    });

    it("does nothing when all devices are active", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      events.length = 0;

      manager.removeStaleDevices("zigbee2mqtt", new Set(["salon_pir", "salon_lampe"]));

      expect(manager.getAll()).toHaveLength(2);
      expect(events.filter((e) => e.type === "device.removed")).toHaveLength(0);
    });

    it("only affects devices with matching baseTopic", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      events.length = 0;

      // Different baseTopic — should not touch zigbee2mqtt devices
      manager.removeStaleDevices("other_topic", new Set());

      expect(manager.getAll()).toHaveLength(1);
      expect(events.filter((e) => e.type === "device.removed")).toHaveLength(0);
    });
  });

  describe("counts", () => {
    it("getDeviceCount returns total", () => {
      expect(manager.getDeviceCount()).toBe(0);
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      expect(manager.getDeviceCount()).toBe(1);
    });

    it("getStatusCounts groups by status", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleDevice);
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleLight);
      manager.updateDeviceStatus("zigbee2mqtt", "salon_pir", "online");

      const counts = manager.getStatusCounts();
      expect(counts.online).toBe(1);
      expect(counts.unknown).toBe(1);
    });
  });

  describe("data enum values", () => {
    const sampleButton = {
      ieeeAddress: "0x00158d0001a2b3c6",
      friendlyName: "remote_4btn",
      manufacturer: "LoraTap",
      model: "SS6400ZB",
      data: [
        {
          key: "action",
          type: "enum" as const,
          category: "action" as const,
          enumValues: ["1_single", "1_double", "1_hold", "2_single"],
        },
        { key: "battery", type: "number" as const, category: "battery" as const, unit: "%" },
      ],
      orders: [],
      rawExpose: [],
    };

    it("stores enum_values for data entries", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleButton);

      const device = manager.getAll()[0];
      const row = db
        .prepare("SELECT enum_values FROM device_data WHERE device_id = ? AND key = 'action'")
        .get(device.id) as { enum_values: string | null };
      expect(row.enum_values).not.toBeNull();
      expect(JSON.parse(row.enum_values!)).toEqual(["1_single", "1_double", "1_hold", "2_single"]);
    });

    it("stores null enum_values for non-enum data", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleButton);

      const device = manager.getAll()[0];
      const row = db
        .prepare("SELECT enum_values FROM device_data WHERE device_id = ? AND key = 'battery'")
        .get(device.id) as { enum_values: string | null };
      expect(row.enum_values).toBeNull();
    });

    it("updates enum_values on re-discovery", () => {
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", sampleButton);
      const device = manager.getAll()[0];

      const updated = {
        ...sampleButton,
        data: [
          {
            key: "action",
            type: "enum" as const,
            category: "action" as const,
            enumValues: ["1_single", "1_double"],
          },
          { key: "battery", type: "number" as const, category: "battery" as const, unit: "%" },
        ],
      };
      manager.upsertFromDiscovery("zigbee2mqtt", "zigbee2mqtt", updated);

      const row = db
        .prepare("SELECT enum_values FROM device_data WHERE device_id = ? AND key = 'action'")
        .get(device.id) as { enum_values: string | null };
      expect(JSON.parse(row.enum_values!)).toEqual(["1_single", "1_double"]);
    });
  });

  describe("getDeviceDataValue", () => {
    const sampleEm = {
      ieeeAddress: "0xshelly00",
      friendlyName: "shelly-pro3em_00-em0",
      manufacturer: "Shelly",
      model: "Pro3EM",
      data: [
        { key: "energy_forward", type: "number" as const, category: "energy" as const, unit: "Wh" },
        { key: "energy_reverse", type: "number" as const, category: "energy" as const, unit: "Wh" },
        { key: "online", type: "boolean" as const, category: "generic" as const },
        { key: "label", type: "text" as const, category: "generic" as const },
      ],
      orders: [],
      rawExpose: [],
    };

    it("returns null for an unknown device", () => {
      expect(manager.getDeviceDataValue("shelly_mqtt", "ghost", "energy_forward")).toBeNull();
    });

    it("returns null for an unknown key on an existing device", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      expect(
        manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "missing_key"),
      ).toBeNull();
    });

    it("returns null when the key value has never been written", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      expect(
        manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "energy_forward"),
      ).toBeNull();
    });

    it("returns the numeric value for a number-typed key", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      manager.updateDeviceData("shelly_mqtt", "shelly-pro3em_00-em0", {
        energy_forward: 6105.7,
      });
      expect(
        manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "energy_forward"),
      ).toBe(6105.7);
    });

    it("returns the boolean value for a boolean-typed key", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      manager.updateDeviceData("shelly_mqtt", "shelly-pro3em_00-em0", { online: true });
      expect(manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "online")).toBe(
        true,
      );
    });

    it("returns the string value for a text-typed key", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      manager.updateDeviceData("shelly_mqtt", "shelly-pro3em_00-em0", { label: "main" });
      expect(manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "label")).toBe(
        "main",
      );
    });
  });

  describe("getDeviceDataValueById (issue #627)", () => {
    const sampleEm = {
      ieeeAddress: "0xshelly00",
      friendlyName: "shelly-pro3em_00-em0",
      manufacturer: "Shelly",
      model: "Pro3EM",
      data: [{ key: "online", type: "boolean" as const, category: "generic" as const }],
      orders: [],
      rawExpose: [],
    };

    it("returns null for an unknown deviceId", () => {
      expect(manager.getDeviceDataValueById("does-not-exist", "online")).toBeNull();
    });

    it("returns null when the key value has never been written", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      const device = manager.getAll().find((d) => d.name === "shelly-pro3em_00-em0")!;
      expect(manager.getDeviceDataValueById(device.id, "online")).toBeNull();
    });

    it("returns the same decoded value as getDeviceDataValue, keyed by internal id", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      manager.updateDeviceData("shelly_mqtt", "shelly-pro3em_00-em0", { online: true });
      const device = manager.getAll().find((d) => d.name === "shelly-pro3em_00-em0")!;
      expect(manager.getDeviceDataValueById(device.id, "online")).toBe(true);
      expect(manager.getDeviceDataValueById(device.id, "online")).toBe(
        manager.getDeviceDataValue("shelly_mqtt", "shelly-pro3em_00-em0", "online"),
      );
    });
  });

  describe("getDeviceDataLastUpdated", () => {
    const sampleEm = {
      ieeeAddress: "0xshelly00",
      friendlyName: "shelly-pro3em_00-em0",
      manufacturer: "Shelly",
      model: "Pro3EM",
      data: [
        { key: "energy_forward", type: "number" as const, category: "energy" as const, unit: "Wh" },
      ],
      orders: [],
      rawExpose: [],
    };

    it("returns null for an unknown device", () => {
      expect(manager.getDeviceDataLastUpdated("shelly_mqtt", "ghost", "energy_forward")).toBeNull();
    });

    it("returns null when the key has never been written", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      expect(
        manager.getDeviceDataLastUpdated("shelly_mqtt", "shelly-pro3em_00-em0", "energy_forward"),
      ).toBeNull();
    });

    it("returns an ISO 8601 UTC timestamp after a write", () => {
      manager.upsertFromDiscovery("shelly_mqtt", "shelly_mqtt", sampleEm);
      manager.updateDeviceData("shelly_mqtt", "shelly-pro3em_00-em0", {
        energy_forward: 6105.7,
      });
      const ts = manager.getDeviceDataLastUpdated(
        "shelly_mqtt",
        "shelly-pro3em_00-em0",
        "energy_forward",
      );
      // SQLite returns "YYYY-MM-DD HH:MM:SS" with a space; toISOUtc appends Z.
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      // Parsable into a recent timestamp (within last 10 min).
      const ageMs = Date.now() - new Date(ts!).getTime();
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThan(10 * 60 * 1000);
    });
  });
});

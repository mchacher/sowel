import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DeviceManager } from "./device-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EngineEvent } from "../shared/types.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of [
    "001_initial.sql",
    "002_mqtt_publisher_on_change_only.sql",
    "003_device_order_category.sql",
    "004_drop_dispatch_config.sql",
    "005_device_data_enum_values.sql",
    "006_pool_runtime_and_category_override.sql",
    "007_notification_alarm_reminder.sql",
  ]) {
    const sql = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../migrations", file),
      "utf-8",
    );
    db.exec(sql);
  }
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
});

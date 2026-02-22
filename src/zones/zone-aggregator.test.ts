import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZoneManager } from "./zone-manager.js";
import { ZoneAggregator } from "./zone-aggregator.js";
import { EquipmentManager } from "../equipments/equipment-manager.js";
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

describe("ZoneAggregator", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let zoneManager: ZoneManager;
  let equipmentManager: EquipmentManager;
  let aggregator: ZoneAggregator;
  let events: EngineEvent[];
  const mockMqtt = {
    publish: () => {},
    isConnected: () => true,
  };

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    equipmentManager = new EquipmentManager(db, eventBus, mockMqtt as never, logger);
    aggregator = new ZoneAggregator(zoneManager, equipmentManager, eventBus, logger);
    events = [];
    eventBus.on((event) => events.push(event));
  });

  afterEach(() => {
    db.close();
  });

  // ============================================================
  // computeAll
  // ============================================================

  describe("computeAll", () => {
    it("returns empty data for a zone with no equipments", () => {
      const zone = zoneManager.create({ name: "Salon" });
      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data).toEqual({
        temperature: null,
        humidity: null,
        luminosity: null,
        motion: false,
        motionSensors: 0,
        motionSince: null,
        openDoors: 0,
        openWindows: 0,
        waterLeak: false,
        smoke: false,
        lightsOn: 0,
        lightsTotal: 0,
        shuttersOpen: 0,
        shuttersTotal: 0,
        averageShutterPosition: null,
      });
    });

    it("aggregates temperature as AVG", () => {
      const zone = zoneManager.create({ name: "Salon" });

      // Create two temperature sensors
      const dev1 = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const dev2 = seedDevice(db, {
        name: "Temp2",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "22" }],
      });

      const eq1 = equipmentManager.create({ name: "Sensor 1", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "temperature");

      const eq2 = equipmentManager.create({ name: "Sensor 2", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "temperature");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.temperature).toBe(21);
    });

    it("aggregates humidity as AVG", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "TH1",
        dataKeys: [{ key: "humidity", type: "number", category: "humidity", value: "45" }],
      });

      const eq = equipmentManager.create({ name: "Sensor", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "humidity");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.humidity).toBe(45);
    });

    it("aggregates motion as OR (true if any active)", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev1 = seedDevice(db, {
        name: "PIR1",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
      });
      const dev2 = seedDevice(db, {
        name: "PIR2",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "true" }],
      });

      const eq1 = equipmentManager.create({ name: "PIR 1", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "occupancy");

      const eq2 = equipmentManager.create({ name: "PIR 2", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "occupancy");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.motion).toBe(true);
      expect(data?.motionSensors).toBe(2);
      expect(data?.motionSince).toEqual(expect.any(String));
    });

    it("aggregates motion as OR (false if all inactive)", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev1 = seedDevice(db, {
        name: "PIR1",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
      });

      const eq1 = equipmentManager.create({ name: "PIR 1", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "occupancy");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.motion).toBe(false);
      expect(data?.motionSensors).toBe(1);
      expect(data?.motionSince).toEqual(expect.any(String));
    });

    it("counts open doors from contact_door category", () => {
      const zone = zoneManager.create({ name: "Entrée" });

      // contact=false means open, contact=true means closed
      const dev1 = seedDevice(db, {
        name: "Door1",
        dataKeys: [{ key: "contact", type: "boolean", category: "contact_door", value: "false" }],
      });
      const dev2 = seedDevice(db, {
        name: "Door2",
        dataKeys: [{ key: "contact", type: "boolean", category: "contact_door", value: "true" }],
      });

      const eq1 = equipmentManager.create({
        name: "Porte entrée",
        type: "sensor",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "contact");

      const eq2 = equipmentManager.create({
        name: "Porte garage",
        type: "sensor",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "contact");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.openDoors).toBe(1);
    });

    it("counts open windows from contact_window category", () => {
      const zone = zoneManager.create({ name: "Chambre" });

      const dev = seedDevice(db, {
        name: "Window1",
        dataKeys: [{ key: "contact", type: "boolean", category: "contact_window", value: "false" }],
      });

      const eq = equipmentManager.create({ name: "Fenêtre", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "contact");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.openWindows).toBe(1);
    });

    it("aggregates water_leak as OR", () => {
      const zone = zoneManager.create({ name: "Cuisine" });

      const dev = seedDevice(db, {
        name: "Leak1",
        dataKeys: [{ key: "water_leak", type: "boolean", category: "water_leak", value: "true" }],
      });

      const eq = equipmentManager.create({ name: "Fuite eau", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "water_leak");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.waterLeak).toBe(true);
    });

    it("aggregates smoke as OR", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "Smoke1",
        dataKeys: [{ key: "smoke", type: "boolean", category: "smoke", value: "false" }],
      });

      const eq = equipmentManager.create({
        name: "Détecteur fumée",
        type: "sensor",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "smoke");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.smoke).toBe(false);
    });

    it("aggregates shutter position as AVG and counts open/total", () => {
      const zone = zoneManager.create({ name: "Salon" });

      // Shutter 1: position 80 (open)
      const dev1 = seedDevice(db, {
        name: "Shutter1",
        dataKeys: [{ key: "position", type: "number", category: "shutter_position", value: "80" }],
      });
      // Shutter 2: position 0 (closed)
      const dev2 = seedDevice(db, {
        name: "Shutter2",
        dataKeys: [{ key: "position", type: "number", category: "shutter_position", value: "0" }],
      });
      // Shutter 3: position 50 (open)
      const dev3 = seedDevice(db, {
        name: "Shutter3",
        dataKeys: [{ key: "position", type: "number", category: "shutter_position", value: "50" }],
      });

      const eq1 = equipmentManager.create({
        name: "Volet Salon",
        type: "shutter",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "position");

      const eq2 = equipmentManager.create({
        name: "Volet Chambre",
        type: "shutter",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "position");

      const eq3 = equipmentManager.create({
        name: "Volet Bureau",
        type: "shutter",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eq3.id, dev3.dataIds[0], "position");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.shuttersTotal).toBe(3);
      expect(data?.shuttersOpen).toBe(2); // position > 0
      expect(data?.averageShutterPosition).toBe(43); // round((80+0+50)/3) = 43
    });

    it("returns null averageShutterPosition when no shutters", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const eq = equipmentManager.create({ name: "Sensor", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "temperature");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.shuttersTotal).toBe(0);
      expect(data?.shuttersOpen).toBe(0);
      expect(data?.averageShutterPosition).toBeNull();
    });

    it("counts lights on and total from light_state category", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev1 = seedDevice(db, {
        name: "Light1",
        dataKeys: [
          { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("ON") },
        ],
        orderKeys: [{ key: "state", payloadKey: "state" }],
      });
      const dev2 = seedDevice(db, {
        name: "Light2",
        dataKeys: [
          { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
        ],
        orderKeys: [{ key: "state", payloadKey: "state" }],
      });

      const eq1 = equipmentManager.create({ name: "Spots", type: "light_onoff", zoneId: zone.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "state");

      const eq2 = equipmentManager.create({ name: "Lampe", type: "light_onoff", zoneId: zone.id });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "state");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.lightsOn).toBe(1);
      expect(data?.lightsTotal).toBe(2);
    });
  });

  // ============================================================
  // Recursive aggregation
  // ============================================================

  describe("recursive aggregation", () => {
    it("parent zone aggregates children data", () => {
      const parent = zoneManager.create({ name: "Étage 1" });
      const child1 = zoneManager.create({ name: "Salon", parentId: parent.id });
      const child2 = zoneManager.create({ name: "Cuisine", parentId: parent.id });

      // Salon: temperature 20
      const dev1 = seedDevice(db, {
        name: "TempSalon",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const eq1 = equipmentManager.create({
        name: "Temp Salon",
        type: "sensor",
        zoneId: child1.id,
      });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "temperature");

      // Cuisine: temperature 22
      const dev2 = seedDevice(db, {
        name: "TempCuisine",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "22" }],
      });
      const eq2 = equipmentManager.create({
        name: "Temp Cuisine",
        type: "sensor",
        zoneId: child2.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "temperature");

      aggregator.computeAll();

      // Parent should have AVG of 20 and 22 = 21
      const parentData = aggregator.getByZoneId(parent.id);
      expect(parentData?.temperature).toBe(21);

      // Children should have their own values
      expect(aggregator.getByZoneId(child1.id)?.temperature).toBe(20);
      expect(aggregator.getByZoneId(child2.id)?.temperature).toBe(22);
    });

    it("parent aggregates motion OR across children", () => {
      const parent = zoneManager.create({ name: "Étage 1" });
      const child1 = zoneManager.create({ name: "Salon", parentId: parent.id });
      const child2 = zoneManager.create({ name: "Cuisine", parentId: parent.id });

      // Salon: no motion
      const dev1 = seedDevice(db, {
        name: "PIRSalon",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
      });
      const eq1 = equipmentManager.create({ name: "PIR Salon", type: "sensor", zoneId: child1.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "occupancy");

      // Cuisine: motion detected
      const dev2 = seedDevice(db, {
        name: "PIRCuisine",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "true" }],
      });
      const eq2 = equipmentManager.create({
        name: "PIR Cuisine",
        type: "sensor",
        zoneId: child2.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "occupancy");

      aggregator.computeAll();

      // Parent has motion because Cuisine has motion
      expect(aggregator.getByZoneId(parent.id)?.motion).toBe(true);
      expect(aggregator.getByZoneId(parent.id)?.motionSensors).toBe(2);
      expect(aggregator.getByZoneId(child1.id)?.motion).toBe(false);
      expect(aggregator.getByZoneId(child1.id)?.motionSensors).toBe(1);
      expect(aggregator.getByZoneId(child2.id)?.motion).toBe(true);
      expect(aggregator.getByZoneId(child2.id)?.motionSensors).toBe(1);
    });

    it("parent aggregates shutter data from children", () => {
      const parent = zoneManager.create({ name: "Maison" });
      const child1 = zoneManager.create({ name: "Salon", parentId: parent.id });
      const child2 = zoneManager.create({ name: "Chambre", parentId: parent.id });

      // Salon: shutter at 100 (open)
      const dev1 = seedDevice(db, {
        name: "Shutter1",
        dataKeys: [{ key: "position", type: "number", category: "shutter_position", value: "100" }],
      });
      const eq1 = equipmentManager.create({
        name: "Volet Salon",
        type: "shutter",
        zoneId: child1.id,
      });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "position");

      // Chambre: shutter at 0 (closed)
      const dev2 = seedDevice(db, {
        name: "Shutter2",
        dataKeys: [{ key: "position", type: "number", category: "shutter_position", value: "0" }],
      });
      const eq2 = equipmentManager.create({
        name: "Volet Chambre",
        type: "shutter",
        zoneId: child2.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "position");

      aggregator.computeAll();

      const parentData = aggregator.getByZoneId(parent.id);
      expect(parentData?.shuttersTotal).toBe(2);
      expect(parentData?.shuttersOpen).toBe(1);
      expect(parentData?.averageShutterPosition).toBe(50); // (100+0)/2

      expect(aggregator.getByZoneId(child1.id)?.shuttersOpen).toBe(1);
      expect(aggregator.getByZoneId(child2.id)?.shuttersOpen).toBe(0);
    });

    it("parent sums light counts from children", () => {
      const parent = zoneManager.create({ name: "Maison" });
      const child1 = zoneManager.create({ name: "Salon", parentId: parent.id });
      const child2 = zoneManager.create({ name: "Cuisine", parentId: parent.id });

      // Salon: 1 light on
      const dev1 = seedDevice(db, {
        name: "Light1",
        dataKeys: [
          { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("ON") },
        ],
      });
      const eq1 = equipmentManager.create({
        name: "Spots Salon",
        type: "light_onoff",
        zoneId: child1.id,
      });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "state");

      // Cuisine: 1 light off
      const dev2 = seedDevice(db, {
        name: "Light2",
        dataKeys: [
          { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("OFF") },
        ],
      });
      const eq2 = equipmentManager.create({
        name: "Plafonnier Cuisine",
        type: "light_onoff",
        zoneId: child2.id,
      });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "state");

      aggregator.computeAll();

      const parentData = aggregator.getByZoneId(parent.id);
      expect(parentData?.lightsOn).toBe(1);
      expect(parentData?.lightsTotal).toBe(2);
    });
  });

  // ============================================================
  // Reactive updates via equipment.data.changed
  // ============================================================

  describe("reactive updates", () => {
    it("updates aggregation when equipment data changes", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const eq = equipmentManager.create({ name: "Sensor", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "temperature");

      aggregator.computeAll();
      expect(aggregator.getByZoneId(zone.id)?.temperature).toBe(20);

      // Simulate device data update → equipment.data.changed
      db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run("25", dev.dataIds[0]);
      events.length = 0;

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eq.id,
        alias: "temperature",
        value: 25,
        previous: 20,
      });

      expect(aggregator.getByZoneId(zone.id)?.temperature).toBe(25);

      // Should have emitted zone.data.changed
      const zoneEvents = events.filter((e) => e.type === "zone.data.changed");
      expect(zoneEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("does not emit zone.data.changed when aggregation is unchanged", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const eq = equipmentManager.create({ name: "Sensor", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "temperature");

      aggregator.computeAll();
      events.length = 0;

      // Emit equipment.data.changed but value didn't actually change in DB
      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eq.id,
        alias: "temperature",
        value: 20,
        previous: 20,
      });

      const zoneEvents = events.filter((e) => e.type === "zone.data.changed");
      expect(zoneEvents).toHaveLength(0);
    });

    it("propagates changes up the parent chain", () => {
      const parent = zoneManager.create({ name: "Étage" });
      const child = zoneManager.create({ name: "Salon", parentId: parent.id });

      const dev = seedDevice(db, {
        name: "PIR1",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
      });
      const eq = equipmentManager.create({ name: "PIR", type: "sensor", zoneId: child.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "occupancy");

      aggregator.computeAll();
      expect(aggregator.getByZoneId(parent.id)?.motion).toBe(false);

      // Motion detected
      db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run("true", dev.dataIds[0]);
      events.length = 0;

      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eq.id,
        alias: "occupancy",
        value: true,
        previous: false,
      });

      expect(aggregator.getByZoneId(child.id)?.motion).toBe(true);
      expect(aggregator.getByZoneId(parent.id)?.motion).toBe(true);

      // Both zones should have emitted zone.data.changed
      const zoneEvents = events.filter((e) => e.type === "zone.data.changed");
      expect(zoneEvents).toHaveLength(2);
    });

    it("updates motionSince on motion state transition", () => {
      const zone = zoneManager.create({ name: "Entrée" });

      const dev = seedDevice(db, {
        name: "PIR1",
        dataKeys: [{ key: "occupancy", type: "boolean", category: "motion", value: "false" }],
      });
      const eq = equipmentManager.create({ name: "PIR", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "occupancy");

      aggregator.computeAll();
      const initialSince = aggregator.getByZoneId(zone.id)?.motionSince;
      expect(initialSince).toEqual(expect.any(String));

      // Simulate same-value update (no motion change) — motionSince should be preserved
      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eq.id,
        alias: "occupancy",
        value: false,
        previous: false,
      });
      expect(aggregator.getByZoneId(zone.id)?.motionSince).toBe(initialSince);

      // Now motion detected — motionSince should change
      db.prepare("UPDATE device_data SET value = ? WHERE id = ?").run("true", dev.dataIds[0]);
      eventBus.emit({
        type: "equipment.data.changed",
        equipmentId: eq.id,
        alias: "occupancy",
        value: true,
        previous: false,
      });

      const newSince = aggregator.getByZoneId(zone.id)?.motionSince;
      expect(newSince).toEqual(expect.any(String));
      expect(aggregator.getByZoneId(zone.id)?.motion).toBe(true);
    });

    it("motionSince is null for zones without motion sensors", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const dev = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const eq = equipmentManager.create({ name: "Sensor", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq.id, dev.dataIds[0], "temperature");

      aggregator.computeAll();
      expect(aggregator.getByZoneId(zone.id)?.motionSince).toBeNull();
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================

  describe("edge cases", () => {
    it("handles null values in bindings (excluded from AVG)", () => {
      const zone = zoneManager.create({ name: "Salon" });

      // One sensor with value, one with null
      const dev1 = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "20" }],
      });
      const dev2 = seedDevice(db, {
        name: "Temp2",
        dataKeys: [
          {
            key: "temperature",
            type: "number",
            category: "temperature",
            value: null as unknown as string,
          },
        ],
      });

      const eq1 = equipmentManager.create({ name: "Sensor 1", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq1.id, dev1.dataIds[0], "temperature");

      const eq2 = equipmentManager.create({ name: "Sensor 2", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eq2.id, dev2.dataIds[0], "temperature");

      aggregator.computeAll();

      // Should only use the non-null value
      const data = aggregator.getByZoneId(zone.id);
      expect(data?.temperature).toBe(20);
    });

    it("getAll returns data for all zones", () => {
      const z1 = zoneManager.create({ name: "Salon" });
      const z2 = zoneManager.create({ name: "Cuisine" });

      aggregator.computeAll();

      const all = aggregator.getAll();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all[z1.id]).toBeDefined();
      expect(all[z2.id]).toBeDefined();
    });

    it("returns null for unknown zone", () => {
      expect(aggregator.getByZoneId("unknown")).toBeNull();
    });

    it("handles mixed sensor and light data in same zone", () => {
      const zone = zoneManager.create({ name: "Salon" });

      const devTemp = seedDevice(db, {
        name: "Temp1",
        dataKeys: [{ key: "temperature", type: "number", category: "temperature", value: "21.5" }],
      });
      const devLight = seedDevice(db, {
        name: "Light1",
        dataKeys: [
          { key: "state", type: "boolean", category: "light_state", value: JSON.stringify("ON") },
        ],
      });

      const eqTemp = equipmentManager.create({ name: "Temp", type: "sensor", zoneId: zone.id });
      equipmentManager.addDataBinding(eqTemp.id, devTemp.dataIds[0], "temperature");

      const eqLight = equipmentManager.create({
        name: "Spots",
        type: "light_onoff",
        zoneId: zone.id,
      });
      equipmentManager.addDataBinding(eqLight.id, devLight.dataIds[0], "state");

      aggregator.computeAll();

      const data = aggregator.getByZoneId(zone.id);
      expect(data?.temperature).toBe(21.5);
      expect(data?.lightsOn).toBe(1);
      expect(data?.lightsTotal).toBe(1);
    });
  });
});

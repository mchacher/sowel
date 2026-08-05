import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { EquipmentManager } from "./equipment-manager.js";
import { WeatherTempExtremesTracker } from "./weather-temp-extremes-tracker.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? ".", "../../migrations");

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (file.endsWith(".sql")) db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf-8"));
  }
  return db;
}

const logger = createLogger("silent").logger;

function seedDevice(
  db: Database.Database,
  dataKeys: { key: string; category: string }[],
): { dataIds: string[] } {
  const deviceId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO devices (id, mqtt_base_topic, mqtt_name, name, source, status, integration_id, source_device_id)
     VALUES (?, ?, ?, ?, 'zigbee2mqtt', 'online', 'zigbee2mqtt', ?)`,
  ).run(deviceId, `z2m/weather`, "Weather", "Weather", "Weather");

  const dataIds: string[] = [];
  for (const d of dataKeys) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO device_data (id, device_id, key, type, category) VALUES (?, ?, ?, 'number', ?)`,
    ).run(id, deviceId, d.key, d.category);
    dataIds.push(id);
  }
  return { dataIds };
}

describe("WeatherTempExtremesTracker", () => {
  let db: Database.Database;
  let eventBus: EventBus;
  let zoneManager: ZoneManager;
  let deviceManager: DeviceManager;
  let equipmentManager: EquipmentManager;
  let tracker: WeatherTempExtremesTracker;

  beforeEach(() => {
    db = createTestDb();
    eventBus = new EventBus(logger);
    zoneManager = new ZoneManager(db, eventBus, logger);
    deviceManager = new DeviceManager(db, eventBus, logger);
    equipmentManager = new EquipmentManager(
      db,
      eventBus,
      { getById: () => null, dispatchOrder: async () => {} } as never,
      deviceManager,
      logger,
    );
  });

  afterEach(() => {
    tracker?.stop();
    db.close();
    vi.useRealTimers();
  });

  function createWeatherEquipment(opts?: { type?: string }): {
    eqId: string;
    aliases: string[];
  } {
    const zone = zoneManager.create({ name: "Jardin" });
    const eq = equipmentManager.create({
      name: "Station",
      type: (opts?.type ?? "weather") as never,
      zoneId: zone.id,
    });
    const { dataIds } = seedDevice(db, [
      { key: "temperature", category: "temperature_outdoor" },
      { key: "temperature_in", category: "temperature" },
      { key: "humidity", category: "humidity" },
    ]);
    equipmentManager.addDataBinding(eq.id, dataIds[0], "temperature");
    equipmentManager.addDataBinding(eq.id, dataIds[1], "temperature_2");
    equipmentManager.addDataBinding(eq.id, dataIds[2], "humidity");
    return { eqId: eq.id, aliases: ["temperature", "temperature_2", "humidity"] };
  }

  function startTracker(): void {
    tracker = new WeatherTempExtremesTracker(db, eventBus, equipmentManager, logger);
    tracker.start();
  }

  function emitSample(eqId: string, alias: string, value: unknown): void {
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId: eqId,
      alias,
      value,
      previous: null,
    });
  }

  function entriesOf(eqId: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const e of tracker.getComputedDataForEquipment(eqId)) out[e.alias] = e.value;
    return out;
  }

  it("first sample of the day sets min = max = sample and persists", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 21.5);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 21.5,
      temperature_max_today: 21.5,
    });
    const row = db
      .prepare(`SELECT * FROM weather_temp_extremes WHERE equipment_id = ? AND alias = ?`)
      .get(eqId, "temperature") as { min_value: number; max_value: number };
    expect(row.min_value).toBe(21.5);
    expect(row.max_value).toBe(21.5);
  });

  it("min and max update independently over the day", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 20);
    emitSample(eqId, "temperature", 17.2);
    emitSample(eqId, "temperature", 26.8);
    emitSample(eqId, "temperature", 22); // inside envelope — no change

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 17.2,
      temperature_max_today: 26.8,
    });
  });

  it("resets the envelope on day rollover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T23:50:00"));
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 15);
    emitSample(eqId, "temperature", 25);

    vi.setSystemTime(new Date("2026-08-06T00:10:00"));
    emitSample(eqId, "temperature", 18);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 18,
      temperature_max_today: 18,
    });
  });

  it("hides yesterday's envelope before the first sample of the new day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T23:50:00"));
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 15);

    vi.setSystemTime(new Date("2026-08-06T00:10:00"));
    expect(entriesOf(eqId)).toEqual({});
  });

  it("reloads today's envelope from SQLite on restart", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 12.5);
    emitSample(eqId, "temperature", 24);
    tracker.stop();

    // New instance simulating a process restart on the same DB.
    tracker = new WeatherTempExtremesTracker(db, eventBus, equipmentManager, logger);
    tracker.start();
    emitSample(eqId, "temperature", 20); // inside envelope

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 12.5,
      temperature_max_today: 24,
    });
  });

  it("does not load a persisted row from a past day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T12:00:00"));
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 15);
    tracker.stop();

    vi.setSystemTime(new Date("2026-08-06T08:00:00"));
    tracker = new WeatherTempExtremesTracker(db, eventBus, equipmentManager, logger);
    tracker.start();

    expect(entriesOf(eqId)).toEqual({});
    emitSample(eqId, "temperature", 9);
    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 9,
      temperature_max_today: 9,
    });
  });

  it("ignores non-numeric and non-finite values", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", null);
    emitSample(eqId, "temperature", "22");
    emitSample(eqId, "temperature", NaN);

    expect(entriesOf(eqId)).toEqual({});
  });

  it("ignores non-weather equipments", () => {
    const { eqId } = createWeatherEquipment({ type: "sensor" });
    startTracker();
    emitSample(eqId, "temperature", 21);

    expect(tracker.getComputedDataForEquipment(eqId)).toEqual([]);
    const rows = db.prepare(`SELECT * FROM weather_temp_extremes`).all();
    expect(rows).toHaveLength(0);
  });

  it("ignores bindings whose category is not temperature*", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "humidity", 55);

    expect(entriesOf(eqId)).toEqual({});
  });

  it("tracks indoor and outdoor bindings independently with their categories", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 27.5);
    emitSample(eqId, "temperature", 14);
    emitSample(eqId, "temperature_2", 22);
    emitSample(eqId, "temperature_2", 25.5);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 14,
      temperature_max_today: 27.5,
      temperature_2_min_today: 22,
      temperature_2_max_today: 25.5,
    });
    const cats = new Map(
      tracker.getComputedDataForEquipment(eqId).map((e) => [e.alias, e.category]),
    );
    expect(cats.get("temperature_min_today")).toBe("temperature_outdoor");
    expect(cats.get("temperature_2_max_today")).toBe("temperature");
  });

  it("removes state and rows when the equipment is deleted", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 21);
    equipmentManager.delete(eqId);

    expect(tracker.getComputedDataForEquipment(eqId)).toEqual([]);
    const rows = db.prepare(`SELECT * FROM weather_temp_extremes`).all();
    expect(rows).toHaveLength(0);
  });
});

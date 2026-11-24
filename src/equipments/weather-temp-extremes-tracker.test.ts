import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import { EquipmentManager } from "./equipment-manager.js";
import { applyMigrations } from "../test-helpers/migrations.js";
import { WeatherTempExtremesTracker } from "./weather-temp-extremes-tracker.js";
import { DeviceManager } from "../devices/device-manager.js";
import { ZoneManager } from "../zones/zone-manager.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
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
  ).run(deviceId, `z2m/weather`, "Weather", "Weather", deviceId);

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

  // ── Spec 211 FR1 — every thermometer ────────────────────────────

  function createEquipment(
    type: string,
    bindings: { key: string; category: string; alias: string }[],
  ): string {
    const zone = zoneManager.create({ name: "Séjour" });
    const eq = equipmentManager.create({ name: "Eq", type: type as never, zoneId: zone.id });
    const { dataIds } = seedDevice(
      db,
      bindings.map((b) => ({ key: b.key, category: b.category })),
    );
    bindings.forEach((b, i) => equipmentManager.addDataBinding(eq.id, dataIds[i], b.alias));
    return eq.id;
  }

  function lastUpdatedOf(eqId: string, alias: string): string | null | undefined {
    return tracker.getComputedDataForEquipment(eqId).find((e) => e.alias === alias)?.lastUpdated;
  }

  it("spec 211 FR1.1/FR1.2 — a sensor's temperature gets today's extremes", () => {
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "temperature", 15);
    emitSample(eqId, "temperature", 18);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 15,
      temperature_max_today: 18,
    });
    const entry = tracker
      .getComputedDataForEquipment(eqId)
      .find((e) => e.alias === "temperature_min_today");
    expect(entry?.unit).toBe("°C");
  });

  it("spec 211 FR1.1 — on a sensor only the alias `temperature` is tracked, not `temperature_2`", () => {
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
      { key: "temperature_b", category: "temperature", alias: "temperature_2" },
    ]);
    startTracker();
    emitSample(eqId, "temperature", 20);
    emitSample(eqId, "temperature_2", 30);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 20,
      temperature_max_today: 20,
    });
  });

  it("spec 211 FR1.1 — a temperature_outdoor binding is tracked under its own alias", () => {
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature_outdoor", alias: "outdoor" },
    ]);
    startTracker();
    emitSample(eqId, "outdoor", 4);
    emitSample(eqId, "outdoor", 9.5);

    expect(entriesOf(eqId)).toEqual({ outdoor_min_today: 4, outdoor_max_today: 9.5 });
    const cats = tracker.getComputedDataForEquipment(eqId).map((e) => e.category);
    expect(cats).toEqual(["temperature_outdoor", "temperature_outdoor"]);
  });

  it("spec 211 FR1.1 — a thermostat setpoint is never tracked, its `temperature` reading is", () => {
    const eqId = createEquipment("thermostat", [
      { key: "setpoint", category: "temperature", alias: "setpoint" },
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "setpoint", 21);
    emitSample(eqId, "temperature", 19.5);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 19.5,
      temperature_max_today: 19.5,
    });
    const rows = db.prepare(`SELECT alias FROM weather_temp_extremes`).all();
    expect(rows).toEqual([{ alias: "temperature" }]);
  });

  it("spec 211 FR1.1 — a sensor with humidity only gets nothing", () => {
    const eqId = createEquipment("sensor", [
      { key: "humidity", category: "humidity", alias: "humidity" },
    ]);
    startTracker();
    emitSample(eqId, "humidity", 55);

    expect(tracker.getComputedDataForEquipment(eqId)).toEqual([]);
    expect(db.prepare(`SELECT * FROM weather_temp_extremes`).all()).toHaveLength(0);
  });

  it("spec 211 FR1.1 — any equipment type follows the rule (light with a temperature binding)", () => {
    const eqId = createEquipment("light_onoff", [
      { key: "device_temperature", category: "temperature", alias: "device_temperature" },
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "device_temperature", 45);
    emitSample(eqId, "temperature", 22);

    expect(entriesOf(eqId)).toEqual({
      temperature_min_today: 22,
      temperature_max_today: 22,
    });
  });

  it("spec 211 FR1.2 — a sensor sampled yesterday only shows nothing today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T22:00:00"));
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "temperature", 12);

    vi.setSystemTime(new Date("2026-11-17T07:00:00"));
    expect(entriesOf(eqId)).toEqual({});
  });

  it("spec 211 FR1.3 — lastUpdated follows a sample inside the envelope, without a SQLite write", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T06:30:00"));
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "temperature", 3);
    emitSample(eqId, "temperature", 11);
    const rowBefore = db.prepare(`SELECT updated_at FROM weather_temp_extremes`).get();

    vi.setSystemTime(new Date("2026-11-17T18:00:00"));
    emitSample(eqId, "temperature", 7); // inside the envelope

    const at18 = new Date("2026-11-17T18:00:00").toISOString();
    expect(lastUpdatedOf(eqId, "temperature_min_today")).toBe(at18);
    expect(lastUpdatedOf(eqId, "temperature_max_today")).toBe(at18);
    expect(entriesOf(eqId)).toEqual({ temperature_min_today: 3, temperature_max_today: 11 });
    expect(db.prepare(`SELECT updated_at FROM weather_temp_extremes`).get()).toEqual(rowBefore);
  });

  it("spec 211 FR1.3 — after a restart lastUpdated is the row's updated_at until the next sample", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T06:30:00"));
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    emitSample(eqId, "temperature", 3);
    vi.setSystemTime(new Date("2026-11-17T09:00:00"));
    emitSample(eqId, "temperature", 5); // widens the max: row written at 09:00
    vi.setSystemTime(new Date("2026-11-17T10:00:00"));
    emitSample(eqId, "temperature", 4); // inside, memory only
    tracker.stop();

    vi.setSystemTime(new Date("2026-11-17T12:00:00"));
    tracker = new WeatherTempExtremesTracker(db, eventBus, equipmentManager, logger);
    tracker.start();
    const at09 = new Date("2026-11-17T09:00:00").toISOString();
    expect(lastUpdatedOf(eqId, "temperature_min_today")).toBe(at09);
    expect(entriesOf(eqId)).toEqual({ temperature_min_today: 3, temperature_max_today: 5 });

    vi.setSystemTime(new Date("2026-11-17T12:05:00"));
    emitSample(eqId, "temperature", 4.5);
    expect(lastUpdatedOf(eqId, "temperature_min_today")).toBe(
      new Date("2026-11-17T12:05:00").toISOString(),
    );
  });

  it("spec 211 FR1.5 — a sensor's extremes are emitted as equipment.data.changed", () => {
    const eqId = createEquipment("sensor", [
      { key: "temperature", category: "temperature", alias: "temperature" },
    ]);
    startTracker();
    const seen: string[] = [];
    eventBus.on((e) => {
      if (e.type === "equipment.data.changed" && e.equipmentId === eqId) seen.push(e.alias);
    });
    emitSample(eqId, "temperature", 17);

    expect(seen).toEqual(
      expect.arrayContaining(["temperature_min_today", "temperature_max_today"]),
    );
  });

  it("spec 211 — a binding added after start is tracked (the cache follows equipment.updated)", () => {
    const eqId = createEquipment("sensor", [
      { key: "humidity", category: "humidity", alias: "humidity" },
    ]);
    startTracker();
    emitSample(eqId, "humidity", 50); // caches "nothing tracked" for this equipment

    const { dataIds } = seedDevice(db, [{ key: "temperature", category: "temperature" }]);
    equipmentManager.addDataBinding(eqId, dataIds[0], "temperature");
    emitSample(eqId, "temperature", 19);

    expect(entriesOf(eqId)).toEqual({ temperature_min_today: 19, temperature_max_today: 19 });
  });

  it("spec 211 — a weather station retyped to sensor stops showing temperature_2's envelope", () => {
    const { eqId } = createWeatherEquipment();
    startTracker();
    emitSample(eqId, "temperature", 10);
    emitSample(eqId, "temperature_2", 21);
    expect(Object.keys(entriesOf(eqId))).toContain("temperature_2_min_today");

    equipmentManager.update(eqId, { type: "sensor" as never });

    // `temperature` is temperature_outdoor here, so it stays tracked.
    expect(entriesOf(eqId)).toEqual({ temperature_min_today: 10, temperature_max_today: 10 });
  });
});

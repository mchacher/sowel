import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BatteryMonitor,
  classifyBattery,
  isBatteryData,
  isBatteryPowered,
} from "./battery-monitor.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { DeviceWithDetails, EngineEvent, Equipment, PowerSource } from "../shared/types.js";
import type { DeviceManager } from "./device-manager.js";

const logger = createLogger("silent").logger;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  for (const file of ["001_initial.sql", "017_battery_alerts.sql"]) {
    db.exec(readFileSync(resolve(import.meta.dirname ?? ".", `../../migrations/${file}`), "utf-8"));
  }
  return db;
}

interface DataSpec {
  id?: string;
  key?: string;
  category?: string;
  value?: unknown;
}

function makeDevice(
  overrides: { id?: string; name?: string; powerSource?: PowerSource; data?: DataSpec[] } = {},
): DeviceWithDetails {
  const data = (overrides.data ?? [{ value: 12 }]).map((d, i) => ({
    id: d.id ?? `dd-${i + 1}`,
    deviceId: overrides.id ?? "dev-1",
    key: d.key ?? "battery",
    type: "number" as const,
    category: (d.category ?? "battery") as DeviceWithDetails["data"][number]["category"],
    value: d.value ?? 12,
    lastUpdated: "2026-08-12 10:00:00Z",
  }));
  return {
    id: overrides.id ?? "dev-1",
    integrationId: "zigbee2mqtt",
    sourceDeviceId: "src-1",
    name: overrides.name ?? "Capteur porte",
    zoneId: null,
    source: "zigbee2mqtt",
    status: "online",
    powerSource: overrides.powerSource ?? "unknown",
    lastSeen: "2026-08-12 10:00:00Z",
    createdAt: "2026-01-01 00:00:00Z",
    updatedAt: "2026-08-12 10:00:00Z",
    data,
    orders: [],
  };
}

/** Stub EquipmentManager: maps a deviceId to the equipments bound to it. */
function mkEquipmentManager(byDevice: Record<string, Equipment[]> = {}): EquipmentManager {
  return {
    getEquipmentsForDeviceId: (deviceId: string) => byDevice[deviceId] ?? [],
  } as unknown as EquipmentManager;
}

function eq(id: string, name: string, zoneId: string): Equipment {
  return {
    id,
    name,
    zoneId,
    type: "sensor",
    enabled: true,
    createdAt: "2026-08-12T00:00:00Z",
    updatedAt: "2026-08-12T00:00:00Z",
  };
}

function createHarness(
  devices: DeviceWithDetails[] = [],
  equipmentsByDevice: Record<string, Equipment[]> = {},
) {
  const db = createTestDb();
  const eventBus = new EventBus(logger);
  const events: EngineEvent[] = [];
  eventBus.on((e) => events.push(e));

  let current = devices;
  const deviceManager = {
    getAllWithData: () => current,
  } as unknown as DeviceManager;

  const monitor = new BatteryMonitor(
    db,
    eventBus,
    deviceManager,
    mkEquipmentManager(equipmentsByDevice),
    logger,
  );
  return {
    db,
    eventBus,
    events,
    monitor,
    setDevices: (next: DeviceWithDetails[]) => (current = next),
    raised: () => events.filter((e) => e.type === "system.alarm.raised"),
    resolved: () => events.filter((e) => e.type === "system.alarm.resolved"),
    rows: () => db.prepare("SELECT * FROM battery_alerts").all() as { device_data_id: string }[],
  };
}

// ─── pure classifiers ───────────────────────────────────────────────────

describe("classifyBattery", () => {
  it("treats a percentage at or under 20 as low", () => {
    for (const v of [0, 1, 12, 20, "12"]) expect(classifyBattery(v)).toBe("low");
  });

  it("treats a percentage at or over 25 as ok", () => {
    for (const v of [25, 40, 100, "87"]) expect(classifyBattery(v)).toBe("ok");
  });

  it("holds the current state inside the hysteresis band", () => {
    for (const v of [21, 22, 24]) expect(classifyBattery(v)).toBe("ignore");
  });

  it("reads booleans as the battery_low flag", () => {
    expect(classifyBattery(true)).toBe("low");
    expect(classifyBattery("true")).toBe("low");
    expect(classifyBattery(false)).toBe("ok");
    expect(classifyBattery("false")).toBe("ok");
  });

  it("ignores what is not a plausible percentage", () => {
    for (const v of [null, undefined, "", "unknown", 3000, -1, 101, NaN]) {
      expect(classifyBattery(v)).toBe("ignore");
    }
  });
});

describe("isBatteryPowered", () => {
  it("trusts an explicit declaration", () => {
    expect(isBatteryPowered(makeDevice({ powerSource: "battery" }))).toBe(true);
    expect(isBatteryPowered(makeDevice({ powerSource: "mains" }))).toBe(false);
    expect(isBatteryPowered(makeDevice({ powerSource: "dc" }))).toBe(false);
  });

  it("declaration wins over the heuristic", () => {
    const metering = makeDevice({
      powerSource: "battery",
      data: [{ value: 12 }, { key: "power", category: "power", value: 800 }],
    });
    expect(isBatteryPowered(metering)).toBe(true);
  });

  it("falls back to mains metering when the power source is unknown", () => {
    for (const category of ["power", "energy", "current"]) {
      const device = makeDevice({ data: [{ value: 12 }, { key: category, category, value: 1 }] });
      expect(isBatteryPowered(device)).toBe(false);
    }
  });

  it("does not read cell voltage as a mains marker", () => {
    const sensor = makeDevice({
      data: [{ value: 12 }, { key: "voltage", category: "voltage", value: 2900 }],
    });
    expect(isBatteryPowered(sensor)).toBe(true);
  });
});

describe("isBatteryData", () => {
  it("matches the battery category", () => {
    expect(isBatteryData({ key: "battery", category: "battery" })).toBe(true);
  });

  it("matches a battery_low key whatever its category (plugins before z2m 2.5.0)", () => {
    expect(isBatteryData({ key: "battery_low", category: "generic" })).toBe(true);
  });

  it("ignores anything else", () => {
    expect(isBatteryData({ key: "temperature", category: "temperature" })).toBe(false);
  });
});

// ─── alarm lifecycle ────────────────────────────────────────────────────

describe("BatteryMonitor", () => {
  let harness: ReturnType<typeof createHarness>;

  afterEach(() => {
    harness?.monitor.destroy();
    harness?.db.close();
  });

  it("raises one alarm and persists it when a battery device goes low", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()).toHaveLength(1);
    expect(harness.raised()[0]).toMatchObject({
      alarmId: "battery-low:dd-1",
      level: "warning",
      source: "Capteur porte",
      message: "Low battery: 12%",
    });
    expect(harness.rows()).toHaveLength(1);
    expect(harness.monitor.getActiveAlerts()).toHaveLength(1);
  });

  it("does not re-notify while the battery stays low", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();
    harness.monitor.sweep();
    harness.monitor.sweep();

    expect(harness.raised()).toHaveLength(1);
  });

  it("raises on a battery_low boolean without a percentage", () => {
    harness = createHarness([
      makeDevice({
        powerSource: "battery",
        data: [{ key: "battery_low", category: "generic", value: true }],
      }),
    ]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()[0]).toMatchObject({ message: "Low battery" });
  });

  // ─── equipment context (spec 143/#472) ──────────────────────────────────

  it("labels the alarm with the equipment name and scopes it to the equipment's zone", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })], {
      "dev-1": [eq("e1", "Détecteur salon", "zone-salon")],
    });
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()[0]).toMatchObject({
      source: "Détecteur salon", // equipment name headlines the alarm
      message: "Low battery: 12% (Capteur porte)", // device name stays in the message
      zoneId: "zone-salon",
    });
  });

  it("lists several bound equipments and uses the first one's zone", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })], {
      "dev-1": [eq("e1", "Détecteur salon", "zone-salon"), eq("e2", "Alarme", "zone-hall")],
    });
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()[0]).toMatchObject({
      source: "Détecteur salon, Alarme",
      zoneId: "zone-salon",
    });
  });

  it("falls back to the device name and a global (null) zone when the device is unbound", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]); // no equipment bound
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()[0]).toMatchObject({
      source: "Capteur porte",
      message: "Low battery: 12%",
      zoneId: null,
    });
  });

  it("getActiveAlerts resolves the equipment names and zone live", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })], {
      "dev-1": [eq("e1", "Détecteur salon", "zone-salon")],
    });
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.monitor.getActiveAlerts()[0]).toMatchObject({
      deviceName: "Capteur porte",
      equipmentNames: ["Détecteur salon"],
      zoneId: "zone-salon",
    });
  });

  it("ignores a mains-powered device whatever its battery value", () => {
    harness = createHarness([makeDevice({ powerSource: "mains" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()).toHaveLength(0);
    expect(harness.rows()).toHaveLength(0);
  });

  it("ignores a device that meters mains electricity when the power source is unknown", () => {
    harness = createHarness([
      makeDevice({ data: [{ value: 12 }, { key: "power", category: "power", value: 800 }] }),
    ]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()).toHaveLength(0);
  });

  it("resolves once the battery is replaced", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    harness.setDevices([makeDevice({ powerSource: "battery", data: [{ value: 87 }] })]);
    harness.monitor.sweep();

    expect(harness.resolved()).toHaveLength(1);
    expect(harness.resolved()[0]).toMatchObject({
      alarmId: "battery-low:dd-1",
      message: "Battery back to 87%",
    });
    expect(harness.rows()).toHaveLength(0);
  });

  it("keeps the alarm inside the hysteresis band", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    harness.setDevices([makeDevice({ powerSource: "battery", data: [{ value: 22 }] })]);
    harness.monitor.sweep();

    expect(harness.resolved()).toHaveLength(0);
    expect(harness.rows()).toHaveLength(1);
  });

  it("does not raise on a healthy battery drifting into the band", () => {
    harness = createHarness([makeDevice({ powerSource: "battery", data: [{ value: 22 }] })]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised()).toHaveLength(0);
  });

  it("reacts to a live device report", () => {
    harness = createHarness([makeDevice({ powerSource: "battery", data: [{ value: 80 }] })]);
    harness.monitor.init();
    harness.monitor.sweep();
    expect(harness.raised()).toHaveLength(0);

    harness.eventBus.emit({
      type: "device.data.updated",
      deviceId: "dev-1",
      deviceName: "Capteur porte",
      dataId: "dd-1",
      key: "battery",
      value: 8,
      previous: 80,
      timestamp: "2026-08-12T10:05:00.000Z",
    });

    expect(harness.raised()).toHaveLength(1);
    expect(harness.raised()[0]).toMatchObject({ message: "Low battery: 8%" });
  });

  it("ignores reports from data it does not watch", () => {
    harness = createHarness([makeDevice({ powerSource: "mains" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    harness.eventBus.emit({
      type: "device.data.updated",
      deviceId: "dev-1",
      deviceName: "Capteur porte",
      dataId: "dd-1",
      key: "battery",
      value: 3,
      previous: 12,
      timestamp: "2026-08-12T10:05:00.000Z",
    });

    expect(harness.raised()).toHaveLength(0);
  });

  it("re-notifies after a week, and only after a week", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    // 2 days later — still silent.
    harness.db
      .prepare("UPDATE battery_alerts SET last_notified_at = ?")
      .run(new Date(Date.now() - 2 * 24 * 3600_000).toISOString());
    harness.monitor.destroy();
    const reloaded = new BatteryMonitor(
      harness.db,
      harness.eventBus,
      {
        getAllWithData: () => [makeDevice({ powerSource: "battery" })],
      } as unknown as DeviceManager,
      mkEquipmentManager(),
      logger,
    );
    reloaded.init();
    reloaded.sweep();
    expect(harness.raised()).toHaveLength(1);

    // 8 days later — reminder.
    harness.db
      .prepare("UPDATE battery_alerts SET last_notified_at = ?")
      .run(new Date(Date.now() - 8 * 24 * 3600_000).toISOString());
    reloaded.destroy();
    const later = new BatteryMonitor(
      harness.db,
      harness.eventBus,
      {
        getAllWithData: () => [makeDevice({ powerSource: "battery" })],
      } as unknown as DeviceManager,
      mkEquipmentManager(),
      logger,
    );
    later.init();
    later.sweep();
    expect(harness.raised()).toHaveLength(2);
    later.destroy();
  });

  it("restores an active alert on restart without notifying", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();
    const raisedAt = (
      harness.db.prepare("SELECT last_notified_at as t FROM battery_alerts").get() as { t: string }
    ).t;
    harness.monitor.destroy();

    const restarted = new BatteryMonitor(
      harness.db,
      harness.eventBus,
      {
        getAllWithData: () => [makeDevice({ powerSource: "battery" })],
      } as unknown as DeviceManager,
      mkEquipmentManager(),
      logger,
    );
    restarted.init();
    restarted.sweep();

    expect(harness.raised()).toHaveLength(1); // still the original one
    expect(restarted.getActiveAlerts()).toHaveLength(1);
    expect(
      (
        harness.db.prepare("SELECT last_notified_at as t FROM battery_alerts").get() as {
          t: string;
        }
      ).t,
    ).toBe(raisedAt);
    restarted.destroy();
  });

  it("resolves an alert whose battery was replaced while Sowel was down", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();
    harness.monitor.destroy();

    const restarted = new BatteryMonitor(
      harness.db,
      harness.eventBus,
      {
        getAllWithData: () => [makeDevice({ powerSource: "battery", data: [{ value: 95 }] })],
      } as unknown as DeviceManager,
      mkEquipmentManager(),
      logger,
    );
    restarted.init();
    restarted.sweep();

    expect(harness.resolved()).toHaveLength(1);
    expect(harness.rows()).toHaveLength(0);
    restarted.destroy();
  });

  it("resolves an alert whose device disappeared", () => {
    harness = createHarness([makeDevice({ powerSource: "battery" })]);
    harness.monitor.init();
    harness.monitor.sweep();

    harness.setDevices([]);
    harness.monitor.sweep();

    expect(harness.resolved()).toHaveLength(1);
    expect(harness.resolved()[0]).toMatchObject({ message: "Battery back to normal" });
    expect(harness.rows()).toHaveLength(0);
  });

  it("raises one alarm per battery data of the same device", () => {
    harness = createHarness([
      makeDevice({
        powerSource: "battery",
        data: [
          { id: "dd-a", value: 5 },
          { id: "dd-b", key: "battery_low", category: "generic", value: true },
        ],
      }),
    ]);
    harness.monitor.init();
    harness.monitor.sweep();

    expect(harness.raised().map((e) => e.type === "system.alarm.raised" && e.alarmId)).toEqual([
      "battery-low:dd-a",
      "battery-low:dd-b",
    ]);
  });

  it("stops sweeping after destroy", () => {
    vi.useFakeTimers();
    try {
      harness = createHarness([makeDevice({ powerSource: "battery" })]);
      harness.monitor.init();
      harness.monitor.destroy();
      vi.advanceTimersByTime(7 * 24 * 3600_000);
      expect(harness.raised()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps on its own once the startup delay has elapsed", () => {
    vi.useFakeTimers();
    try {
      harness = createHarness([makeDevice({ powerSource: "battery" })]);
      harness.monitor.init();
      expect(harness.raised()).toHaveLength(0);
      vi.advanceTimersByTime(31_000);
      expect(harness.raised()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

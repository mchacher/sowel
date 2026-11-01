import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { EngineEvent, Equipment, EquipmentType } from "../../shared/types.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import type { TariffClassifier } from "../tariff-classifier.js";
import { EvSessionStore } from "./ev-session-store.js";
import { EvSessionError, EvSessionTracker, GRACE_MS, monthRange } from "./ev-session-tracker.js";

// Spec 191 — the tracker over a real event bus and an in-memory database, with
// a fake equipment manager and tariff.

const T0 = new Date(2026, 10, 2, 12, 0, 0).getTime(); // local noon, a window boundary
const MIN = 60_000;
const H = 60 * MIN;

function makeLogger(): Logger {
  const self = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: () => self,
  };
  return self as unknown as Logger;
}

interface FakeBinding {
  value: unknown;
  lastUpdated: string;
  lastChanged: string;
}

class FakeEquipments {
  equipments: Equipment[] = [];
  values = new Map<string, Record<string, FakeBinding>>();

  add(id: string, type: EquipmentType, name = id, extra: Partial<Equipment> = {}): void {
    this.equipments.push({
      id,
      name,
      type,
      zoneId: "garage",
      enabled: true,
      createdAt: "",
      updatedAt: "",
      ...extra,
    });
    this.values.set(id, {});
  }
  set(id: string, alias: string, value: unknown, atMs: number = now): void {
    const at = new Date(atMs).toISOString();
    const previous = this.values.get(id)![alias];
    this.values.get(id)![alias] = {
      value,
      lastUpdated: at,
      lastChanged: previous && previous.value === value ? previous.lastChanged : at,
    };
  }
  getById(id: string): Equipment | null {
    return this.equipments.find((e) => e.id === id) ?? null;
  }
  getAll(): Equipment[] {
    return this.equipments;
  }
  getDataBindingsWithValues(id: string): ({ alias: string } & FakeBinding)[] {
    return Object.entries(this.values.get(id) ?? {}).map(([alias, b]) => ({ alias, ...b }));
  }
}

let hcShare = 0;
let prices: { hp: number; hc: number } | null = { hp: 0.2, hc: 0.1 };
const classifier = {
  classify: (wh: number) => ({ hp: wh * (1 - hcShare), hc: wh * hcShare }),
  getConfig: () => (prices ? { schedules: [], prices } : null),
} as unknown as TariffClassifier;

let db: Database.Database;
let bus: EventBus;
let eqs: FakeEquipments;
let store: EvSessionStore;
let now: number;
let tracker: EvSessionTracker;
let events: EngineEvent[];

function makeTracker(): EvSessionTracker {
  const t = new EvSessionTracker(
    bus,
    eqs as unknown as EquipmentManager,
    classifier,
    store,
    makeLogger(),
    { now: () => now },
  );
  t.start();
  return t;
}

function data(equipmentId: string, alias: string, value: unknown, sourceTimestamp?: number): void {
  eqs.set(equipmentId, alias, value);
  bus.emit({
    type: "equipment.data.changed",
    equipmentId,
    alias,
    value,
    previous: null,
    ...(sourceTimestamp !== undefined && { sourceTimestamp }),
  });
}

/** Let the vehicle-report microtasks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Car at `carW`, house importing `importW`, both reporting once a minute, for `minutes`. */
function run(minutes: number, carW: number, importW: number): void {
  for (let i = 0; i < minutes; i++) {
    data("charger", "power", carW);
    data("grid", "energy", importW / 60);
    now += MIN;
  }
}

function sessions() {
  return tracker.listByCharger("charger", "2026-11")!;
}

beforeEach(() => {
  db = createMigratedTestDb();
  bus = new EventBus(makeLogger());
  eqs = new FakeEquipments();
  eqs.add("charger", "ev_charger", "Borne");
  eqs.add("grid", "main_energy_meter");
  eqs.add("rafale", "electric_vehicle", "Rafale");
  eqs.add("megane", "electric_vehicle", "Megane");
  now = T0;
  eqs.set("charger", "energy", 0); // the charger has its own energy meter
  store = new EvSessionStore(db);
  hcShare = 0;
  prices = { hp: 0.2, hc: 0.1 };
  events = [];
  bus.on((e) => {
    if (e.type.startsWith("energy.ev_session")) events.push(e);
  });
  tracker = makeTracker();
});

afterEach(() => {
  tracker.stop();
  db.close();
});

describe("session lifecycle", () => {
  it("one plug-in with pauses inside is one session", () => {
    data("charger", "vehicle", "connected");
    data("charger", "vehicle", "charging");
    run(20, 3000, 3000);
    data("charger", "vehicle", "connected");
    data("charger", "power", 0);
    now += 30 * MIN;
    data("charger", "vehicle", "charging");
    run(20, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0].endedAt).not.toBeNull();
    expect(list[0].energyWh).toBeCloseTo(2000, 0);
  });

  it("drops a session under 100 Wh at close", () => {
    data("charger", "vehicle", "connected");
    run(1, 1200, 1200);
    data("charger", "vehicle", "disconnected");
    expect(sessions()).toHaveLength(0);
    expect(events.some((e) => e.type === "energy.ev_session.deleted")).toBe(true);
  });

  it("the meter is the truth: the estimate gives the shares", () => {
    data("charger", "vehicle", "charging");
    run(60, 1400, 400); // house imports 0.4 kW while the car draws 1.4 kW
    data("charger", "energy", 1500);
    data("charger", "vehicle", "disconnected");
    const [s] = sessions();
    expect(s.energyWh).toBe(1500);
    expect((s.gridHpWh + s.gridHcWh) / s.energyWh).toBeCloseTo(2 / 7, 2);
    expect(s.solarWh / s.energyWh).toBeCloseTo(5 / 7, 2);
  });

  it("prices each window at the prices in force when it closed", () => {
    data("charger", "vehicle", "charging");
    run(30, 2000, 5000); // all grid, 1 kWh at 0.2
    tracker.tick(); // the 30 s timer closes the due window before the change
    prices = { hp: 0.4, hc: 0.1 };
    run(30, 2000, 5000); // 1 kWh at 0.4
    data("charger", "vehicle", "disconnected");
    const before = sessions()[0].costEur!;
    expect(before).toBeCloseTo(0.6, 2);
    prices = { hp: 1, hc: 1 };
    expect(sessions()[0].costEur).toBeCloseTo(before, 9);
  });

  it("prices off-peak windows at the HC price", () => {
    hcShare = 1;
    data("charger", "vehicle", "charging");
    run(60, 1000, 3000);
    data("charger", "vehicle", "disconnected");
    const [s] = sessions();
    expect(s.costHcEur).toBeCloseTo(0.1, 2);
    expect(s.costHpEur).toBeCloseTo(0, 6);
  });

  it("counts all grid without a main meter, and has no cost without a tariff", () => {
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "grid");
    prices = null;
    data("charger", "vehicle", "charging");
    data("charger", "power", 2000);
    now += 30 * MIN;
    data("charger", "vehicle", "disconnected");
    const [s] = sessions();
    expect(s.solarWh).toBe(0);
    expect(s.costEur).toBeNull();
  });

  it("does not revive a stale power with the charger's computed data", () => {
    data("charger", "vehicle", "charging");
    data("charger", "power", 7000);
    for (let i = 0; i < 6; i++) {
      now += 10 * MIN; // offline: no report from the charger itself
      data("charger", "energy_hour", 0);
      data("grid", "energy", 0);
    }
    data("charger", "vehicle", "disconnected");
    // 15 minutes held at most, never revived by energy_hour.
    expect(sessions()[0].energyWh).toBeCloseTo((7000 * 15) / 60, 0);
  });

  it("ignores synthetic energy on a charger without an energy meter", () => {
    eqs.values.set("charger", {});
    data("charger", "vehicle", "charging");
    run(30, 2000, 2000);
    data("charger", "energy", 50_000); // PowerSubmeterIntegrator backlog
    data("charger", "vehicle", "disconnected");
    expect(sessions()[0].energyWh).toBeCloseTo(1000, 0);
  });

  it("ignores aligned historical grid ticks", () => {
    data("charger", "vehicle", "charging");
    data("charger", "power", 1200);
    for (let i = 0; i < 30; i++) {
      data("grid", "energy", 0, Math.floor(now / 1000));
      now += MIN;
    }
    data("charger", "vehicle", "disconnected");
    expect(sessions()[0].solarWh).toBe(0);
  });
});

describe("restart", () => {
  it("continues a session whose charger is still plugged", () => {
    data("charger", "vehicle", "charging");
    run(30, 2000, 2000);
    tracker.tick(); // the window in progress is the most a restart may lose
    tracker.stop();
    tracker = makeTracker();
    run(30, 2000, 2000);
    data("charger", "vehicle", "disconnected");
    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0].energyWh).toBeCloseTo(2000, 0);
  });

  it("closes a session whose charger was unplugged meanwhile, at the reading's time", () => {
    data("charger", "vehicle", "charging");
    run(30, 2000, 2000);
    tracker.stop();
    const unpluggedAt = now + 5 * MIN;
    eqs.set("charger", "vehicle", "disconnected", unpluggedAt);
    now += 3 * H;
    tracker = makeTracker();
    expect(sessions()[0].endedAt).toBe(new Date(unpluggedAt).toISOString());
  });

  it("opens a session for a charger already plugged at start", () => {
    tracker.stop();
    eqs.set("charger", "vehicle", "connected");
    tracker = makeTracker();
    expect(sessions()).toHaveLength(1);
  });

  it("decides after a restart during the grace period", async () => {
    data("charger", "vehicle", "charging");
    data("rafale", "charging_state", "charging");
    await flush();
    run(60, 2000, 2000);
    data("charger", "vehicle", "disconnected");
    tracker.stop();
    tracker = makeTracker();
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ attribution: "vehicle", vehicleId: "rafale" });
  });
});

describe("attribution", () => {
  async function chargeWith(reports: Array<[string, string, unknown]>) {
    data("charger", "vehicle", "charging");
    for (const [v, alias, value] of reports) data(v, alias, value);
    await flush();
    run(60, 2000, 2000);
    data("charger", "vehicle", "disconnected");
  }

  it("stays pending until the grace period ends, then attributes the only match", async () => {
    await chargeWith([
      ["rafale", "plugged", true],
      ["rafale", "charging_state", "charging"],
      ["megane", "plugged", false],
    ]);
    expect(sessions()[0].attribution).toBe("pending");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({
      attribution: "vehicle",
      attributionSource: "auto",
      vehicleId: "rafale",
      vehicleName: "Rafale",
    });
  });

  it("counts a report made during the session that reaches Sowel late", async () => {
    await chargeWith([]);
    const end = now;
    now += 90 * MIN;
    data("megane", "reported_at", new Date(end - 30 * MIN).toISOString());
    data("megane", "battery_level", 40);
    data("megane", "reported_at", new Date(end - 5 * MIN).toISOString());
    await flush();
    data("megane", "battery_level", 60);
    await flush();
    now = end + GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane", batteryStart: 40, batteryEnd: 60 });
  });

  it("still attributes to the car that charged when it reports its own unplug first", async () => {
    data("charger", "vehicle", "charging");
    data("rafale", "charging_state", "charging");
    await flush();
    run(60, 2000, 2000);
    // The car stamps its unplug before the charger reports it.
    data("rafale", "reported_at", new Date(now - 30_000).toISOString());
    data("rafale", "plugged", false);
    await flush();
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "rafale", attributionReason: "single-match" });
  });

  it("applies reported_at only to the values of the same report", async () => {
    // A battery report made long before the session, then a location poll.
    eqs.set("megane", "reported_at", new Date(T0 - 5 * H).toISOString(), T0 - 5 * H);
    data("charger", "vehicle", "charging");
    run(30, 2000, 2000);
    data("megane", "battery_level", 40); // a later poll without reported_at
    await flush();
    run(30, 2000, 2000);
    data("megane", "battery_level", 50);
    await flush();
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane", batteryStart: 40, batteryEnd: 50 });
  });

  it("leaves the session to attribute when both cars match", async () => {
    await chargeWith([
      ["rafale", "charging_state", "charging"],
      ["megane", "charging_state", "charging"],
    ]);
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({
      attribution: "unattributed",
      attributionReason: "several-matches",
    });
  });

  it("a manual choice is final, even made during the grace period", async () => {
    await chargeWith([["rafale", "charging_state", "charging"]]);
    const id = sessions()[0].id;
    tracker.setAttribution(id, { target: "vehicle", vehicleId: "megane" });
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane", attributionSource: "manual" });
  });

  it("accepts Other vehicle and back to attribute, and refuses an unknown vehicle", async () => {
    await chargeWith([]);
    const id = sessions()[0].id;
    expect(tracker.setAttribution(id, { target: "other" }).attribution).toBe("other");
    expect(tracker.setAttribution(id, { target: "unattributed" }).attribution).toBe("unattributed");
    expect(() => tracker.setAttribution(id, { target: "vehicle", vehicleId: "charger" })).toThrow(
      EvSessionError,
    );
    expect(() => tracker.setAttribution("nope", { target: "other" })).toThrow(EvSessionError);
  });

  it("keeps the sessions of a deleted vehicle out of every total", async () => {
    await chargeWith([["rafale", "charging_state", "charging"]]);
    now += GRACE_MS;
    tracker.tick();
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "rafale");
    bus.emit({
      type: "equipment.removed",
      equipmentId: "rafale",
      equipmentName: "Rafale",
      zoneId: "garage",
    });
    expect(sessions()[0]).toMatchObject({ vehicleName: "Rafale", vehicleDeleted: true });
    expect(tracker.listByVehicle("rafale", "2026-11")).toEqual([]);
  });

  it("keeps the deletion of a vehicle on a session still open", async () => {
    data("charger", "vehicle", "charging");
    run(10, 2000, 2000);
    const id = sessions()[0].id;
    tracker.setAttribution(id, { target: "vehicle", vehicleId: "rafale" });
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "rafale");
    bus.emit({
      type: "equipment.removed",
      equipmentId: "rafale",
      equipmentName: "Rafale",
      zoneId: "garage",
    });
    run(10, 2000, 2000); // the next window saves the open record again
    expect(sessions()[0].vehicleDeleted).toBe(true);
  });

  it("closes the session of a deleted charger and keeps it", () => {
    data("charger", "vehicle", "charging");
    run(30, 2000, 2000);
    bus.emit({
      type: "equipment.removed",
      equipmentId: "charger",
      equipmentName: "Borne",
      zoneId: "garage",
    });
    expect(sessions()[0].endedAt).not.toBeNull();
  });
});

describe("session in progress on the vehicle page (spec 192)", () => {
  const current = (v: string) => tracker.currentForVehicle(v).map((s) => s.id);

  it("goes to the one car that matches, and to no other", async () => {
    data("charger", "vehicle", "charging");
    run(10, 2000, 2000);
    expect(current("megane")).toEqual([]);
    data("megane", "charging_state", "charging");
    await flush();
    const id = sessions()[0].id;
    expect(current("megane")).toEqual([id]);
    expect(current("rafale")).toEqual([]);
  });

  it("goes to no car when both match", async () => {
    data("charger", "vehicle", "charging");
    data("rafale", "charging_state", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    expect(current("rafale")).toEqual([]);
    expect(current("megane")).toEqual([]);
  });

  it("goes to the only car Sowel knows, without any report", () => {
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "rafale");
    data("charger", "vehicle", "charging");
    run(10, 2000, 2000);
    expect(current("megane")).toEqual([sessions()[0].id]);
  });

  it("stays through the grace period, then leaves once decided", async () => {
    data("charger", "vehicle", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    run(30, 2000, 2000);
    data("charger", "vehicle", "disconnected");
    const [s] = tracker.currentForVehicle("megane");
    expect(s.endedAt).not.toBeNull();
    expect(s.graceUntil).not.toBeNull();
    now += GRACE_MS;
    tracker.tick();
    expect(current("megane")).toEqual([]);
    expect(tracker.listByVehicle("megane", "2026-11")!.map((x) => x.id)).toEqual([s.id]);
  });

  it("follows a choice made by hand while open, until the unplug", async () => {
    data("charger", "vehicle", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    run(10, 2000, 2000);
    const id = sessions()[0].id;
    tracker.setAttribution(id, { target: "vehicle", vehicleId: "rafale" });
    expect(current("rafale")).toEqual([id]);
    expect(current("megane")).toEqual([]);
    run(10, 2000, 2000);
    data("charger", "vehicle", "disconnected");
    expect(current("rafale")).toEqual([]);
  });

  it("emits the session when a car report changes its evidence", async () => {
    data("charger", "vehicle", "connected");
    events = [];
    data("megane", "charging_state", "charging");
    await flush();
    expect(events.map((e) => e.type)).toContain("energy.ev_session.updated");
    events = [];
    data("megane", "charging_state", "charging"); // same evidence again
    await flush();
    expect(events).toEqual([]);
  });
});

describe("driving and the monthly summary", () => {
  it("measures legs and gives the cost per 100 km from home price × consumption", async () => {
    // Learn 600 Wh per point from one home session: 18 kWh for +30 points.
    data("charger", "vehicle", "charging");
    data("megane", "battery_level", 40);
    await flush();
    run(60, 1000, 5000);
    data("charger", "energy", 18_000);
    data("megane", "battery_level", 70);
    await flush();
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();

    // Two legs: 100 km for 17 points, then a leg charged on the way (left out).
    data("megane", "mileage", 23_000);
    await flush();
    data("megane", "battery_level", 53);
    data("megane", "mileage", 23_100);
    await flush();
    data("megane", "battery_level", 80);
    data("megane", "mileage", 23_200);
    await flush();

    const summary = tracker.summary("megane", "2026-11")!;
    expect(summary.sessions).toBe(1);
    expect(summary.energyWh).toBe(18_000);
    // 100 measured km is enough over the 50 km minimum.
    expect(summary.kWhPer100km).toBeCloseTo((600 * 17) / 100 / 10, 6);
    expect(summary.eurPer100km).toBeCloseTo(summary.kWhPer100km! * summary.homePriceEurPerKwh!, 9);
  });

  it("hides the cost per 100 km for a plug-in hybrid", () => {
    eqs.equipments.find((e) => e.id === "rafale")!.plugInHybrid = true;
    expect(tracker.summary("rafale", "2026-11")!.eurPer100kmUnavailable).toBe("plug-in-hybrid");
  });

  it("rejects a malformed month", () => {
    expect(tracker.summary("megane", "2026-13")).toBeNull();
    expect(monthRange("nov")).toBeNull();
  });
});

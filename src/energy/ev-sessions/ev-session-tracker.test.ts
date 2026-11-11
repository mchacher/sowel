import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../core/event-bus.js";
import type { Logger } from "../../core/logger.js";
import type { EquipmentManager } from "../../equipments/equipment-manager.js";
import type { EngineEvent, Equipment, EquipmentType } from "../../shared/types.js";
import { localDateStr } from "../../shared/local-date.js";
import { createMigratedTestDb } from "../../test-helpers/migrations.js";
import type { TariffClassifier } from "../tariff-classifier.js";
import { EvSessionStore, type SessionRecord } from "./ev-session-store.js";
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
// Spec 202 — the tracker asks for the prices of a session's start day when the
// session is read. `prices` is what the tariff versions answer; `pricedDays`
// records the days asked.
let prices: { hp: number; hc: number } | null = { hp: 0.2, hc: 0.1 };
let pricedDays: string[] = [];
const classifier = {
  classify: (wh: number) => ({ hp: wh * (1 - hcShare), hc: wh * hcShare }),
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
    {
      now: () => now,
      pricesOn: (day) => {
        pricedDays.push(day);
        return prices;
      },
    },
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

/**
 * Car at `carW`, house importing `importW`, for `minutes`: the charger reports
 * its power at the start of each minute, the main meter the energy of the
 * minute just past, at its end (as a real meter does).
 */
function run(minutes: number, carW: number, importW: number): void {
  for (let i = 0; i < minutes; i++) {
    data("charger", "power", carW);
    now += MIN;
    data("grid", "energy", importW / 60);
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
  pricedDays = [];
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

  it("prices a session when it is read, at the prices of the day it started (spec 202)", () => {
    data("charger", "vehicle", "charging");
    run(60, 2000, 5000); // all grid, 2 kWh
    data("charger", "vehicle", "disconnected");
    const [s] = sessions();
    expect(s.costEur).toBeCloseTo(0.4, 2);
    expect(pricedDays.at(-1)).toBe(localDateStr(new Date(s.startedAt)));
    // Nothing was frozen: a corrected price reprices the session.
    prices = { hp: 0.4, hc: 0.1 };
    expect(sessions()[0].costEur).toBeCloseTo(0.8, 2);
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

  it("shows the charger's current name, not the one it had at the start", () => {
    data("charger", "vehicle", "charging");
    run(10, 2000, 2000);
    eqs.getById("charger")!.name = "Borne Tuya";
    run(10, 2000, 2000);
    data("charger", "vehicle", "disconnected");
    expect(sessions()[0].chargerName).toBe("Borne Tuya");
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

describe("metered charger (spec 193)", () => {
  beforeEach(() => {
    tracker.stop();
    eqs.add("legrand", "ev_charger", "Legrand"); // power only: no vehicle state
    eqs.set("legrand", "power", 0);
    eqs.set("charger", "vehicle", "disconnected"); // the other charger reports its plug
    tracker = makeTracker();
  });

  const legrand = () => tracker.listByCharger("legrand", "2026-11")!;
  const setUsual = (chargerId: string, vehicleId: string) => {
    eqs.getById(chargerId)!.usualVehicleId = vehicleId;
  };

  /** The metered charger at `w`, the house importing as much, ticking each minute. */
  function meter(minutes: number, w: number, also?: () => void): void {
    for (let i = 0; i < minutes; i++) {
      data("legrand", "power", w);
      also?.();
      data("grid", "energy", w / 60);
      tracker.tick();
      now += MIN;
    }
  }

  it("opens at 500 W, keeps a short pause, ends 30 min after the last active reading", () => {
    meter(60, 3000);
    meter(20, 0);
    meter(30, 3000);
    const lastActive = now - MIN;
    meter(31, 0);
    const list = legrand();
    expect(list).toHaveLength(1);
    expect(list[0].startedAt).toBe(new Date(T0).toISOString());
    expect(list[0].endedAt).toBe(new Date(lastActive).toISOString());
    expect(list[0].graceUntil).toBe(new Date(lastActive + GRACE_MS).toISOString());
  });

  it("makes two sessions of a pause over 30 min", () => {
    meter(30, 3000);
    meter(45, 0);
    meter(30, 3000);
    meter(31, 0);
    expect(legrand()).toHaveLength(2);
  });

  it("drops a short spike", () => {
    meter(1, 600);
    meter(31, 0);
    expect(legrand()).toHaveLength(0);
  });

  it("closes after a restart at the time the power dropped", () => {
    meter(30, 3000);
    tracker.stop();
    const droppedAt = now;
    eqs.set("legrand", "power", 0, droppedAt);
    now += 40 * MIN;
    tracker = makeTracker();
    tracker.tick();
    expect(legrand()[0].endedAt).toBe(new Date(droppedAt).toISOString());
  });

  it("opens at start when the charger already draws", () => {
    tracker.stop();
    eqs.set("legrand", "power", 3000);
    tracker = makeTracker();
    expect(legrand()).toHaveLength(1);
  });

  it("never opens on the power of a charger that reports its plug state", () => {
    data("charger", "power", 3000);
    expect(sessions()).toHaveLength(0);
  });

  it("breaks a tie for the charger's usual vehicle", async () => {
    setUsual("legrand", "megane");
    meter(5, 3000);
    data("rafale", "charging_state", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    meter(60, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane", attributionReason: "usual-vehicle" });
  });

  /** Car A on the charger that reports its plug, car B on the metered one, at once. */
  async function twoCarsAtOnce(legrandAfterUnplug: number) {
    setUsual("legrand", "megane");
    data("charger", "vehicle", "charging");
    meter(2, 3000, () => data("charger", "power", 2000));
    data("rafale", "charging_state", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    meter(60, 3000, () => data("charger", "power", 2000));
    data("charger", "vehicle", "disconnected");
    meter(legrandAfterUnplug, 3000);
    meter(31, 0);
  }

  it("gives each car its own charger when both charge at once", async () => {
    await twoCarsAtOnce(10);
    now += GRACE_MS;
    tracker.tick();
    // It rests on the Legrand's usual-vehicle guess: it says so (audit A7).
    expect(sessions()[0]).toMatchObject({
      vehicleId: "rafale",
      attributionReason: "usual-vehicle",
    });
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
  });

  it("counts the other charger's provisional result while it still charges", async () => {
    await twoCarsAtOnce(GRACE_MS / MIN + 10); // the plug-state charger is decided first
    expect(sessions()[0]).toMatchObject({ vehicleId: "rafale" });
    expect(legrand()[0].endedAt).not.toBeNull();
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
  });

  it("does not hold against a car what it reports after its charge ended", async () => {
    meter(5, 3000);
    data("megane", "charging_state", "charging");
    await flush();
    meter(55, 3000);
    meter(5, 0);
    data("megane", "at_home", false); // it leaves 5 min after its charge
    await flush();
    meter(26, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane", attributionReason: "single-match" });
  });

  it("folds what a car reported during a pause when the charge resumes", async () => {
    meter(30, 3000);
    meter(10, 0);
    data("megane", "charging_state", "charging");
    await flush();
    meter(30, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
  });

  it("does not take a car from another charger on an only-vehicle guess", async () => {
    // One car known, charging on the other charger; then, past the start
    // slack, a guest starts on the metered one, which the car's reports never
    // reach.
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "rafale");
    data("charger", "vehicle", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    for (let i = 0; i < 20; i++) {
      data("charger", "power", 2000);
      now += MIN;
    }
    meter(2, 3000, () => data("charger", "power", 2000));
    expect(tracker.currentForVehicle("megane").map((x) => x.chargerId)).toEqual(["charger"]);
  });

  it("never gives a guest who plugs in right after the car on the other charger to it", async () => {
    // Within the start slack the car's report may belong to either session:
    // neither takes it for sure (P7).
    eqs.equipments = eqs.equipments.filter((e) => e.id !== "rafale");
    data("charger", "vehicle", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    meter(60, 3000, () => data("charger", "power", 2000));
    data("charger", "vehicle", "disconnected");
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0].vehicleId).not.toBe("megane");
  });

  it("counts a charging report the car made just before the session opened (#1105)", async () => {
    // The car dates its report at 3 min before the first 500 W reading, and
    // its plugin never publishes it again.
    eqs.set("megane", "reported_at", new Date(now - 3 * MIN).toISOString());
    eqs.set("megane", "charging_state", "charging");
    meter(60, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane", attributionReason: "single-match" });
  });

  /** A Renault-style report: its own time, then the value, in one burst. */
  async function report(car: string, state: string, atMs: number) {
    data(car, "reported_at", new Date(atMs).toISOString());
    data(car, "charging_state", state);
    await flush();
  }

  /** Two cars come home together: Megane on the plug-state charger, Rafale on the Legrand 4 min later. */
  async function twoCarsComeHome() {
    data("charger", "vehicle", "charging");
    now += MIN;
    const meganeAt = now;
    await report("megane", "charging", meganeAt);
    let rafaleAt = 0;
    for (let i = 0; i < 60; i++) {
      data("charger", "power", 2000);
      if (i >= 4) data("legrand", "power", 3000);
      if (i === 5) {
        rafaleAt = now;
        await report("rafale", "charging", rafaleAt);
      }
      if (i % 10 === 0) await report("megane", "charging", meganeAt); // repeats, same time
      if (i > 5 && i % 10 === 0) await report("rafale", "charging", rafaleAt);
      data("grid", "energy", 100);
      tracker.tick();
      now += MIN;
    }
    data("charger", "vehicle", "disconnected");
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
  }

  it("never swaps two cars that come home together (#1105, audit reviews)", async () => {
    await twoCarsComeHome();
    // Both cars' reports reach both sessions: Sowel cannot tell, and says so.
    expect(sessions()[0].vehicleId).not.toBe("rafale");
    expect(legrand()[0].vehicleId).not.toBe("megane");
  });

  it("gives each car its charger by their usual vehicles, saying so (#1105)", async () => {
    setUsual("charger", "megane");
    setUsual("legrand", "rafale");
    await twoCarsComeHome();
    expect(sessions()[0]).toMatchObject({
      vehicleId: "megane",
      attributionReason: "usual-vehicle",
    });
    expect(legrand()[0]).toMatchObject({ vehicleId: "rafale", attributionReason: "usual-vehicle" });
  });

  it("does not lend the previous car's report to the next session on a charger (#1105)", async () => {
    data("charger", "vehicle", "charging");
    run(30, 3000, 3000);
    await report("megane", "charging", now);
    run(2, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    now += 8 * MIN;
    data("charger", "vehicle", "charging");
    await report("rafale", "charging", now);
    run(30, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    const list = sessions().sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    expect(list.map((x) => x.vehicleId)).toEqual(["megane", "rafale"]);
  });

  it("does not read a car that charges away from home (#1105)", () => {
    eqs.set("megane", "at_home", false, now - H);
    eqs.set("megane", "charging_state", "charging", now - 5 * MIN);
    meter(60, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ attribution: "unattributed" });
  });

  it("reads what a car reported while Sowel was down (#1105)", () => {
    meter(10, 3000);
    tracker.stop();
    eqs.set("megane", "charging_state", "charging", now);
    tracker = makeTracker();
    meter(50, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
  });

  it("does not count a charging state reported long before the session opened", async () => {
    eqs.set("megane", "reported_at", new Date(now - 3 * H).toISOString(), now - 3 * H);
    eqs.set("megane", "charging_state", "charging", now - 3 * H);
    meter(60, 3000);
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ attribution: "unattributed" });
  });

  it("shows no solar at night although the meter reports a minute late (audit A1)", () => {
    // No PV. The meter sends, one second after each minute, the energy of the
    // minute just past (car + a 850 W house); the car draws 6.9 kW from a
    // start in the middle of a window.
    const start = now + 6 * MIN + 55_000;
    const stop = start + 38 * MIN;
    const carWh = (a: number, b: number) =>
      (6900 * Math.max(0, Math.min(b, stop) - Math.max(a, start))) / 3_600_000;
    const t0 = now;
    for (let t = t0 + 1000; t < stop + 40 * MIN; t += 1000) {
      now = t;
      if ((t - t0) % 30_000 === 0 || t === start || t === stop) {
        data("legrand", "power", t >= start && t < stop ? 6900 : 3);
      }
      if ((t - 1000 - t0) % MIN === 0) {
        const m = t - 1000;
        data("grid", "energy", carWh(m - MIN, m) + 850 / 60);
        data("legrand", "energy", carWh(m - MIN, m));
      }
      if ((t - t0) % 30_000 === 0) tracker.tick();
    }
    const [s] = legrand();
    expect(s.endedAt).not.toBeNull();
    expect(s.energyWh).toBeCloseTo((6900 * 38) / 60, -1);
    expect(s.solarWh).toBeLessThan(5);
  });

  it("shares the import between two sessions on solar (audit A2)", () => {
    // 1.3 kW and 7 kW, house 0.5 kW, PV 3 kW: the house imports 5.8 kW.
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 60; i++) {
      data("charger", "power", 1300);
      data("legrand", "power", 7000);
      tracker.tick();
      now += MIN;
      data("grid", "energy", 5800 / 60);
    }
    data("charger", "vehicle", "disconnected");
    meter(31, 0);
    const [a] = sessions();
    const [b] = legrand();
    const grid = a.gridHpWh + a.gridHcWh + b.gridHpWh + b.gridHcWh;
    expect(grid).toBeLessThan(5800 * 1.03);
    expect(grid).toBeGreaterThan(5800 * 0.95);
    expect(a.solarWh + b.solarWh).toBeGreaterThan(2300);
  });

  it("keeps counting a power-only charger after a restart (audit A9)", () => {
    eqs.values.set("charger", {}); // no energy meter: power only, reported on change
    data("charger", "vehicle", "charging");
    data("charger", "power", 3700);
    for (let i = 0; i < 10; i++) {
      now += MIN;
      data("grid", "energy", 70);
      tracker.tick();
    }
    tracker.stop();
    tracker = makeTracker();
    for (let i = 0; i < 10; i++) {
      now += MIN;
      data("grid", "energy", 70);
      tracker.tick();
    }
    data("charger", "power", 3700); // keeps the held power alive past 15 min
    for (let i = 0; i < 50; i++) {
      now += MIN;
      data("grid", "energy", 70);
      tracker.tick();
    }
    data("charger", "vehicle", "disconnected");
    now += 4 * MIN;
    tracker.tick();
    // As without a restart: 15 min held after the first reading (the hold
    // limit counts from the reading, not from the restart), then 15 after the
    // second: 30 min at 3.7 kW. Without holding it again at the restart: 25.
    expect(sessions()[0].energyWh).toBeCloseTo((3700 * 30) / 60, -1);
  });

  it("prices a session whose meter moved without any window (audit A8)", () => {
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 30; i++) {
      data("charger", "power", 0); // a charger whose power reads 0 while it meters
      data("charger", "energy", 100);
      now += MIN;
    }
    data("charger", "vehicle", "disconnected");
    const [s] = sessions();
    expect(s.energyWh).toBe(3000);
    expect(s.gridHpWh + s.gridHcWh).toBeCloseTo(3000, 6);
    expect(s.costEur).toBeCloseTo(0.6, 6);
  });

  it("does not give a guest's session to a car charging away (audit A5)", async () => {
    eqs.set("rafale", "at_home", false, now - 20 * MIN); // its last location poll
    data("charger", "vehicle", "charging"); // a guest plugs in at home
    for (let i = 0; i < 40; i++) {
      data("charger", "power", 3000);
      if (i === 10) {
        await report("rafale", "charging", now - MIN);
        data("rafale", "battery_level", 30);
        await flush();
      }
      if (i === 30) {
        data("rafale", "battery_level", 45);
        await flush();
      }
      now += MIN;
      data("grid", "energy", 50);
    }
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ attribution: "unattributed" });
  });

  it("still gives the session to a car away at the opening once it is seen home (audit A5)", async () => {
    eqs.set("megane", "at_home", false, now - 20 * MIN); // the location lags
    data("charger", "vehicle", "charging");
    run(10, 3000, 3000);
    await report("megane", "charging", now);
    data("megane", "at_home", true);
    await flush();
    run(30, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane" });
  });

  it("keeps the start slack for a car the other charger does not hold (audit A6)", async () => {
    data("charger", "vehicle", "charging"); // the Rafale on the plug-state charger
    await report("rafale", "charging", now);
    run(60, 1300, 1300);
    // The Megane's report is dated 3 min before the Legrand's first 500 W.
    await report("megane", "charging", now - 3 * MIN);
    meter(9, 7000, () => data("charger", "power", 1300));
    meter(31, 0, () => data("charger", "power", 1300));
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane", attributionReason: "single-match" });
  });

  it("says usual vehicle on both chargers when the cars are swapped (audit A7)", async () => {
    setUsual("legrand", "megane");
    data("charger", "vehicle", "charging"); // tonight: Megane on the plug-state, Rafale on the Legrand
    for (let i = 0; i < 120; i++) {
      data("charger", "power", 1300);
      data("legrand", "power", 7000);
      if (i === 5) {
        await report("megane", "charging", now - 30_000);
        await report("rafale", "charging", now - 30_000);
      }
      tracker.tick();
      now += MIN;
      data("grid", "energy", 140);
    }
    data("charger", "vehicle", "disconnected");
    meter(31, 0);
    now += GRACE_MS;
    tracker.tick();
    // Both are guesses from the usual vehicle, and say so.
    expect(sessions()[0].attributionReason).toBe("usual-vehicle");
    expect(legrand()[0].attributionReason).toBe("usual-vehicle");
  });

  it("measures the battery from just before the start to just after the end (audit A4)", async () => {
    // 40 % reported 90 s before the first 500 W reading.
    data("megane", "reported_at", new Date(now - 90_000).toISOString());
    data("megane", "battery_level", 40);
    data("megane", "charging_state", "charging");
    await flush();
    let level = 40;
    for (let i = 0; i < 120; i++) {
      data("legrand", "power", 7000);
      if (i % 10 === 9) {
        level += 2;
        data("megane", "reported_at", new Date(now - 30_000).toISOString());
        data("megane", "battery_level", level);
        await flush();
      }
      tracker.tick();
      now += MIN;
      data("grid", "energy", 7000 / 60);
    }
    const lastActive = now - MIN;
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 3);
      if (i === 3) {
        // The final 66 %, reported 2 min after the charge stopped.
        data("megane", "reported_at", new Date(lastActive + 2 * MIN).toISOString());
        data("megane", "battery_level", 66);
        await flush();
      }
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane", batteryStart: 40, batteryEnd: 66 });
  });

  it("follows the battery of a session given by hand while open (audit A3)", async () => {
    data("charger", "vehicle", "charging");
    data("megane", "battery_level", 40);
    await flush();
    run(5, 7000, 7000);
    tracker.setAttribution(sessions()[0].id, { target: "vehicle", vehicleId: "megane" });
    run(20, 7000, 7000);
    data("megane", "battery_level", 60);
    await flush();
    data("charger", "vehicle", "disconnected");
    expect(sessions()[0]).toMatchObject({ batteryStart: 40, batteryEnd: 60 });
  });

  it("shows each car its own session in progress", async () => {
    setUsual("legrand", "megane");
    data("charger", "vehicle", "charging");
    meter(2, 3000, () => data("charger", "power", 2000));
    data("rafale", "charging_state", "charging");
    data("megane", "charging_state", "charging");
    await flush();
    const ids = (v: string) => tracker.currentForVehicle(v).map((x) => x.chargerId);
    expect(ids("megane")).toEqual(["legrand"]);
    expect(ids("rafale")).toEqual(["charger"]);
  });
});

describe("audit review (fix/ev-cost-audit)", () => {
  it("does not pass a late report of the previous car to a guest on the same charger", async () => {
    // A car charges 11:00–11:20 and reports nothing during it; a guest plugs
    // in at 11:22; the car's report, dated 11:18, arrives at 11:25.
    data("charger", "vehicle", "charging");
    run(20, 3000, 3000);
    const reportedAt = now - 2 * MIN;
    data("charger", "vehicle", "disconnected");
    now += 2 * MIN;
    data("charger", "vehicle", "charging");
    run(3, 3000, 3000);
    data("rafale", "reported_at", new Date(reportedAt).toISOString());
    data("rafale", "charging_state", "charging");
    await flush();
    run(30, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS + 5 * MIN;
    tracker.tick();
    const [guest] = sessions(); // newest first
    expect(guest.attribution).toBe("unattributed");
  });

  it("keeps the grid ledger small when no session is open", () => {
    for (let i = 0; i < 24 * 60; i++) {
      now += MIN;
      data("grid", "energy", 10);
    }
    const ledger = (tracker as unknown as { ledger: { size: number } }).ledger;
    expect(ledger.size).toBeLessThan(20);
  });

  it("does not bill the house's import before the plug-in to the car", () => {
    // 6 kW imported for 3 min with no car; then the car at 3 kW on solar.
    for (let i = 0; i < 3; i++) {
      now += MIN;
      data("grid", "energy", 100);
    }
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 30; i++) {
      data("charger", "power", 3000);
      now += MIN;
      data("grid", "energy", 0);
    }
    data("charger", "vehicle", "disconnected");
    now += 4 * MIN;
    tracker.tick();
    const [s] = sessions();
    expect(s.gridHpWh + s.gridHcWh).toBeLessThan(1);
  });

  it("prices a closed session's last windows before a restart", () => {
    eqs.values.set("charger", {}); // power only: no meter to fall back on
    data("charger", "vehicle", "charging");
    data("charger", "power", 7000);
    now += 4 * MIN;
    data("charger", "vehicle", "disconnected");
    tracker.stop(); // a restart 30 s later
    now += 30_000;
    tracker = makeTracker();
    expect(sessions()[0].energyWh).toBeCloseTo((7000 * 4) / 60, 0);
  });

  it("counts a window the meter stopped covering as all grid", () => {
    data("charger", "vehicle", "charging");
    data("charger", "power", 6000);
    now += MIN;
    data("grid", "energy", 100); // the last delta; the meter then goes silent
    for (let i = 0; i < 20; i++) {
      now += MIN;
      data("charger", "power", 6000);
      tracker.tick();
    }
    data("charger", "vehicle", "disconnected");
    now += 10 * MIN;
    tracker.tick();
    expect(sessions()[0].solarWh).toBeLessThan(1);
  });

  it("follows the final battery of a session given by hand after its end", async () => {
    data("charger", "vehicle", "charging");
    data("megane", "battery_level", 40);
    await flush();
    run(5, 7000, 7000);
    tracker.setAttribution(sessions()[0].id, { target: "vehicle", vehicleId: "megane" });
    run(20, 7000, 7000);
    data("charger", "vehicle", "disconnected");
    now += 2 * MIN;
    data("megane", "reported_at", new Date(now - MIN).toISOString());
    data("megane", "battery_level", 62);
    await flush();
    expect(sessions()[0]).toMatchObject({ batteryStart: 40, batteryEnd: 62 });
  });
});

describe("telling cars apart by measures (spec 194)", () => {
  beforeEach(() => {
    tracker.stop();
    eqs.add("legrand", "ev_charger", "Legrand");
    eqs.set("legrand", "power", 0);
    tracker = makeTracker();
  });
  const legrand = () => tracker.listByCharger("legrand", "2026-11")!;
  const setUsual = (chargerId: string, vehicleId: string) => {
    eqs.getById(chargerId)!.usualVehicleId = vehicleId;
  };

  /** A car's report: its own time, then each value, in one burst. */
  async function carReport(car: string, values: Record<string, unknown>) {
    data(car, "reported_at", new Date(now - 30_000).toISOString());
    for (const [alias, value] of Object.entries(values)) data(car, alias, value);
    await flush();
  }

  /** Both cars charge at once: the Tuya at 1.3 kW, the Legrand at 7 kW, for an hour. */
  async function bothAtOnce(each: (minute: number) => Promise<void>) {
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 60; i++) {
      data("charger", "power", 1300);
      data("legrand", "power", 7000);
      await each(i);
      tracker.tick();
      now += MIN;
      data("grid", "energy", 8300 / 60);
    }
    data("charger", "vehicle", "disconnected");
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 0);
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
  }

  it("gives each car its charger by the power it says it charges at", async () => {
    await bothAtOnce(async (i) => {
      if (i === 2) {
        await carReport("megane", { charging_state: "charging" });
        await carReport("rafale", { charging_state: "charging" });
      }
      if (i % 15 === 5) {
        await carReport("megane", { charge_power: 6900 });
        await carReport("rafale", { charge_power: 1400 });
      }
    });
    // The other charger claims the Megane for sure: the Rafale is left.
    expect(sessions()[0]).toMatchObject({ vehicleId: "rafale" });
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
    expect([sessions()[0].attributionReason, legrand()[0].attributionReason]).toContain(
      "power-match",
    );
  });

  it("never gives a guest's session to a car charging elsewhere at another power", async () => {
    data("charger", "vehicle", "charging"); // a guest at 3 kW
    for (let i = 0; i < 60; i++) {
      data("charger", "power", 3000);
      if (i === 5) await carReport("rafale", { charging_state: "charging" });
      if (i % 20 === 10) await carReport("rafale", { charge_power: 11000 });
      now += MIN;
      data("grid", "energy", 50);
    }
    data("charger", "vehicle", "disconnected");
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0].attribution).toBe("unattributed");
  });

  it("gives each car its charger by the energy its battery took", async () => {
    // What each car learned at home before: Megane 500 Wh per point, Rafale 150.
    const past = (car: string, wh: number, from: number, to: number, day: number) => {
      const at = new Date(T0 - day * 24 * H).toISOString();
      const record: SessionRecord = {
        id: `past-${car}-${day}`,
        chargerId: "charger",
        chargerName: "Borne",
        startedAt: at,
        endedAt: at,
        graceUntil: at,
        energyWh: wh,
        estCarWh: wh,
        estGridHpWh: wh,
        estGridHcWh: 0,
        estCostHpEur: null,
        estCostHcEur: null,
        vehicleId: car,
        vehicleName: car,
        vehicleDeleted: false,
        attribution: "vehicle",
        attributionSource: "manual",
        attributionReason: null,
        batteryStart: from,
        batteryEnd: to,
        evidence: [],
        updatedAt: at,
      };
      store.save(record);
    };
    past("megane", 10_000, 30, 50, 3);
    past("rafale", 3_000, 20, 40, 4);
    await bothAtOnce(async (i) => {
      if (i === 2) {
        await carReport("megane", { charging_state: "charging", battery_level: 40 });
        await carReport("rafale", { charging_state: "charging", battery_level: 30 });
      }
      if (i === 58) {
        await carReport("megane", { battery_level: 54 }); // 7 kWh / 500
        await carReport("rafale", { battery_level: 39 }); // 1.3 kWh / 150
      }
    });
    // The other charger claims the Megane for sure: the Rafale is left.
    expect(sessions()[0]).toMatchObject({ vehicleId: "rafale" });
    expect(legrand()[0]).toMatchObject({ vehicleId: "megane" });
    expect([sessions()[0].attributionReason, legrand()[0].attributionReason]).toContain(
      "energy-match",
    );
  });

  const evidenceOf = (sessionId: string, car: string) =>
    store.get(sessionId)!.evidence.find((e) => e.vehicleId === car);

  it("never hands both sessions to the car without power data on two chargers alike", async () => {
    // Both chargers at 7 kW; the Megane (on the Legrand) reports its power,
    // the Rafale (on the other) does not.
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 60; i++) {
      data("charger", "power", 7000);
      data("legrand", "power", 7000);
      if (i === 2) {
        await carReport("megane", { charging_state: "charging" });
        await carReport("rafale", { charging_state: "charging" });
      }
      if (i % 15 === 5) await carReport("megane", { charge_power: 6900 });
      tracker.tick();
      now += MIN;
      data("grid", "energy", 14000 / 60);
    }
    data("charger", "vehicle", "disconnected");
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 0);
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0].vehicleId).not.toBe("megane");
    expect(legrand()[0].vehicleId).not.toBe("rafale");
  });

  it("takes no power sample at a charge's start or stop", async () => {
    // A guest's charger runs from minute 30 to 88; the car reports 7 kW just
    // before the first 7 kW reading and just after the last.
    data("charger", "vehicle", "connected");
    for (let i = 0; i < 100; i++) {
      const drawing = i >= 30 && i < 88;
      data("charger", "power", drawing ? 7000 : 0);
      if (i === 29) await carReport("rafale", { charge_power: 7000 });
      if (i === 89) await carReport("rafale", { charge_power: 6800 });
      now += MIN;
    }
    expect(evidenceOf(sessions()[0].id, "rafale")?.powerSamples ?? 0).toBe(0);
  });

  it("counts a report repeated with the same time as one sample", async () => {
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 20; i++) {
      data("charger", "power", 3000);
      if (i === 10) {
        await carReport("rafale", { charge_power: 3100 });
        data("rafale", "charge_power", 3100); // published again, same report
        await flush();
      }
      now += MIN;
    }
    expect(evidenceOf(sessions()[0].id, "rafale")?.powerSamples).toBe(1);
  });

  it("takes no sample from a late report dated in a metered pause", async () => {
    for (let i = 0; i < 20; i++) {
      data("legrand", "power", 7000);
      now += MIN;
    }
    const inPause = now + 5 * MIN;
    for (let i = 0; i < 20; i++) {
      data("legrand", "power", 0);
      now += MIN;
    }
    for (let i = 0; i < 5; i++) {
      data("legrand", "power", 7000);
      now += MIN;
    }
    data("megane", "reported_at", new Date(inPause).toISOString());
    data("megane", "charge_power", 7000);
    await flush();
    expect(evidenceOf(legrand()[0].id, "megane")?.powerSamples ?? 0).toBe(0);
  });

  it("lets a choice by hand on one charger settle the other (second review P2)", async () => {
    setUsual("legrand", "megane");
    await bothAtOnce(async (i) => {
      if (i === 2) {
        await carReport("megane", { charging_state: "charging" });
        await carReport("rafale", { charging_state: "charging" });
        tracker.setAttribution(sessions()[0].id, { target: "vehicle", vehicleId: "megane" });
      }
    });
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane", attributionSource: "manual" });
    expect(legrand()[0]).toMatchObject({ vehicleId: "rafale" });
  });

  it("lets a sure claim win over a usual-vehicle guess elsewhere (second review P1)", async () => {
    setUsual("legrand", "megane");
    data("charger", "vehicle", "charging"); // the Borne from 0 to 60 min
    for (let i = 0; i < 150; i++) {
      if (i < 60) data("charger", "power", 2000);
      if (i === 60) data("charger", "vehicle", "disconnected");
      if (i >= 30) data("legrand", "power", 7000); // the Legrand from 30 to 150 min
      if (i === 40) await carReport("megane", { charging_state: "charging" });
      if (i === 100) await carReport("rafale", { charging_state: "charging" });
      tracker.tick();
      now += MIN;
      data("grid", "energy", 150);
    }
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 0);
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0]).toMatchObject({ vehicleId: "megane" });
    expect(legrand()[0]).toMatchObject({ vehicleId: "rafale" });
  });

  it("leaves two cars at once to attribute without power or energy data", async () => {
    await bothAtOnce(async (i) => {
      if (i === 2) {
        await carReport("megane", { charging_state: "charging" });
        await carReport("rafale", { charging_state: "charging" });
      }
    });
    expect(sessions()[0].attribution).toBe("unattributed");
    expect(legrand()[0].attribution).toBe("unattributed");
  });
});

describe("audit second review", () => {
  beforeEach(() => {
    tracker.stop();
    eqs.add("legrand", "ev_charger", "Legrand");
    eqs.set("legrand", "power", 0);
    tracker = makeTracker();
  });
  const legrand = () => tracker.listByCharger("legrand", "2026-11")!;
  async function report(car: string, state: string, atMs: number) {
    data(car, "reported_at", new Date(atMs).toISOString());
    data(car, "charging_state", state);
    await flush();
  }
  function minute(also?: () => void) {
    data("charger", "power", 2000);
    also?.();
    tracker.tick();
    now += MIN;
    data("grid", "energy", 200);
  }

  it("never swaps two cars that plug in minutes apart and report late", async () => {
    const t0 = now;
    data("charger", "vehicle", "charging"); // the Rafale on A at T0
    minute();
    minute();
    now += 30_000;
    await report("megane", "charging", t0 + 2 * MIN); // only A is open yet
    now = t0 + 3 * MIN;
    minute(() => data("legrand", "power", 7000)); // B opens at T0+3
    await report("rafale", "charging", t0 + MIN); // dated before B: nearer A's start
    for (let i = 0; i < 60; i++) minute(() => data("legrand", "power", 7000));
    data("charger", "vehicle", "disconnected");
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 0);
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
    // Never the two cars swapped and presented as sure.
    expect(sessions()[0].vehicleId).not.toBe("megane");
    expect(legrand()[0].vehicleId).not.toBe("rafale");
  });

  it("never swaps the cars when the metered charger opens minutes after its plug-in", async () => {
    const t0 = now;
    data("charger", "vehicle", "charging"); // the Rafale on A at T0
    await report("rafale", "charging", t0);
    now = t0 + 3 * MIN;
    await report("megane", "charging", now); // plugged into B; B sees no power yet
    while (now < t0 + 10 * MIN) minute();
    let level = 30;
    for (let i = 0; i < 60; i++) {
      minute(() => data("legrand", "power", 7000)); // B opens at T0+10
      if (i % 10 === 9) {
        level += 3; // the Rafale's battery keeps rising
        data("rafale", "reported_at", new Date(now - 30_000).toISOString());
        data("rafale", "battery_level", level);
        await flush();
      }
    }
    data("charger", "vehicle", "disconnected");
    for (let i = 0; i < 31; i++) {
      data("legrand", "power", 0);
      tracker.tick();
      now += MIN;
    }
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0].vehicleId).not.toBe("megane");
    expect(legrand()[0].vehicleId).not.toBe("rafale");
  });

  it("keeps a guest's session to attribute when an away car reports home after its end", async () => {
    eqs.set("rafale", "at_home", false, now - 20 * MIN);
    data("charger", "vehicle", "charging"); // a guest
    run(10, 3000, 3000);
    await report("rafale", "charging", now - MIN); // charging elsewhere
    run(20, 3000, 3000);
    data("charger", "vehicle", "disconnected");
    now += 10 * MIN;
    data("rafale", "at_home", true); // it drove home after
    await flush();
    now += GRACE_MS;
    tracker.tick();
    expect(sessions()[0].attribution).toBe("unattributed");
  });

  it("counts a meter silence inside a window as all grid", () => {
    data("charger", "vehicle", "charging");
    for (let i = 0; i < 30; i++) {
      data("charger", "power", 6000);
      now += MIN;
      // Silent for 13 min (longer than a delta may span), then a delta of its
      // last minute only: the minutes between are a hole.
      if (i < 5 || i > 17) data("grid", "energy", 100);
      tracker.tick();
    }
    data("charger", "vehicle", "disconnected");
    now += 5 * MIN;
    tracker.tick();
    expect(sessions()[0].solarWh).toBeLessThan(1);
  });

  it("follows the final battery of a session given by hand after its end", async () => {
    data("charger", "vehicle", "charging");
    data("megane", "battery_level", 40);
    await flush();
    run(30, 7000, 7000);
    data("charger", "vehicle", "disconnected");
    now += MIN;
    tracker.setAttribution(sessions()[0].id, { target: "vehicle", vehicleId: "megane" });
    now += 2 * MIN;
    data("megane", "reported_at", new Date(now - 30_000).toISOString());
    data("megane", "battery_level", 62);
    await flush();
    expect(sessions()[0]).toMatchObject({ batteryStart: 40, batteryEnd: 62 });
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

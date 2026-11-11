import { describe, it, expect, beforeEach } from "vitest";
import { ArbiterGainMeter, GAIN_SINCE_KEY } from "./arbiter-gain-meter.js";
import { ArbiterGainStore } from "./arbiter-gain-store.js";
import { TariffClassifier } from "./tariff-classifier.js";
import { createLogger } from "../core/logger.js";
import { createMigratedTestDb } from "../test-helpers/migrations.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { ArbiterLoadInfo, ArbiterPublicState, TariffConfig } from "../shared/types.js";

// Spec 200 — the arbiter gain meter: solar used by the granted loads, served
// last by the sun. Spec 202 — booked in Wh, peak and off-peak by the schedule
// of the minute, never in euros: the price is applied when the row is read.

const logger = createLogger("silent").logger;

const TARIFF: TariffConfig = {
  schedules: [
    {
      days: [0, 1, 2, 3, 4, 5, 6],
      slots: [
        { start: "06:00", end: "22:00", tariff: "hp" },
        { start: "22:00", end: "06:00", tariff: "hc" },
      ],
    },
  ],
  prices: { hp: 0.2, hc: 0.1 },
};

function load(equipmentId: string, state: ArbiterLoadInfo["state"], watts: number | null) {
  return {
    equipmentId,
    equipmentName: equipmentId,
    state,
    watts,
    needW: null,
    shortfallW: null,
    toleratedImportW: null,
  } as ArbiterLoadInfo;
}

interface Harness {
  meter: ArbiterGainMeter;
  store: ArbiterGainStore;
  settings: Map<string, string>;
  setState: (s: Partial<ArbiterPublicState>) => void;
  setNow: (t: Date) => void;
  throwOnState: (yes: boolean) => void;
}

function harness(): Harness {
  const db = createMigratedTestDb();
  const store = new ArbiterGainStore(db, logger);
  const settings = new Map<string, string>();
  const settingsApi = {
    get: (k: string) => settings.get(k),
    set: (k: string, v: string) => void settings.set(k, v),
  };
  const tariff = new TariffClassifier(
    { get: () => JSON.stringify(TARIFF) } as unknown as SettingsManager,
    logger,
  );
  let state: Partial<ArbiterPublicState> = { enabled: true, availableSurplusW: 0, loads: [] };
  let now = new Date(2026, 10, 10, 12, 0).getTime();
  let fail = false;
  const meter = new ArbiterGainMeter({
    arbiter: {
      getPublicState: () => {
        if (fail) throw new Error("boom");
        return state as ArbiterPublicState;
      },
    },
    tariff,
    store,
    settings: settingsApi,
    logger,
    now: () => now,
  });
  return {
    meter,
    store,
    settings,
    setState: (s) => (state = { ...state, ...s }),
    setNow: (t) => (now = t.getTime()),
    throwOnState: (yes) => (fail = yes),
  };
}

/** Two samples one minute apart under the given state; returns the pending rows. */
function minute(h: Harness, at: Date, s: Partial<ArbiterPublicState>) {
  h.setState(s);
  h.setNow(at);
  h.meter.sample();
  h.setNow(new Date(at.getTime() + 60_000));
  h.meter.sample();
  return h.meter.pending("0000-00-00", "9999-99-99");
}

const NOON = new Date(2026, 10, 10, 12, 0);

describe("ArbiterGainMeter", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("splits the solar of an exporting home pro rata of the granted draws", () => {
    const rows = minute(h, NOON, {
      availableSurplusW: 200,
      loads: [load("car", "granted", 1000), load("heater", "granted", 500)],
    });
    const car = rows.find((r) => r.equipmentId === "car")!;
    const heater = rows.find((r) => r.equipmentId === "heater")!;
    expect(car.solarWh).toBeCloseTo(1000 / 60, 6);
    expect(heater.solarWh).toBeCloseTo(500 / 60, 6);
    // Noon is peak time: all of it in HP, and no euro booked (spec 202).
    expect(car.solarHpWh).toBeCloseTo(1000 / 60, 6);
    expect(car.solarHcWh).toBeCloseTo(0, 9);
    expect(car.avoidedEur).toBe(0);
    expect(car.day).toBe("2026-11-10");
  });

  it("charges the import to the managed loads first", () => {
    const rows = minute(h, NOON, {
      availableSurplusW: -600,
      loads: [load("car", "granted", 1000), load("heater", "granted", 500)],
    });
    expect(rows.find((r) => r.equipmentId === "car")!.solarWh).toBeCloseTo(600 / 60, 6);
    expect(rows.find((r) => r.equipmentId === "heater")!.solarWh).toBeCloseTo(300 / 60, 6);
  });

  it("books nothing when the import covers the whole granted draw", () => {
    const rows = minute(h, NOON, {
      availableSurplusW: -2000,
      loads: [load("car", "granted", 1000)],
    });
    expect(rows).toEqual([]);
  });

  it("counts only the loads in state granted", () => {
    const rows = minute(h, NOON, {
      availableSurplusW: 5000,
      loads: [
        load("idle-grant", "granted-idle", 800),
        load("pending", "pending", 600),
        load("unmanaged", "unmanaged", 900),
        load("car", "granted", 1000),
      ],
    });
    expect(rows.map((r) => r.equipmentId)).toEqual(["car"]);
  });

  it("books nothing while disabled or with a stale meter, and not the gap after", () => {
    h.setState({ enabled: false, loads: [load("car", "granted", 1000)] });
    h.setNow(NOON);
    h.meter.sample();
    h.setState({ enabled: true, availableSurplusW: null });
    h.setNow(new Date(NOON.getTime() + 60_000));
    h.meter.sample();
    h.setState({ availableSurplusW: 1000 });
    h.setNow(new Date(NOON.getTime() + 120_000));
    h.meter.sample(); // first fresh sample: books nothing
    expect(h.meter.pending("0000", "9999")).toEqual([]);
    h.setNow(new Date(NOON.getTime() + 180_000));
    h.meter.sample();
    expect(h.meter.pending("0000", "9999")[0].solarWh).toBeCloseTo(1000 / 60, 6);
  });

  it("caps a long gap between samples at 120 s", () => {
    h.setState({ availableSurplusW: 1000, loads: [load("car", "granted", 1000)] });
    h.setNow(NOON);
    h.meter.sample();
    h.setNow(new Date(NOON.getTime() + 10 * 60_000));
    h.meter.sample();
    expect(h.meter.pending("0000", "9999")[0].solarWh).toBeCloseTo((1000 * 120) / 3600, 6);
  });

  it("splits a sample across a tariff change with the classifier's split", () => {
    h.setState({ availableSurplusW: 1000, loads: [load("car", "granted", 1200)] });
    h.setNow(new Date(2026, 10, 10, 21, 59));
    h.meter.sample();
    h.setNow(new Date(2026, 10, 10, 22, 1)); // 21:59 to 22:01, half HP, half HC
    h.meter.sample();
    const row = h.meter.pending("0000", "9999")[0];
    expect(row.solarWh).toBeCloseTo(40, 6);
    expect(row.solarHpWh).toBeCloseTo(20, 6);
    expect(row.solarHcWh).toBeCloseTo(20, 6);
    expect(row.avoidedEur).toBe(0);
  });

  it("books a sample on the local day it started", () => {
    h.setState({ availableSurplusW: 1000, loads: [load("car", "granted", 600)] });
    h.setNow(new Date(2026, 10, 10, 23, 59));
    h.meter.sample();
    h.setNow(new Date(2026, 10, 11, 0, 0));
    h.meter.sample();
    h.setNow(new Date(2026, 10, 11, 0, 1));
    h.meter.sample();
    expect(
      h.meter
        .pending("0000", "9999")
        .map((r) => r.day)
        .sort(),
    ).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("moves the pending rows to the store on flush, and on stop", () => {
    minute(h, NOON, { availableSurplusW: 1000, loads: [load("car", "granted", 600)] });
    h.meter.flush();
    expect(h.meter.pending("0000", "9999")).toEqual([]);
    expect(h.store.range("2026-11-10", "2026-11-10")[0].solarWh).toBeCloseTo(10, 6);

    minute(h, NOON, { availableSurplusW: 1000, loads: [load("car", "granted", 600)] });
    h.meter.stop();
    expect(h.store.range("2026-11-10", "2026-11-10")[0].solarWh).toBeCloseTo(20, 6);
  });

  it("writes the first measured day once", () => {
    h.setNow(NOON);
    h.meter.sample();
    expect(h.settings.get(GAIN_SINCE_KEY)).toBe("2026-11-10");
    h.setNow(new Date(2026, 10, 12, 12));
    h.meter.sample();
    expect(h.meter.since()).toBe("2026-11-10");
  });

  it("does not mark the first day while the arbiter is disabled", () => {
    h.setState({ enabled: false });
    h.meter.sample();
    expect(h.meter.since()).toBeNull();
  });

  it("never throws when the arbiter does", () => {
    h.throwOnState(true);
    expect(() => h.meter.sample()).not.toThrow();
  });
});

describe("ArbiterGainStore", () => {
  it("adds to what a (day, load) holds and reads inclusive bounds", () => {
    const store = new ArbiterGainStore(createMigratedTestDb(), logger);
    const row = (day: string, solarHpWh: number, solarHcWh: number) => ({
      day,
      equipmentId: "car",
      solarWh: solarHpWh + solarHcWh,
      solarHpWh,
      solarHcWh,
      avoidedEur: 0,
    });
    store.add([row("2026-11-10", 80, 20)]);
    store.add([row("2026-11-10", 30, 20), row("2026-11-12", 10, 0), row("2026-11-13", 1, 0)]);
    const rows = store.range("2026-11-10", "2026-11-12");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      day: "2026-11-10",
      solarWh: 150,
      solarHpWh: 110,
      solarHcWh: 40,
      avoidedEur: 0,
    });
    expect(rows[1].day).toBe("2026-11-12");
  });

  it("keeps the euros a row booked before spec 202 when Wh are added to it", () => {
    const db = createMigratedTestDb();
    // A row as migration 043 wrote it: euros, no HP/HC split.
    db.prepare(
      "INSERT INTO arbiter_daily_gain (day, equipment_id, solar_wh, avoided_eur) VALUES (?, ?, ?, ?)",
    ).run("2026-11-10", "car", 100, 0.02);
    const store = new ArbiterGainStore(db, logger);
    store.add([
      {
        day: "2026-11-10",
        equipmentId: "car",
        solarWh: 50,
        solarHpWh: 50,
        solarHcWh: 0,
        avoidedEur: 0,
      },
    ]);
    expect(store.range("2026-11-10", "2026-11-10")[0]).toMatchObject({
      solarWh: 150,
      solarHpWh: 50,
      solarHcWh: 0,
      avoidedEur: 0.02,
    });
  });
});

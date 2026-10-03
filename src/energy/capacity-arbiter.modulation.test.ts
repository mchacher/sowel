/**
 * Spec 185 — modulating capacity claims.
 *
 * The binary arbiter is covered, unchanged, by capacity-arbiter.test.ts (AC1).
 * This file drives the modulating paths on a closed-loop PLANT: the grid
 * reading is production − base − what the loads actually draw, and an EV
 * charger follows its budget with a lag, the way the meter and the car do.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { budgetOnGrid, CapacityArbiter } from "./capacity-arbiter.js";
import { EventBus } from "../core/event-bus.js";
import type {
  ArbiterDecision,
  CapacityClaimHandle,
  CapacityClaimRequest,
  EnergyLoadProfile,
  EngineEvent,
  Equipment,
} from "../shared/types.js";

const silentLogger = {
  child: () => silentLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
} as never;

const EV_RANGE = { minW: 1380, maxW: 3680, stepW: 230 };

interface PlantOptions {
  priority?: string[];
  settings?: Record<string, string>;
  /** Seconds for the EV draw to reach its budget (first order). */
  evLagS?: number;
}

function makePlant(opts: PlantOptions = {}) {
  const settings = new Map<string, string>(
    Object.entries({
      "energy.arbiter.enabled": "true",
      "energy.arbiter.priority": JSON.stringify(opts.priority ?? ["ev", "pump", "heater"]),
      "energy.arbiter.smoothingS": "1",
      ...(opts.settings ?? {}),
    }),
  );
  const base = (id: string, type: string, profile?: EnergyLoadProfile) =>
    ({
      id,
      name: id,
      zoneId: "z",
      type,
      enabled: true,
      createdAt: "",
      updatedAt: "",
      energyProfile: profile,
    }) as Equipment & { energyProfile?: EnergyLoadProfile };
  const equipments = new Map([
    ["grid", base("grid", "main_energy_meter")],
    [
      "ev",
      base("ev", "ev_charger", {
        class: "deferrable",
        nominalPowerW: 3680,
        minOnS: 600,
        minOffS: 300,
      }),
    ],
    [
      "pump",
      base("pump", "pool_pump", {
        class: "deferrable",
        nominalPowerW: 600,
        minOnS: 900,
        minOffS: 300,
      }),
    ],
    [
      "heater",
      base("heater", "water_heater", {
        class: "deferrable",
        nominalPowerW: 2200,
        minOnS: 300,
        minOffS: 300,
      }),
    ],
  ]);
  const bindings: Record<string, Array<{ alias: string; category: string }>> = {
    grid: [{ alias: "power", category: "power" }],
    ev: [{ alias: "power", category: "power" }],
    pump: [{ alias: "power", category: "power" }],
    heater: [{ alias: "power", category: "power" }],
  };
  const learnedCalls: string[] = [];
  const equipmentManager = {
    getById: (id: string) => equipments.get(id) ?? null,
    getAll: () => [...equipments.values()],
    getDataBindingsWithValues: (id: string) => bindings[id] ?? [],
    setEnergyProfileLearned: (id: string) => learnedCalls.push(id),
  } as never;
  const eventBus = new EventBus(silentLogger);
  const events: EngineEvent[] = [];
  eventBus.on((e) => {
    if (e.type.startsWith("energy.")) events.push(e);
  });
  const journal: ArbiterDecision[] = [];
  const journalStore = {
    insert: (d: ArbiterDecision) => journal.push(d),
    loadRecent: () => [],
    range: () => [],
    purgeOlderThan: () => 0,
  } as never;
  const arbiter = new CapacityArbiter(
    eventBus,
    { get: (k: string) => settings.get(k), set: () => {} } as never,
    equipmentManager,
    silentLogger,
    false,
    journalStore,
  );
  arbiter.start();

  // ── The plant ──
  const plant = {
    productionW: 0,
    baseW: 300,
    noiseW: 0,
    evOn: false,
    evBudgetW: 0,
    evDrawW: 0,
    /** A car that ignores decreases (FR12). */
    evIgnoresDecrease: false,
    on: { pump: false, heater: false } as Record<string, boolean>,
    watts: { pump: 600, heater: 2200 } as Record<string, number>,
    samples: 0,
    importWs: 0,
    exportWs: 0,
  };
  let noisePhase = 0;
  const feed = (equipmentId: string, value: number) =>
    eventBus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "power",
      value,
      previous: null,
    });

  /** Advance the plant and the clock in 10 s steps. */
  const run = (seconds: number) => {
    const lag = opts.evLagS ?? 10;
    for (let i = 0; i < Math.ceil(seconds / 10); i++) {
      vi.advanceTimersByTime(10_000);
      const target = plant.evOn ? plant.evBudgetW : 0;
      const follow = plant.evIgnoresDecrease && target < plant.evDrawW ? plant.evDrawW : target;
      plant.evDrawW += (follow - plant.evDrawW) * Math.min(1, 10 / lag);
      feed("ev", Math.round(plant.evDrawW));
      for (const id of ["pump", "heater"]) feed(id, plant.on[id] ? plant.watts[id] : 0);
      noisePhase += 1;
      const noise = plant.noiseW * Math.sin(noisePhase * 0.7) * Math.cos(noisePhase * 0.13);
      const load =
        plant.baseW +
        plant.evDrawW +
        (plant.on.pump ? plant.watts.pump : 0) +
        (plant.on.heater ? plant.watts.heater : 0);
      const grid = Math.round(load - plant.productionW + noise);
      plant.samples += 1;
      plant.importWs += Math.max(0, grid);
      plant.exportWs += Math.max(0, -grid);
      feed("grid", grid);
    }
  };

  const budgets: number[] = [];
  const order: string[] = [];
  const claimEv = (req: Partial<CapacityClaimRequest> = {}): CapacityClaimHandle =>
    arbiter.claim("inst-ev", {
      equipmentId: "ev",
      watts: 3680,
      modulation: EV_RANGE,
      onGranted: () => {
        plant.evOn = true;
        order.push("granted");
      },
      onRevoked: () => {
        plant.evOn = false;
        order.push("revoked");
      },
      onBudget: (w) => {
        plant.evBudgetW = w;
        budgets.push(w);
        order.push(`budget:${w}`);
      },
      ...req,
    });
  const claimBinary = (id: "pump" | "heater", req: Partial<CapacityClaimRequest> = {}) =>
    arbiter.claim(`inst-${id}`, {
      equipmentId: id,
      watts: plant.watts[id],
      onGranted: () => (plant.on[id] = true),
      onRevoked: () => (plant.on[id] = false),
      ...req,
    });

  const kinds = (k: string) => journal.filter((d) => d.kind === k);
  return {
    arbiter,
    plant,
    run,
    claimEv,
    claimBinary,
    budgets,
    order,
    events,
    journal,
    kinds,
    learnedCalls,
  };
}

describe("budgetOnGrid", () => {
  it("floors onto minW + k·stepW and clamps", () => {
    expect(budgetOnGrid(EV_RANGE, 1000)).toBe(1380);
    expect(budgetOnGrid(EV_RANGE, 1609)).toBe(1380);
    expect(budgetOnGrid(EV_RANGE, 1610)).toBe(1610);
    expect(budgetOnGrid(EV_RANGE, 9999)).toBe(3680);
    expect(budgetOnGrid(EV_RANGE, Number.NaN)).toBe(1380);
  });
});

describe("modulating claims (spec 185)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("refuses an invalid range", () => {
    const p = makePlant();
    p.run(10);
    for (const modulation of [
      { minW: 0, maxW: 3680, stepW: 230 },
      { minW: 2000, maxW: 1000, stepW: 230 },
      { minW: 1380, maxW: 3680, stepW: 0 },
    ]) {
      const h = p.claimEv({ modulation });
      expect(h.status()).toBe("denied");
      expect(h.deniedReason).toBe("invalid-modulation");
    }
  });

  it("engages on the minimum, then onGranted before onBudget with a budget on the grid (FR1)", () => {
    const p = makePlant();
    p.plant.productionW = 2300; // export 2000 at rest
    p.run(10);
    const h = p.claimEv();
    expect(h.status()).toBe("pending");
    p.run(130);
    expect(h.status()).toBe("granted");
    expect(p.order.slice(0, 2)).toEqual(["granted", "budget:1840"]);
    expect(h.budgetW?.()).toBe(1840);
    const granted = p.events.find((e) => e.type === "energy.capacity.granted");
    expect(granted).toMatchObject({ watts: 1840 });
  });

  it("does not engage when the surplus cannot cover the minimum", () => {
    const p = makePlant();
    p.plant.productionW = 1500; // export 1200 < 1380 + 100
    p.run(10);
    const h = p.claimEv();
    p.run(600);
    expect(h.status()).toBe("pending");
  });

  it("raises after the hold and not inside the settle window (FR4)", () => {
    const p = makePlant();
    p.plant.productionW = 2300;
    p.run(10);
    const h = p.claimEv();
    p.run(130);
    expect(h.budgetW?.()).toBe(1840);
    p.plant.productionW = 4400; // 2100 W more
    p.run(40);
    expect(h.budgetW?.()).toBe(1840); // holding
    p.run(60);
    const raised = h.budgetW?.() ?? 0;
    expect(raised).toBeGreaterThan(1840);
    const at = p.budgets.length;
    p.plant.productionW = 6000;
    p.run(60);
    expect(p.budgets.length).toBe(at); // settle window (90 s) still running
    p.run(120);
    expect(h.budgetW?.()).toBe(3680);
  });

  it("lowers at the next evaluation when the surplus drops (FR5)", () => {
    const p = makePlant();
    p.plant.productionW = 4400;
    p.run(10);
    const h = p.claimEv();
    p.run(300);
    expect(h.budgetW?.()).toBe(3680);
    p.plant.productionW = 2600; // 1800 W less
    p.run(20);
    expect(h.budgetW?.()).toBeLessThanOrEqual(2300);
    expect(h.status()).toBe("granted");
  });

  it("is revoked only at its minimum, after the release hold and its min-on (FR2)", () => {
    const p = makePlant();
    p.plant.productionW = 4400;
    p.run(10);
    const h = p.claimEv();
    p.run(700); // past minOnS 600
    p.plant.productionW = 500; // a cloud: import
    p.run(30);
    expect(h.budgetW?.()).toBe(1380);
    expect(h.status()).toBe("granted");
    p.run(620);
    expect(h.status()).toBe("pending");
    expect(p.order).toContain("revoked");
  });

  it("a binary load ranked above engages on what the modulating load yields (FR9)", () => {
    const p = makePlant({ priority: ["pump", "ev"] });
    p.plant.productionW = 4400;
    p.run(10);
    const ev = p.claimEv();
    p.run(300);
    expect(ev.budgetW?.()).toBe(3680);
    const pump = p.claimBinary("pump");
    p.run(130);
    expect(pump.status()).toBe("granted");
    expect(ev.status()).toBe("granted");
    // It yielded at least the pump's share; both fit in the surplus.
    expect(ev.budgetW?.()).toBeLessThan(3680);
    expect((ev.budgetW?.() ?? 0) + 600).toBeLessThanOrEqual(4100 - 100);
  });

  it("a binary load ranked below engages only on what is left (FR8)", () => {
    const p = makePlant({ priority: ["ev", "pump"] });
    p.plant.productionW = 4000; // export 3700 at rest
    p.run(10);
    const ev = p.claimEv();
    p.run(300);
    const pump = p.claimBinary("pump");
    p.run(300);
    expect(ev.budgetW?.()).toBe(3450); // 3700 − 100 = 3600, floored on the grid
    expect(pump.status()).toBe("pending");
    p.plant.productionW = 5000;
    p.run(300);
    expect(ev.budgetW?.()).toBe(3680);
    expect(pump.status()).toBe("granted");
  });

  it("on a deficit, lowers the modulating load before shedding a binary one (FR6)", () => {
    const p = makePlant({ priority: ["pump", "ev"] });
    p.plant.productionW = 5000;
    p.run(10);
    const pump = p.claimBinary("pump");
    p.run(130);
    const ev = p.claimEv();
    p.run(1000);
    expect(pump.status()).toBe("granted");
    p.plant.productionW = 3200; // ~1800 W less
    p.run(700);
    expect(pump.status()).toBe("granted");
    expect(ev.status()).toBe("granted");
    expect(ev.budgetW?.()).toBeLessThan(3680);
  });

  it("converges on a lagging, noisy plant without oscillating (AC5)", () => {
    const p = makePlant({ settings: { "energy.arbiter.smoothingS": "60" } });
    p.plant.productionW = 4300; // ~3700 surplus with the car off and the base
    p.plant.noiseW = 500;
    p.run(60);
    const h = p.claimEv();
    p.run(7200);
    expect(h.status()).toBe("granted");
    // Bounded movement: on average fewer than 12 changes per hour.
    expect(p.budgets.length).toBeLessThanOrEqual(24);
    // It uses most of the surplus.
    expect(h.budgetW?.()).toBeGreaterThanOrEqual(2990);
    // Average import and export over the run: the noise is ±500 W, so a
    // regulator that follows it cannot do much better than a few hundred watts.
    const avgImport = p.plant.importWs / p.plant.samples;
    const avgExport = p.plant.exportWs / p.plant.samples;
    expect(avgImport).toBeLessThan(250);
    expect(avgExport).toBeLessThan(900);
  });

  it("a load ignoring a decrease is journaled and does not shed the next load (FR12)", () => {
    const p = makePlant({ priority: ["pump", "ev"] });
    p.plant.productionW = 5000;
    p.run(10);
    const pump = p.claimBinary("pump");
    p.run(130);
    const ev = p.claimEv();
    p.run(1000);
    p.plant.evIgnoresDecrease = true;
    p.plant.productionW = 3200;
    p.run(1300);
    expect(p.kinds("budget-not-honored").length).toBeGreaterThanOrEqual(1);
    expect(pump.status()).toBe("granted");
    expect(ev.status()).toBe("granted");
  });

  it("coalesces budget-changed in the journal (FR14)", () => {
    const p = makePlant({ settings: { "energy.arbiter.smoothingS": "60" } });
    p.plant.productionW = 4000;
    p.plant.noiseW = 900;
    p.run(60);
    p.claimEv();
    p.run(3600);
    const changes = p.kinds("budget-changed");
    expect(changes.length).toBeLessThan(p.budgets.length || 1);
    expect(changes.length).toBeLessThanOrEqual(8);
  });

  it("never teaches the learner from a modulating run (FR11)", () => {
    const p = makePlant();
    p.plant.productionW = 4400;
    p.run(10);
    const h = p.claimEv();
    p.run(1200);
    h.release();
    expect(p.learnedCalls).not.toContain("ev");
  });

  it("publishes the budget and the range in the read model (FR16)", () => {
    const p = makePlant();
    p.plant.productionW = 3000;
    p.run(10);
    const h = p.claimEv();
    expect(
      p.arbiter.getPublicState().loads.find((l) => l.equipmentId === "ev")?.modulation,
    ).toEqual(EV_RANGE);
    p.run(200);
    const row = p.arbiter.getPublicState().loads.find((l) => l.equipmentId === "ev");
    expect(row?.budgetW).toBe(h.budgetW?.());
    expect(p.arbiter.getPublicState().grants[0]).toMatchObject({ budgetW: h.budgetW?.() });
  });

  it("a release resets the budget; the handle reads null", () => {
    const p = makePlant();
    p.plant.productionW = 3000;
    p.run(10);
    const h = p.claimEv();
    p.run(200);
    expect(h.budgetW?.()).not.toBeNull();
    h.release();
    expect(h.budgetW?.()).toBeNull();
  });

  it("emits energy.capacity.budget on every applied change", () => {
    const p = makePlant();
    p.plant.productionW = 2300;
    p.run(10);
    p.claimEv();
    p.run(130);
    p.plant.productionW = 4400;
    p.run(200);
    const budgetEvents = p.events.filter((e) => e.type === "energy.capacity.budget");
    expect(budgetEvents.length).toBe(p.budgets.length - 1); // the first one rides on `granted`
  });
});

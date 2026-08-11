import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { SelfConsumptionWriter } from "./self-consumption-writer.js";
import { Point } from "../core/influx-client.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { TariffClassifier } from "./tariff-classifier.js";

const logger = createLogger("silent").logger;

/**
 * Stub TariffClassifier — splits a value 60/40 into hp/hc deterministically
 * and records the window it was asked to classify. Real tariff prorata is
 * exercised in tariff-classifier.test.ts; here we only assert the writer
 * routes household values through the classifier over the right window.
 */
const classifyCalls: Array<{ totalWh: number; windowStart: number; windowS?: number }> = [];
const stubTariff: TariffClassifier = {
  classify: (totalWh: number, windowStart: number, windowS?: number) => {
    classifyCalls.push({ totalWh, windowStart, windowS });
    return { hp: Math.round(totalWh * 0.6), hc: Math.round(totalWh * 0.4) };
  },
} as unknown as TariffClassifier;

const GRID_ID = "grid-uuid";
const SOLAR_ID = "solar-uuid";
const ZONE_ID = "zone-uuid";

interface CapturedPoint {
  alias: string;
  value: number;
  timestamp: number | undefined;
  equipmentId: string;
}

class StubInfluxClient {
  connected = true;
  written: CapturedPoint[] = [];
  isConnected(): boolean {
    return this.connected;
  }
  writePoint(point: Point): void {
    const tags = (point as unknown as { tags: Record<string, string> }).tags ?? {};
    const fields = (point as unknown as { fields: Record<string, string> }).fields ?? {};
    // The write API runs at "s" precision (see InfluxClient), so points carry
    // epoch seconds verbatim.
    const ts = (point as unknown as { time?: string }).time;
    this.written.push({
      alias: tags.alias,
      equipmentId: tags.equipmentId,
      value: parseFloat(fields.value_number ?? "0"),
      timestamp: ts !== undefined ? Number(ts) : undefined,
    });
  }
}

function makeStubEquipmentManager(opts: {
  gridEnabled?: boolean;
  solarEnabled?: boolean;
  hasGrid?: boolean;
  hasSolar?: boolean;
}): EquipmentManager {
  const eqs: Array<{ id: string; type: string; enabled: boolean; zoneId: string }> = [];
  if (opts.hasGrid !== false) {
    eqs.push({
      id: GRID_ID,
      type: "main_energy_meter",
      enabled: opts.gridEnabled ?? true,
      zoneId: ZONE_ID,
    });
  }
  if (opts.hasSolar !== false) {
    eqs.push({
      id: SOLAR_ID,
      type: "energy_production_meter",
      enabled: opts.solarEnabled ?? true,
      zoneId: ZONE_ID,
    });
  }
  return {
    getById: (id: string) => eqs.find((e) => e.id === id) ?? null,
    getAll: () => eqs,
  } as unknown as EquipmentManager;
}

/**
 * Emit an energy delta. Without `sourceTimestamp` this is the live path (the
 * writer buckets on the wall clock, which the tests drive with fake timers);
 * with one it is the aligned-window path plugins like Netatmo use.
 */
function emitEnergyChange(
  bus: EventBus,
  equipmentId: string,
  value: number,
  sourceTimestamp?: number,
): void {
  bus.emit({
    type: "equipment.data.changed",
    equipmentId,
    alias: "energy",
    value,
    previous: null,
    ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
  } as never);
}

/** Minute-aligned epoch used as the base of every scenario. */
const T0 = 1714723200;
const T0_MS = T0 * 1000;

describe("SelfConsumptionWriter", () => {
  let bus: EventBus;
  let influx: StubInfluxClient;
  let writer: SelfConsumptionWriter;

  function makeWriter(
    eqManager: EquipmentManager = makeStubEquipmentManager({}),
  ): SelfConsumptionWriter {
    writer = new SelfConsumptionWriter(
      bus,
      eqManager,
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();
    return writer;
  }

  /** Move the wall clock to `T0 + seconds`. */
  function at(seconds: number): void {
    vi.setSystemTime(T0_MS + seconds * 1000);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_MS);
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
    classifyCalls.length = 0;
  });

  afterEach(() => {
    writer?.destroy();
    vi.useRealTimers();
  });

  it("writes autoconso=solar and injection=0 when grid is importing (grid > 0)", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(auto?.value).toBe(3);
    expect(auto?.equipmentId).toBe(SOLAR_ID);
    expect(inj?.value).toBe(0);
  });

  it("writes injection=|grid| and autoconso=solar-injection when exporting (grid < 0)", () => {
    makeWriter();

    // Solar produces 8, house uses 3 → grid exports 5 (gridΔ = -5)
    emitEnergyChange(bus, GRID_ID, -5);
    emitEnergyChange(bus, SOLAR_ID, 8);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(inj?.value).toBe(5);
    expect(auto?.value).toBe(3); // 8 - 5
  });

  it("writes 0/0 when neither side is producing/consuming", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 0);
    emitEnergyChange(bus, SOLAR_ID, 0);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(auto?.value).toBe(0);
    expect(inj?.value).toBe(0);
  });

  it("sums every tick of the minute instead of sampling one pair", () => {
    makeWriter();

    // A burst-reporting meter (Tuya PJ-1203A): ~30 ticks a minute, of which a
    // single one carries the counter jump. Sampling any one pair would write
    // autoconso = 0 and lose the whole minute.
    for (let i = 0; i < 10; i++) {
      at(i * 2);
      emitEnergyChange(bus, GRID_ID, 0);
      emitEnergyChange(bus, SOLAR_ID, 0);
    }
    at(40);
    emitEnergyChange(bus, GRID_ID, -20);
    emitEnergyChange(bus, SOLAR_ID, 50);
    for (let i = 0; i < 5; i++) {
      at(42 + i * 2);
      emitEnergyChange(bus, GRID_ID, 0);
      emitEnergyChange(bus, SOLAR_ID, 0);
    }
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(inj?.value).toBe(20); // export of the whole minute
    expect(auto?.value).toBe(30); // 50 produced - 20 injected
  });

  it("writes a grid-only minute as pure import (autoconso=0), leaving no hole", () => {
    // As the sole writer of the grid series it must cover every minute the
    // grid reported — a missing solar tick means no self-consumption, not an
    // undefined minute.
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    const energy = influx.written.find((p) => p.alias === "energy" && p.equipmentId === GRID_ID);
    expect(auto?.value).toBe(0);
    expect(inj?.value).toBe(0);
    expect(energy?.value).toBe(5); // household == grid import
    expect(energy?.timestamp).toBe(T0);
  });

  it("drops a solar-only minute (injection undefined without the grid side)", () => {
    makeWriter();

    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);

    expect(influx.written).toHaveLength(0);
  });

  it("writes one aligned point per minute", () => {
    makeWriter();

    at(10);
    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    at(50);
    emitEnergyChange(bus, GRID_ID, 6);
    emitEnergyChange(bus, SOLAR_ID, 4);
    // Next minute closes the previous bucket
    at(70);
    emitEnergyChange(bus, GRID_ID, 1);
    emitEnergyChange(bus, SOLAR_ID, 2);
    writer.flushPending(true);

    const autos = influx.written.filter((p) => p.alias === "autoconso");
    expect(autos).toHaveLength(2);
    expect(autos[0].value).toBe(7); // 3 + 4
    expect(autos[0].timestamp).toBe(T0); // aligned on the minute start
    expect(autos[1].value).toBe(2);
    expect(autos[1].timestamp).toBe(T0 + 60);
  });

  it("keeps a minute open until it elapses (no premature write)", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);

    // Still inside the minute: the sweep leaves it alone.
    at(30);
    writer.flushPending();
    expect(influx.written).toHaveLength(0);

    // Once elapsed, the sweep closes it without any new tick.
    at(60);
    writer.flushPending();
    expect(influx.written.filter((p) => p.alias === "autoconso")).toHaveLength(1);

    // Nothing left to flush.
    influx.written = [];
    writer.flushPending();
    expect(influx.written).toHaveLength(0);
  });

  it("folds an out-of-order tick into the open minute rather than dropping it", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0 + 70);
    emitEnergyChange(bus, SOLAR_ID, 3, T0 + 70);
    // Straggler stamped in the previous minute
    emitEnergyChange(bus, SOLAR_ID, 4, T0 + 10);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    expect(auto?.value).toBe(7); // 3 + 4, none lost
  });

  it("ignores other aliases (e.g. energy_hp, energy_forward) — only `energy` triggers", () => {
    makeWriter();

    bus.emit({
      type: "equipment.data.changed",
      equipmentId: GRID_ID,
      alias: "energy_forward",
      value: 19000,
      previous: null,
    } as never);
    bus.emit({
      type: "equipment.data.changed",
      equipmentId: SOLAR_ID,
      alias: "energy_hp",
      value: 5,
      previous: null,
    } as never);
    writer.flushPending(true);

    expect(influx.written).toHaveLength(0);
  });

  it("does not write if Solar production_meter is missing", () => {
    makeWriter(makeStubEquipmentManager({ hasSolar: false }));

    emitEnergyChange(bus, GRID_ID, 5);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });

  it("does not write if Influx is disconnected", () => {
    influx.connected = false;
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });

  it("writes grid-side energy/hp/hc with household-semantic values", () => {
    makeWriter();

    // grid imports 5 Wh, solar produces 3 Wh fully consumed in-house.
    // household = max(0, 5) + max(0, 3 - max(0, -5)) = 5 + 3 = 8
    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);

    const energy = influx.written.find((p) => p.alias === "energy" && p.equipmentId === GRID_ID);
    const hp = influx.written.find((p) => p.alias === "energy_hp" && p.equipmentId === GRID_ID);
    const hc = influx.written.find((p) => p.alias === "energy_hc" && p.equipmentId === GRID_ID);
    expect(energy?.value).toBe(8); // household
    expect(energy?.timestamp).toBe(T0); // aligned on the minute start
    expect(hp?.value).toBe(5); // 8 * 0.6 → 4.8 → 5
    expect(hc?.value).toBe(3); // 8 * 0.4 → 3.2 → 3
  });

  it("classifies a live bucket over its real 60 s window", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);

    expect(classifyCalls).toEqual([{ totalWh: 8, windowStart: T0, windowS: 60 }]);
  });

  it("keeps the 30-min window for plugin-supplied aligned windows", () => {
    // Netatmo / Legrand post already-aggregated 30-min windows with an
    // explicit sourceTimestamp; classifying those as one minute would
    // mis-prorate every tariff transition.
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 500, T0);
    emitEnergyChange(bus, SOLAR_ID, 200, T0);
    writer.flushPending(true);

    expect(classifyCalls).toEqual([{ totalWh: 700, windowStart: T0, windowS: 1800 }]);
    const energy = influx.written.find((p) => p.alias === "energy" && p.equipmentId === GRID_ID);
    expect(energy?.value).toBe(700); // household, at the aligned timestamp
    expect(energy?.timestamp).toBe(T0);
  });

  it("does not write grid-side when grid equipment is missing (solo solar)", () => {
    makeWriter(makeStubEquipmentManager({ hasGrid: false }));

    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);
    // No grid tick → the minute is undefined → no writes either way.
    expect(influx.written).toHaveLength(0);
  });

  it("destroy() flushes the open minute, then stops writing", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.destroy();
    expect(influx.written.filter((p) => p.alias === "autoconso")).toHaveLength(1);

    influx.written = [];
    at(60);
    emitEnergyChange(bus, GRID_ID, 5);
    emitEnergyChange(bus, SOLAR_ID, 3);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });
});

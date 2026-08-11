import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { SelfConsumptionWriter } from "./self-consumption-writer.js";
import { Point } from "../core/influx-client.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { TariffClassifier } from "./tariff-classifier.js";

const logger = createLogger("silent").logger;

/**
 * Stub TariffClassifier — splits a value 60/40 into hp/hc deterministically.
 * Real tariff prorata is exercised in tariff-classifier.test.ts; here we
 * only assert the writer routes household values through the classifier.
 */
const stubTariff: TariffClassifier = {
  classify: (totalWh: number) => ({
    hp: Math.round(totalWh * 0.6),
    hc: Math.round(totalWh * 0.4),
  }),
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

/** Minute-aligned epoch second used as the base of every scenario. */
const T0 = 1714723200;

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

  beforeEach(() => {
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
  });

  afterEach(() => {
    writer?.destroy();
  });

  it("writes autoconso=solar and injection=0 when grid is importing (grid > 0)", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0);
    emitEnergyChange(bus, SOLAR_ID, 3, T0);
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
    emitEnergyChange(bus, GRID_ID, -5, T0);
    emitEnergyChange(bus, SOLAR_ID, 8, T0);
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(inj?.value).toBe(5);
    expect(auto?.value).toBe(3); // 8 - 5
  });

  it("writes 0/0 when neither side is producing/consuming", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 0, T0);
    emitEnergyChange(bus, SOLAR_ID, 0, T0);
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
      emitEnergyChange(bus, GRID_ID, 0, T0 + i * 2);
      emitEnergyChange(bus, SOLAR_ID, 0, T0 + i * 2);
    }
    emitEnergyChange(bus, GRID_ID, -20, T0 + 40);
    emitEnergyChange(bus, SOLAR_ID, 50, T0 + 40);
    for (let i = 0; i < 5; i++) {
      emitEnergyChange(bus, GRID_ID, 0, T0 + 42 + i * 2);
      emitEnergyChange(bus, SOLAR_ID, 0, T0 + 42 + i * 2);
    }
    writer.flushPending(true);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(inj?.value).toBe(20); // export of the whole minute
    expect(auto?.value).toBe(30); // 50 produced - 20 injected
  });

  it("does not write if only Grid arrived (no Solar tick in the minute)", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0);
    writer.flushPending(true);

    expect(influx.written).toHaveLength(0);
  });

  it("writes one aligned point per minute", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0 + 10);
    emitEnergyChange(bus, SOLAR_ID, 3, T0 + 10);
    emitEnergyChange(bus, GRID_ID, 6, T0 + 50);
    emitEnergyChange(bus, SOLAR_ID, 4, T0 + 50);
    // Next minute closes the previous bucket
    emitEnergyChange(bus, GRID_ID, 1, T0 + 70);
    emitEnergyChange(bus, SOLAR_ID, 2, T0 + 70);
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

    emitEnergyChange(bus, GRID_ID, 5, T0);
    emitEnergyChange(bus, SOLAR_ID, 3, T0);

    // T0 is in the past, so the sweep closes it; nothing forced.
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

    emitEnergyChange(bus, GRID_ID, 5, T0);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });

  it("does not write if Influx is disconnected", () => {
    influx.connected = false;
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0);
    emitEnergyChange(bus, SOLAR_ID, 3, T0);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });

  it("overwrites grid-side energy/hp/hc with household-semantic values", () => {
    makeWriter();

    // grid imports 5 Wh, solar produces 3 Wh fully consumed in-house.
    // household = max(0, 5) + max(0, 3 - max(0, -5)) = 5 + 3 = 8
    emitEnergyChange(bus, GRID_ID, 5, T0);
    emitEnergyChange(bus, SOLAR_ID, 3, T0);
    writer.flushPending(true);

    const energy = influx.written.find((p) => p.alias === "energy" && p.equipmentId === GRID_ID);
    const hp = influx.written.find((p) => p.alias === "energy_hp" && p.equipmentId === GRID_ID);
    const hc = influx.written.find((p) => p.alias === "energy_hc" && p.equipmentId === GRID_ID);
    expect(energy?.value).toBe(8); // household
    expect(energy?.timestamp).toBe(T0); // same minute the HistoryWriter uses ⇒ upsert
    expect(hp?.value).toBe(5); // 8 * 0.6 → 4.8 → 5
    expect(hc?.value).toBe(3); // 8 * 0.4 → 3.2 → 3
  });

  it("does not overwrite grid-side when grid equipment is missing (solo solar)", () => {
    makeWriter(makeStubEquipmentManager({ hasGrid: false }));

    emitEnergyChange(bus, SOLAR_ID, 3, T0);
    writer.flushPending(true);
    // No grid event → no pairing → no writes either way.
    expect(influx.written).toHaveLength(0);
  });

  it("destroy() flushes the open minute, then stops writing", () => {
    makeWriter();

    emitEnergyChange(bus, GRID_ID, 5, T0);
    emitEnergyChange(bus, SOLAR_ID, 3, T0);
    writer.destroy();
    expect(influx.written.filter((p) => p.alias === "autoconso")).toHaveLength(1);

    influx.written = [];
    emitEnergyChange(bus, GRID_ID, 5, T0 + 60);
    emitEnergyChange(bus, SOLAR_ID, 3, T0 + 60);
    writer.flushPending(true);
    expect(influx.written).toHaveLength(0);
  });
});

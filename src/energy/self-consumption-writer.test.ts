import { describe, it, expect, beforeEach } from "vitest";
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
    const tsNs = (point as unknown as { time?: string }).time;
    this.written.push({
      alias: tags.alias,
      equipmentId: tags.equipmentId,
      value: parseFloat(fields.value_number ?? "0"),
      timestamp: tsNs ? Math.floor(parseInt(tsNs, 10) / 1e9) : undefined,
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

describe("SelfConsumptionWriter", () => {
  let bus: EventBus;
  let influx: StubInfluxClient;
  let writer: SelfConsumptionWriter;

  beforeEach(() => {
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
  });

  it("writes autoconso=solar and injection=0 when grid is importing (grid > 0)", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t = 1714723200; // arbitrary epoch s
    emitEnergyChange(bus, GRID_ID, 5, t);
    emitEnergyChange(bus, SOLAR_ID, 3, t);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(auto?.value).toBe(3);
    expect(auto?.equipmentId).toBe(SOLAR_ID);
    expect(inj?.value).toBe(0);
  });

  it("writes injection=|grid| and autoconso=solar-injection when exporting (grid < 0)", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t = 1714723200;
    // Solar produces 8, house uses 3 → grid exports 5 (gridΔ = -5)
    emitEnergyChange(bus, GRID_ID, -5, t);
    emitEnergyChange(bus, SOLAR_ID, 8, t);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(inj?.value).toBe(5);
    expect(auto?.value).toBe(3); // 8 - 5
  });

  it("writes 0/0 when neither side is producing/consuming", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t = 1714723200;
    emitEnergyChange(bus, GRID_ID, 0, t);
    emitEnergyChange(bus, SOLAR_ID, 0, t);

    const auto = influx.written.find((p) => p.alias === "autoconso");
    const inj = influx.written.find((p) => p.alias === "injection");
    expect(auto?.value).toBe(0);
    expect(inj?.value).toBe(0);
  });

  it("does not write if only Grid arrived (no Solar tick yet)", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    emitEnergyChange(bus, GRID_ID, 5, 1714723200);

    expect(influx.written).toHaveLength(0);
  });

  it("does not write twice for the same minute", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t = 1714723200; // minute boundary
    emitEnergyChange(bus, GRID_ID, 5, t);
    emitEnergyChange(bus, SOLAR_ID, 3, t);
    // Second pair within the same minute (e.g. retry / duplicate)
    emitEnergyChange(bus, GRID_ID, 6, t + 10);
    emitEnergyChange(bus, SOLAR_ID, 4, t + 10);

    const autos = influx.written.filter((p) => p.alias === "autoconso");
    expect(autos).toHaveLength(1);
  });

  it("writes again on the next minute", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t1 = 1714723200;
    const t2 = t1 + 60;
    emitEnergyChange(bus, GRID_ID, 5, t1);
    emitEnergyChange(bus, SOLAR_ID, 3, t1);
    emitEnergyChange(bus, GRID_ID, 6, t2);
    emitEnergyChange(bus, SOLAR_ID, 4, t2);

    const autos = influx.written.filter((p) => p.alias === "autoconso");
    expect(autos).toHaveLength(2);
    expect(autos[0].value).toBe(3);
    expect(autos[1].value).toBe(4);
  });

  it("ignores ticks when skew between Grid and Solar exceeds the match window (90s)", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    emitEnergyChange(bus, GRID_ID, 5, 1714723200);
    // Solar event 2 minutes later — skew > 90s
    emitEnergyChange(bus, SOLAR_ID, 3, 1714723200 + 120);

    expect(influx.written).toHaveLength(0);
  });

  it("ignores other aliases (e.g. energy_hp, energy_forward) — only `energy` triggers", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

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

    expect(influx.written).toHaveLength(0);
  });

  it("does not write if Solar production_meter is missing", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({ hasSolar: false }),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    emitEnergyChange(bus, GRID_ID, 5, 1714723200);
    expect(influx.written).toHaveLength(0);
  });

  it("does not write if Influx is disconnected", () => {
    influx.connected = false;
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    emitEnergyChange(bus, GRID_ID, 5, 1714723200);
    emitEnergyChange(bus, SOLAR_ID, 3, 1714723200);
    expect(influx.written).toHaveLength(0);
  });

  it("overwrites grid-side energy/hp/hc with household-semantic values", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    const t = 1714723200;
    // grid imports 5 Wh, solar produces 3 Wh fully consumed in-house.
    // household = max(0, 5) + max(0, 3 - max(0, -5)) = 5 + 3 = 8
    emitEnergyChange(bus, GRID_ID, 5, t);
    emitEnergyChange(bus, SOLAR_ID, 3, t);

    const energy = influx.written.find((p) => p.alias === "energy" && p.equipmentId === GRID_ID);
    const hp = influx.written.find((p) => p.alias === "energy_hp" && p.equipmentId === GRID_ID);
    const hc = influx.written.find((p) => p.alias === "energy_hc" && p.equipmentId === GRID_ID);
    expect(energy?.value).toBe(8); // household
    expect(hp?.value).toBe(5); // 8 * 0.6 → 4.8 → 5
    expect(hc?.value).toBe(3); // 8 * 0.4 → 3.2 → 3
  });

  it("does not overwrite grid-side when grid equipment is missing (solo solar)", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({ hasGrid: false }),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();

    emitEnergyChange(bus, SOLAR_ID, 3, 1714723200);
    // No grid event → no pairing → no writes either way.
    expect(influx.written).toHaveLength(0);
  });

  it("destroy() unsubscribes — no further writes after destroy", () => {
    writer = new SelfConsumptionWriter(
      bus,
      makeStubEquipmentManager({}),
      influx as unknown as InfluxClient,
      stubTariff,
      logger,
    );
    writer.init();
    writer.destroy();

    emitEnergyChange(bus, GRID_ID, 5, 1714723200);
    emitEnergyChange(bus, SOLAR_ID, 3, 1714723200);
    expect(influx.written).toHaveLength(0);
  });
});

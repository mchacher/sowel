import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { HistoryWriter, enumToNumber } from "./history-writer.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { Point } from "../core/influx-client.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { DataCategory } from "../shared/types.js";

describe("enumToNumber (#434 — enum states charted)", () => {
  it("maps binary on/off-like states intuitively (1 = on, 0 = off)", () => {
    expect(enumToNumber("ON", ["ON", "OFF"])).toBe(1); // token wins over index (index would be 0)
    expect(enumToNumber("OFF", ["ON", "OFF"])).toBe(0); // token wins over index (index would be 1)
    expect(enumToNumber("OFF", ["OFF", "ON"])).toBe(0); // OFF token → 0 regardless of declared order
    expect(enumToNumber("OPEN", ["OPEN", "CLOSED"])).toBe(1);
    expect(enumToNumber("CLOSED", ["OPEN", "CLOSED"])).toBe(0);
    expect(enumToNumber("true", null)).toBe(1); // no list needed for a known token
    expect(enumToNumber("false", null)).toBe(0);
  });

  it("uses the declared-value index for multi-value enums (no token collision)", () => {
    expect(enumToNumber("IDLE", ["IDLE", "HEAT", "COOL"])).toBe(0);
    expect(enumToNumber("HEAT", ["IDLE", "HEAT", "COOL"])).toBe(1);
    expect(enumToNumber("COOL", ["IDLE", "HEAT", "COOL"])).toBe(2);
    // A 3-value enum containing an on/off token: index wins, NOT the token.
    expect(enumToNumber("OFF", ["LOW", "OFF", "HIGH"])).toBe(1);
  });

  it("falls back to the index for a 2-value enum without on/off tokens", () => {
    expect(enumToNumber("LOW", ["LOW", "HIGH"])).toBe(0);
    expect(enumToNumber("HIGH", ["LOW", "HIGH"])).toBe(1);
  });

  it("returns null when the value cannot be encoded (label kept in value_string)", () => {
    expect(enumToNumber("WHATEVER", null)).toBeNull();
    expect(enumToNumber("WHATEVER", [])).toBeNull();
    expect(enumToNumber("MISSING", ["A", "B", "C"])).toBeNull(); // not in the declared list
  });
});

describe("HistoryWriter.resolveHistorize", () => {
  // ============================================================
  // Explicit override
  // ============================================================

  it("returns true when historize=1 regardless of category", () => {
    expect(HistoryWriter.resolveHistorize(1, "anything", "generic")).toBe(true);
  });

  it("returns false when historize=0 regardless of category", () => {
    expect(HistoryWriter.resolveHistorize(0, "temperature", "temperature")).toBe(false);
  });

  // ============================================================
  // Category defaults — indoor + outdoor temperature/humidity
  // ============================================================

  it("historizes indoor temperature and humidity by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "temperature", "temperature")).toBe(true);
    expect(HistoryWriter.resolveHistorize(null, "humidity", "humidity")).toBe(true);
  });

  it("historizes outdoor temperature and humidity by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "temperature_2", "temperature_outdoor")).toBe(true);
    expect(HistoryWriter.resolveHistorize(null, "humidity_2", "humidity_outdoor")).toBe(true);
  });

  it("historizes the rest of the on-by-default categories", () => {
    const onByDefault: DataCategory[] = [
      "pressure",
      "luminosity",
      "rain",
      "wind",
      "co2",
      "voc",
      "noise",
      "shutter_position",
      "battery",
    ];
    for (const cat of onByDefault) {
      expect(HistoryWriter.resolveHistorize(null, cat, cat)).toBe(true);
    }
  });

  // ============================================================
  // Alias exclusions
  // ============================================================

  it("never historizes weather-forecast bindings (jN_* aliases)", () => {
    // Even though temperature_outdoor is on by default, the jN_ alias prefix
    // excludes forecast bindings from history (they update at hourly cadence
    // and the values are predictions, not measurements).
    expect(HistoryWriter.resolveHistorize(null, "j1_temp_max", "temperature_outdoor")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "j5_condition", "weather_condition")).toBe(false);
  });

  it("excludes raw cumulative energy counters (energy_forward / energy_reverse)", () => {
    expect(HistoryWriter.resolveHistorize(null, "energy_forward", "energy")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "energy_reverse", "energy")).toBe(false);
  });

  it("excludes rolling rain cumulatives (sum_rain_1 / sum_rain_24) but keeps incremental rain", () => {
    // Netatmo's rolling 1h/24h totals — historizing them makes the rain chart
    // plot a flat cumulative and sum-of-cumuls the WeatherAggregator.
    expect(HistoryWriter.resolveHistorize(null, "sum_rain_1", "rain")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "sum_rain_24", "rain")).toBe(false);
    // The incremental per-period rain stays historized.
    expect(HistoryWriter.resolveHistorize(null, "rain", "rain")).toBe(true);
  });

  // ============================================================
  // Default OFF for unrelated categories
  // ============================================================

  it("does not historize generic or unknown categories by default", () => {
    expect(HistoryWriter.resolveHistorize(null, "state", "generic")).toBe(false);
    expect(HistoryWriter.resolveHistorize(null, "action", "action")).toBe(false);
  });
});

// ============================================================
// Live energy accumulation
// ============================================================

const EQUIPMENT_ID = "meter-uuid";
const SOLAR_ID = "solar-uuid";
const ZONE_ID = "zone-uuid";
const BINDING_ID = "binding-uuid";
/** Minute-aligned epoch ms used as the base of every scenario. */
const T0_MS = 1714723200_000;

interface CapturedPoint {
  alias: string;
  value: number;
  timestamp: number | undefined;
}

class StubInfluxClient {
  written: CapturedPoint[] = [];
  /** Same order as `written` — kept apart so the point assertions stay terse. */
  equipmentIds: string[] = [];
  isConnected(): boolean {
    return true;
  }
  writePoint(point: Point): void {
    const tags = (point as unknown as { tags: Record<string, string> }).tags ?? {};
    const fields = (point as unknown as { fields: Record<string, string> }).fields ?? {};
    const ts = (point as unknown as { time?: string }).time;
    this.equipmentIds.push(tags.equipmentId);
    this.written.push({
      alias: tags.alias,
      value: parseFloat(fields.value_number ?? "0"),
      timestamp: ts !== undefined ? Number(ts) : undefined,
    });
  }
}

describe("HistoryWriter — live energy accumulation", () => {
  const logger = createLogger("silent").logger;
  let bus: EventBus;
  let influx: StubInfluxClient;
  let writer: HistoryWriter;

  function emitEnergy(value: number): void {
    bus.emit({
      type: "equipment.data.changed",
      equipmentId: EQUIPMENT_ID,
      alias: "energy",
      value,
      previous: null,
    } as never);
  }

  function energyPoints(): CapturedPoint[] {
    return influx.written.filter((p) => p.alias === "energy");
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_MS);

    bus = new EventBus(logger);
    influx = new StubInfluxClient();

    const equipmentManager = {
      getAll: () => [{ id: EQUIPMENT_ID, enabled: true, zoneId: ZONE_ID }],
      getDataBindingsWithValues: () => [
        { id: BINDING_ID, alias: "energy", category: "energy", type: "number", historize: null },
        { id: "power-binding", alias: "power", category: "power", type: "number", historize: null },
      ],
    } as unknown as EquipmentManager;

    writer = new HistoryWriter(
      {} as Database.Database,
      bus,
      { get: () => undefined } as unknown as SettingsManager,
      equipmentManager,
      influx as unknown as InfluxClient,
      logger,
    );
    writer.init();
  });

  afterEach(() => {
    writer.destroy();
    vi.useRealTimers();
  });

  it("sums the ticks of a minute into one aligned point", () => {
    // Ticks arrive well inside the 30s min-write interval that used to drop
    // them; every Wh must survive.
    emitEnergy(0);
    vi.setSystemTime(T0_MS + 10_000);
    emitEnergy(40);
    vi.setSystemTime(T0_MS + 20_000);
    emitEnergy(0);
    vi.setSystemTime(T0_MS + 30_000);
    emitEnergy(10);

    expect(energyPoints()).toHaveLength(0); // minute still open

    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets();

    expect(energyPoints()).toEqual([{ alias: "energy", value: 50, timestamp: T0_MS / 1000 }]);
  });

  it("closes the previous minute when a tick of the next one arrives", () => {
    emitEnergy(30);
    vi.setSystemTime(T0_MS + 70_000);
    emitEnergy(5);

    const points = energyPoints();
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ alias: "energy", value: 30, timestamp: T0_MS / 1000 });

    writer.destroy();
    expect(energyPoints()[1]).toEqual({
      alias: "energy",
      value: 5,
      timestamp: T0_MS / 1000 + 60,
    });
  });

  it("writes the HP/HC split on the same aligned timestamp", () => {
    emitEnergy(40);
    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets();

    const hp = influx.written.find((p) => p.alias === "energy_hp");
    const hc = influx.written.find((p) => p.alias === "energy_hc");
    // No tariff configured → everything lands in HP, at the minute start.
    expect(hp).toEqual({ alias: "energy_hp", value: 40, timestamp: T0_MS / 1000 });
    expect(hc?.timestamp).toBe(T0_MS / 1000);
  });

  it("keeps negative deltas (grid export) in the sum", () => {
    emitEnergy(20);
    vi.setSystemTime(T0_MS + 10_000);
    emitEnergy(-50);

    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets();

    expect(energyPoints()[0].value).toBe(-30);
  });

  it("leaves non-energy bindings on the immediate write path", () => {
    bus.emit({
      type: "equipment.data.changed",
      equipmentId: EQUIPMENT_ID,
      alias: "power",
      value: 1200,
      previous: null,
    } as never);

    // Power is a sample, not a delta: written straight away, unaligned.
    const power = influx.written.filter((p) => p.alias === "power");
    expect(power).toHaveLength(1);
    expect(power[0].timestamp).toBeUndefined();
  });
});

// ============================================================
// Grid energy ownership
// ============================================================

/**
 * With an energy_production_meter configured, the SelfConsumptionWriter owns
 * the grid meter's `energy` / `energy_hp` / `energy_hc` (household semantic)
 * and this writer must stay off those three series — two writers upserting
 * the same points on different flush triggers is a last-write-wins race.
 * Everything else on the grid meter still belongs here.
 */
describe("HistoryWriter — grid energy ownership", () => {
  const logger = createLogger("silent").logger;
  let bus: EventBus;
  let influx: StubInfluxClient;
  let writer: HistoryWriter;

  function start(opts: { withSolar: boolean }): void {
    const eqs = [
      { id: EQUIPMENT_ID, type: "main_energy_meter", enabled: true, zoneId: ZONE_ID },
      ...(opts.withSolar
        ? [{ id: SOLAR_ID, type: "energy_production_meter", enabled: true, zoneId: ZONE_ID }]
        : []),
    ];
    const equipmentManager = {
      getAll: () => eqs,
      getDataBindingsWithValues: (equipmentId: string) => [
        {
          id: `${equipmentId}:energy`,
          alias: "energy",
          category: "energy",
          type: "number",
          historize: null,
        },
        {
          id: `${equipmentId}:power`,
          alias: "power",
          category: "power",
          type: "number",
          historize: null,
        },
      ],
    } as unknown as EquipmentManager;

    writer = new HistoryWriter(
      {} as Database.Database,
      bus,
      { get: () => undefined } as unknown as SettingsManager,
      equipmentManager,
      influx as unknown as InfluxClient,
      logger,
    );
    writer.init();
  }

  function emit(equipmentId: string, alias: string, value: number, sourceTimestamp?: number): void {
    bus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias,
      value,
      previous: null,
      ...(sourceTimestamp !== undefined ? { sourceTimestamp } : {}),
    } as never);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_MS);
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
  });

  afterEach(() => {
    writer.destroy();
    vi.useRealTimers();
  });

  it("skips the grid meter's energy/hp/hc when a production meter is configured", () => {
    start({ withSolar: true });

    emit(EQUIPMENT_ID, "energy", 40);
    emit(EQUIPMENT_ID, "energy_hp", 24);
    emit(EQUIPMENT_ID, "energy_hc", 16);
    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets(true);

    expect(influx.written).toHaveLength(0);
  });

  it("skips them on the aligned sourceTimestamp path too", () => {
    start({ withSolar: true });

    emit(EQUIPMENT_ID, "energy", 40, T0_MS / 1000);

    expect(influx.written).toHaveLength(0);
  });

  it("still writes the grid meter's other bindings and the solar meter's energy", () => {
    start({ withSolar: true });

    emit(EQUIPMENT_ID, "power", 1200);
    emit(SOLAR_ID, "energy", 30);
    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets(true);

    expect(influx.written.map((p) => p.alias)).toEqual([
      "power",
      "energy",
      "energy_hp",
      "energy_hc",
    ]);
    expect(influx.equipmentIds).toEqual([EQUIPMENT_ID, SOLAR_ID, SOLAR_ID, SOLAR_ID]);
    expect(influx.written.find((p) => p.alias === "energy")?.value).toBe(30);
  });

  it("writes the grid energy itself with no production meter (solo grid)", () => {
    start({ withSolar: false });

    emit(EQUIPMENT_ID, "energy", 40);
    vi.setSystemTime(T0_MS + 60_000);
    writer.flushEnergyBuckets(true);

    const energy = influx.written.filter((p) => p.alias === "energy");
    expect(energy).toEqual([{ alias: "energy", value: 40, timestamp: T0_MS / 1000 }]);
  });
});

describe("HistoryWriter — enum state charting (#434)", () => {
  const logger = createLogger("silent").logger;
  let bus: EventBus;
  let influx: StubInfluxClient;
  let writer: HistoryWriter;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_MS);
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
    const equipmentManager = {
      getAll: () => [{ id: EQUIPMENT_ID, enabled: true, zoneId: ZONE_ID }],
      getDataBindingsWithValues: () => [
        {
          id: "pump-state",
          alias: "state",
          category: "light_state",
          type: "enum",
          enumValues: ["ON", "OFF"],
          historize: 1,
        },
      ],
    } as unknown as EquipmentManager;
    writer = new HistoryWriter(
      {} as Database.Database,
      bus,
      { get: () => undefined } as unknown as SettingsManager,
      equipmentManager,
      influx as unknown as InfluxClient,
      logger,
    );
    writer.init();
  });

  afterEach(() => {
    writer.destroy();
    vi.useRealTimers();
  });

  function emitState(value: string, previous: unknown): void {
    bus.emit({
      type: "equipment.data.changed",
      equipmentId: EQUIPMENT_ID,
      alias: "state",
      value,
      previous,
    } as never);
  }

  it("writes value_number for an enum ON/OFF state (previously value_string only → empty chart)", () => {
    emitState("ON", "OFF");
    emitState("OFF", "ON");
    const states = influx.written.filter((p) => p.alias === "state");
    expect(states.map((p) => p.value)).toEqual([1, 0]); // ON=1, OFF=0 → chartable step
  });
});

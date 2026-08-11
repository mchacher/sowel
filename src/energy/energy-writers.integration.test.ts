/**
 * HistoryWriter + SelfConsumptionWriter on one EventBus.
 *
 * These two used to share the grid meter's `energy` / `energy_hp` /
 * `energy_hc` series and rely on same-timestamp upsert plus subscription
 * order to agree. They now close their per-minute buckets on different
 * triggers (HistoryWriter per binding, SelfConsumptionWriter on the first
 * tick of the next minute from either role), so sharing a series would be a
 * last-write-wins race decided by which meter happens to tick first.
 *
 * The contract asserted here is single authority per series: with a
 * production meter configured, only the SelfConsumptionWriter writes the
 * grid energy series, whatever the interleaving.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import { HistoryWriter } from "../history/history-writer.js";
import { SelfConsumptionWriter } from "./self-consumption-writer.js";
import type { Point } from "../core/influx-client.js";
import type { InfluxClient } from "../core/influx-client.js";
import type { SettingsManager } from "../core/settings-manager.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";

const logger = createLogger("silent").logger;

const GRID_ID = "grid-uuid";
const SOLAR_ID = "solar-uuid";
const ZONE_ID = "zone-uuid";

/** Minute-aligned epoch ms used as the base of every scenario. */
const T0_MS = 1714723200_000;
const T0_S = T0_MS / 1000;

interface CapturedPoint {
  equipmentId: string;
  alias: string;
  value: number;
  timestamp: number | undefined;
}

class StubInfluxClient {
  written: CapturedPoint[] = [];
  isConnected(): boolean {
    return true;
  }
  writePoint(point: Point): void {
    const tags = (point as unknown as { tags: Record<string, string> }).tags ?? {};
    const fields = (point as unknown as { fields: Record<string, string> }).fields ?? {};
    const ts = (point as unknown as { time?: string }).time;
    this.written.push({
      equipmentId: tags.equipmentId,
      alias: tags.alias,
      value: parseFloat(fields.value_number ?? "0"),
      timestamp: ts !== undefined ? Number(ts) : undefined,
    });
  }
}

function makeEquipmentManager(opts: { withSolar: boolean }): EquipmentManager {
  const eqs = [{ id: GRID_ID, type: "main_energy_meter", enabled: true, zoneId: ZONE_ID }];
  if (opts.withSolar) {
    eqs.push({ id: SOLAR_ID, type: "energy_production_meter", enabled: true, zoneId: ZONE_ID });
  }
  return {
    getAll: () => eqs,
    getById: (id: string) => eqs.find((e) => e.id === id) ?? null,
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
}

describe("HistoryWriter + SelfConsumptionWriter — one authority per series", () => {
  let bus: EventBus;
  let influx: StubInfluxClient;
  let historyWriter: HistoryWriter;
  let selfConsumptionWriter: SelfConsumptionWriter | null;

  function start(opts: { withSolar: boolean }): void {
    const equipmentManager = makeEquipmentManager(opts);
    historyWriter = new HistoryWriter(
      {} as Database.Database,
      bus,
      { get: () => undefined } as unknown as SettingsManager,
      equipmentManager,
      influx as unknown as InfluxClient,
      logger,
    );
    // Production order: the HistoryWriter subscribes first (see index.ts).
    historyWriter.init();

    selfConsumptionWriter = new SelfConsumptionWriter(
      bus,
      equipmentManager,
      influx as unknown as InfluxClient,
      historyWriter.getTariffClassifier(),
      logger,
    );
    selfConsumptionWriter.init();
  }

  /** Emit a live energy delta (no sourceTimestamp — the chatty-meter path). */
  function emitEnergy(equipmentId: string, value: number): void {
    bus.emit({
      type: "equipment.data.changed",
      equipmentId,
      alias: "energy",
      value,
      previous: null,
    } as never);
  }

  function pointsFor(equipmentId: string, alias: string): CapturedPoint[] {
    return influx.written.filter((p) => p.equipmentId === equipmentId && p.alias === alias);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0_MS);
    bus = new EventBus(logger);
    influx = new StubInfluxClient();
    selfConsumptionWriter = null;
  });

  afterEach(() => {
    selfConsumptionWriter?.destroy();
    historyWriter.destroy();
    vi.useRealTimers();
  });

  // Household = max(0, gridΔ) + max(0, solarΔ - max(0, -gridΔ))
  const MINUTES = [
    { gridWh: -20, solarWh: 50, household: 30 }, // exporting: 20 injected, 30 self-consumed
    { gridWh: 15, solarWh: 5, household: 20 }, // importing: 15 from grid + 5 solar
    { gridWh: 8, solarWh: 0, household: 8 }, // night: pure import
  ];

  for (const firstOfMinute of ["solar", "grid"] as const) {
    it(`writes grid energy == household for every minute (${firstOfMinute} ticks first)`, () => {
      start({ withSolar: true });

      // Each minute's ticks are emitted in an order that puts `firstOfMinute`
      // first, so the writers see the two possible interleavings of the tick
      // that closes the previous minute.
      MINUTES.forEach((m, i) => {
        vi.setSystemTime(T0_MS + i * 60_000 + 5_000);
        if (firstOfMinute === "solar") {
          emitEnergy(SOLAR_ID, m.solarWh);
          vi.setSystemTime(T0_MS + i * 60_000 + 20_000);
          emitEnergy(GRID_ID, m.gridWh);
        } else {
          emitEnergy(GRID_ID, m.gridWh);
          vi.setSystemTime(T0_MS + i * 60_000 + 20_000);
          emitEnergy(SOLAR_ID, m.solarWh);
        }
      });

      vi.setSystemTime(T0_MS + MINUTES.length * 60_000);
      historyWriter.flushEnergyBuckets();
      selfConsumptionWriter!.flushPending();

      const gridEnergy = pointsFor(GRID_ID, "energy");
      expect(gridEnergy).toEqual(
        MINUTES.map((m, i) => ({
          equipmentId: GRID_ID,
          alias: "energy",
          value: m.household,
          timestamp: T0_S + i * 60,
        })),
      );

      // No tariff configured → the whole household lands in HP, once per minute.
      expect(pointsFor(GRID_ID, "energy_hp")).toEqual(
        MINUTES.map((m, i) => ({
          equipmentId: GRID_ID,
          alias: "energy_hp",
          value: m.household,
          timestamp: T0_S + i * 60,
        })),
      );
      expect(pointsFor(GRID_ID, "energy_hc").map((p) => p.value)).toEqual(MINUTES.map(() => 0));

      // The solar meter's own energy is still the HistoryWriter's job.
      expect(pointsFor(SOLAR_ID, "energy").map((p) => p.value)).toEqual(
        MINUTES.map((m) => m.solarWh),
      );
    });
  }

  it("keeps writing the grid energy itself when there is no production meter (solo grid)", () => {
    start({ withSolar: false });

    emitEnergy(GRID_ID, 12);
    vi.setSystemTime(T0_MS + 20_000);
    emitEnergy(GRID_ID, 8);

    vi.setSystemTime(T0_MS + 60_000);
    historyWriter.flushEnergyBuckets();
    selfConsumptionWriter!.flushPending();

    // Raw accumulated grid delta, HP/HC included — no household overlay.
    expect(pointsFor(GRID_ID, "energy")).toEqual([
      { equipmentId: GRID_ID, alias: "energy", value: 20, timestamp: T0_S },
    ]);
    expect(pointsFor(GRID_ID, "energy_hp").map((p) => p.value)).toEqual([20]);
    // The self-consumption writer stays inert without a production meter.
    expect(pointsFor(SOLAR_ID, "autoconso")).toHaveLength(0);
  });

  it("hands the grid series over when a production meter is added at runtime", () => {
    const eqs: Array<{ id: string; type: string; enabled: boolean; zoneId: string }> = [
      { id: GRID_ID, type: "main_energy_meter", enabled: true, zoneId: ZONE_ID },
    ];
    const equipmentManager = {
      getAll: () => eqs,
      getById: (id: string) => eqs.find((e) => e.id === id) ?? null,
      getDataBindingsWithValues: (equipmentId: string) => [
        {
          id: `${equipmentId}:energy`,
          alias: "energy",
          category: "energy",
          type: "number",
          historize: null,
        },
      ],
    } as unknown as EquipmentManager;

    historyWriter = new HistoryWriter(
      {} as Database.Database,
      bus,
      { get: () => undefined } as unknown as SettingsManager,
      equipmentManager,
      influx as unknown as InfluxClient,
      logger,
    );
    historyWriter.init();
    selfConsumptionWriter = new SelfConsumptionWriter(
      bus,
      equipmentManager,
      influx as unknown as InfluxClient,
      historyWriter.getTariffClassifier(),
      logger,
    );
    selfConsumptionWriter.init();

    emitEnergy(GRID_ID, 10);

    eqs.push({ id: SOLAR_ID, type: "energy_production_meter", enabled: true, zoneId: ZONE_ID });
    bus.emit({ type: "equipment.created", equipmentId: SOLAR_ID } as never);

    vi.setSystemTime(T0_MS + 60_000);
    historyWriter.flushEnergyBuckets();

    // The partial minute the HistoryWriter had open is dropped rather than
    // written on a series it no longer owns.
    expect(pointsFor(GRID_ID, "energy")).toHaveLength(0);

    vi.setSystemTime(T0_MS + 65_000);
    emitEnergy(GRID_ID, 4);
    emitEnergy(SOLAR_ID, 6);
    vi.setSystemTime(T0_MS + 120_000);
    historyWriter.flushEnergyBuckets();
    selfConsumptionWriter.flushPending();

    // The SelfConsumptionWriter, now the owner, covers both minutes: the one
    // the HistoryWriter dropped (10 Wh import, no solar yet) and the paired one.
    expect(pointsFor(GRID_ID, "energy")).toEqual([
      { equipmentId: GRID_ID, alias: "energy", value: 10, timestamp: T0_S },
      { equipmentId: GRID_ID, alias: "energy", value: 10, timestamp: T0_S + 60 },
    ]);
  });
});

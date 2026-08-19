import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EnergyAggregator } from "./energy-aggregator.js";
import { EventBus } from "../core/event-bus.js";
import { createLogger } from "../core/logger.js";
import type { EquipmentManager } from "../equipments/equipment-manager.js";
import type { InfluxClient } from "../core/influx-client.js";

const logger = createLogger("silent").logger;

// InfluxDB disconnected: refreshFromInfluxDB early-returns, so the seeded zero
// cumuls (#527) survive and we can assert them without a real InfluxDB.
function offlineInflux(): InfluxClient {
  return {
    getClient: vi.fn(() => null),
    getConfig: vi.fn(() => null),
  } as unknown as InfluxClient;
}

/**
 * Connected InfluxDB whose current-hour raw sum is driven by `hourWh()`. The
 * hour query reads the raw `bucket`; the day-prev / month / year queries read
 * the `-energy-hourly` / `-energy-daily` buckets and return nothing here, so
 * energy_day resolves to exactly the current-hour value. Lets a test flip the
 * live consumption and assert the cached cumul follows.
 */
function influxWithHour(hourWh: () => number): InfluxClient {
  const queryApi = {
    async *iterateRows(flux: string) {
      // Only the raw-bucket (current hour) query yields a value; the derived
      // buckets are addressed by their suffixed names.
      if (flux.includes("-energy-hourly") || flux.includes("-energy-daily")) return;
      const value = hourWh();
      yield {
        values: [],
        tableMeta: { toObject: () => ({ _value: value }) },
      } as never;
    },
  };
  return {
    getClient: vi.fn(() => ({ getQueryApi: () => queryApi })),
    getConfig: vi.fn(() => ({ org: "org", bucket: "sowel" })),
  } as unknown as InfluxClient;
}

const power = [{ alias: "power", category: "power", value: 0 }];
const energy = [{ alias: "energy", category: "energy", value: 100 }];
const state = [{ alias: "state", category: "light_state", value: "ON" }];

function managerWith(
  equipments: Array<{ id: string; type: string; dataBindings: unknown[] }>,
): EquipmentManager {
  return {
    getAllWithDetails: vi.fn(() => equipments),
    registerComputedDataProvider: vi.fn(),
    getDataBindingsWithValues: vi.fn((id: string) => {
      const eq = equipments.find((e) => e.id === id);
      return eq?.dataBindings ?? [];
    }),
  } as unknown as EquipmentManager;
}

describe("EnergyAggregator submeter enrolment (#527)", () => {
  let bus: EventBus;

  beforeEach(() => {
    // scheduleRefresh arms a real 5s setTimeout; fake timers keep it from leaking.
    vi.useFakeTimers();
    bus = new EventBus(logger);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("seeds zeroed cumuls for a power-only submeter so its meter UI renders before any consumption", async () => {
    const mgr = managerWith([
      { id: "wh", type: "water_heater", dataBindings: power },
      { id: "meter", type: "energy_meter", dataBindings: [] },
      { id: "lamp", type: "light_onoff", dataBindings: state },
    ]);
    const agg = new EnergyAggregator(mgr, offlineInflux(), bus, logger);
    await agg.start();

    // Metering water_heater: enrolled, cumuls exposed at 0.
    const wh = agg.getComputedDataForEquipment("wh");
    expect(wh.map((e) => e.alias).sort()).toEqual([
      "energy_day",
      "energy_hour",
      "energy_month",
      "energy_year",
    ]);
    expect(wh.every((e) => e.value === 0)).toBe(true);

    // Bare energy_meter still enrolled (declared meter shows 0 until data).
    expect(agg.getComputedDataForEquipment("meter")).toHaveLength(4);

    // A plain light is not an energy source: no cumuls.
    expect(agg.getComputedDataForEquipment("lamp")).toEqual([]);
  });

  it("keeps enrolling energy-binding equipments regardless of type", async () => {
    const mgr = managerWith([{ id: "solar", type: "solar_panel", dataBindings: energy }]);
    const agg = new EnergyAggregator(mgr, offlineInflux(), bus, logger);
    await agg.start();
    // solar_panel is not a submeter, but its energy binding still enrols it.
    expect(agg.getComputedDataForEquipment("solar")).toHaveLength(4);
  });

  it("enrolls a submeter created (and bound) after start, via equipment.updated", async () => {
    const equipments: Array<{ id: string; type: string; dataBindings: unknown[] }> = [];
    const mgr = managerWith(equipments);
    const agg = new EnergyAggregator(mgr, offlineInflux(), bus, logger);
    await agg.start();

    // Not enrolled yet.
    expect(agg.getComputedDataForEquipment("wh2")).toEqual([]);

    // User creates a water_heater then binds its power channel → equipment.updated.
    equipments.push({ id: "wh2", type: "water_heater", dataBindings: power });
    bus.emit({
      type: "equipment.updated",
      equipment: { id: "wh2", type: "water_heater" } as never,
    });

    const wh = agg.getComputedDataForEquipment("wh2");
    expect(wh).toHaveLength(4);
    expect(wh.every((e) => e.value === 0)).toBe(true);
  });

  it("recomputes an idle submeter's cumuls on the hour rollover, not just on energy events (#618)", async () => {
    // Start mid-morning so we know how long until the next hour boundary.
    vi.setSystemTime(new Date(2026, 7, 19, 8, 30, 0));
    const mgr = managerWith([{ id: "wh", type: "water_heater", dataBindings: power }]);

    // Yesterday's consumption is still the current cached value; the heater then
    // goes idle (0 W) and emits no further `energy` events.
    let hourWh = 2920;
    const agg = new EnergyAggregator(
      mgr,
      influxWithHour(() => hourWh),
      bus,
      logger,
    );
    await agg.start();

    expect(agg.getComputedDataForEquipment("wh").find((e) => e.alias === "energy_day")?.value).toBe(
      2920,
    );

    // Real consumption drops to zero. Without a scheduled rollover the cached
    // 2920 would keep being served all through the idle period.
    hourWh = 0;

    // Cross the next hour boundary (08:30 → 09:00 is 30 min away).
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1000);

    expect(agg.getComputedDataForEquipment("wh").find((e) => e.alias === "energy_day")?.value).toBe(
      0,
    );

    agg.stop();
  });

  it("rolls day/month/year cumuls over the local midnight boundary (#618)", async () => {
    // 23:45 local: the midnight tick must recompute against the new day.
    vi.setSystemTime(new Date(2026, 7, 19, 23, 45, 0));
    const mgr = managerWith([{ id: "wh", type: "water_heater", dataBindings: power }]);

    let hourWh = 2920;
    const agg = new EnergyAggregator(
      mgr,
      influxWithHour(() => hourWh),
      bus,
      logger,
    );
    await agg.start();
    expect(agg.getComputedDataForEquipment("wh").find((e) => e.alias === "energy_day")?.value).toBe(
      2920,
    );

    // New day starts idle.
    hourWh = 0;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 1000); // cross 00:00

    const cumuls = agg.getComputedDataForEquipment("wh");
    expect(cumuls.find((e) => e.alias === "energy_day")?.value).toBe(0);
    expect(cumuls.find((e) => e.alias === "energy_month")?.value).toBe(0);
    expect(cumuls.find((e) => e.alias === "energy_year")?.value).toBe(0);

    agg.stop();
  });

  it("stop() prevents a rollover refresh in flight from re-arming the timer (#618)", async () => {
    vi.setSystemTime(new Date(2026, 7, 19, 8, 30, 0));
    const mgr = managerWith([{ id: "wh", type: "water_heater", dataBindings: power }]);
    const agg = new EnergyAggregator(
      mgr,
      influxWithHour(() => 0),
      bus,
      logger,
    );
    await agg.start();

    agg.stop();
    // Advancing well past several hour boundaries must fire nothing: no timer
    // should have survived stop(). If one did, this would throw on the cleared
    // Influx client or leave a dangling timer that clearAllTimers would report.
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not enrol a bare relay (switch with no metering) on update", async () => {
    const equipments = [{ id: "relay", type: "switch", dataBindings: state }];
    const mgr = managerWith(equipments);
    const agg = new EnergyAggregator(mgr, offlineInflux(), bus, logger);
    await agg.start();

    bus.emit({
      type: "equipment.updated",
      equipment: { id: "relay", type: "switch" } as never,
    });
    expect(agg.getComputedDataForEquipment("relay")).toEqual([]);
  });
});

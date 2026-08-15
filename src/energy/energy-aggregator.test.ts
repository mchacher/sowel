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

import { describe, it, expect } from "vitest";
import { resolvePowerReading, isOutdated } from "./power-reading";
import type { DataBindingWithValue, EquipmentType, EquipmentWithDetails } from "../types";

// Issue #839 — a tile may only print a wattage it has reason to believe.
// The production case these are written against: a water heater drawing 560 W
// displayed as `0 W`, age 944 s, with the engine's own `stale` flag reading
// false because a water_heater is not a metering type.

const NOW = Date.parse("2026-08-31T12:00:00Z");

function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

function binding(over: Partial<DataBindingWithValue> = {}): DataBindingWithValue {
  return {
    id: "b1",
    equipmentId: "e1",
    deviceDataId: "d1",
    alias: "power",
    deviceId: "dev1",
    deviceName: "Clamp",
    key: "power",
    type: "number",
    category: "power",
    value: 560,
    unit: "W",
    lastUpdated: ago(5),
    lastChanged: ago(5),
    stale: false,
    ...over,
  } as DataBindingWithValue;
}

function equipment(
  type: EquipmentType,
  over: Partial<EquipmentWithDetails> = {},
): EquipmentWithDetails {
  return {
    id: "e1",
    name: "Chauffe-eau",
    zoneId: "z1",
    type,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

describe("resolvePowerReading", () => {
  it("passes a fresh reading through", () => {
    const r = resolvePowerReading(equipment("water_heater"), binding(), NOW);

    expect(r).toEqual({ watts: 560, verdict: "current", since: null });
  });

  it("withholds the #744 reading: a non-metering type whose stale flag says false", () => {
    // The exact production sample: 944 s old, value 0, engine stale = false.
    const r = resolvePowerReading(
      equipment("water_heater"),
      binding({ value: 0, lastUpdated: ago(944), stale: false }),
      NOW,
    );

    expect(r.verdict).toBe("stale");
    expect(r.watts).toBeNull();
    expect(r.since).toBe(ago(944));
    expect(isOutdated(r)).toBe(true);
  });

  it("keeps a slow-polling integration inside budget", () => {
    // SmartThings, Legrand, Panasonic and MCZ all poll on a 300 s default;
    // a 270 s reading is healthy and must not be flagged.
    const r = resolvePowerReading(
      equipment("water_heater"),
      binding({ lastUpdated: ago(270) }),
      NOW,
    );

    expect(r.verdict).toBe("current");
    expect(r.watts).toBe(560);
  });

  it("applies the tight meter window to a metering equipment", () => {
    const fresh = resolvePowerReading(
      equipment("energy_meter"),
      binding({ lastUpdated: ago(110) }),
      NOW,
    );
    const aged = resolvePowerReading(
      equipment("energy_meter"),
      binding({ lastUpdated: ago(130) }),
      NOW,
    );

    expect(fresh.verdict).toBe("current");
    expect(aged.verdict).toBe("stale");
  });

  it("gives demand_5min the slow budget, since it is a five-minute average", () => {
    // Under the meter's own two-minute window a healthy NLPC meter would read
    // outdated for most of every cycle. The quantity cannot be fresher than
    // the window it is averaged over.
    const r = resolvePowerReading(
      equipment("main_energy_meter"),
      binding({ alias: "demand_5min", category: "power", lastUpdated: ago(290) }),
      NOW,
    );

    expect(r.verdict).toBe("current");
    expect(r.watts).toBe(560);
  });

  it("still catches a demand_5min reading that is genuinely dead", () => {
    const r = resolvePowerReading(
      equipment("main_energy_meter"),
      binding({ alias: "demand_5min", lastUpdated: ago(124 * 24 * 3600) }),
      NOW,
    );

    expect(r.verdict).toBe("stale");
    expect(r.watts).toBeNull();
  });

  it("reports offline ahead of age, and dates nothing from it", () => {
    const r = resolvePowerReading(
      equipment("water_heater", { status: "offline" }),
      binding({ lastUpdated: ago(944) }),
      NOW,
    );

    expect(r.verdict).toBe("offline");
    expect(r.watts).toBeNull();
    expect(r.since).toBeNull();
  });

  it("reports missing when no binding is bound at all", () => {
    const r = resolvePowerReading(equipment("water_heater"), undefined, NOW);

    expect(r).toEqual({ watts: null, verdict: "missing", since: null });
  });

  it("treats an unparseable timestamp as no evidence of age", () => {
    const r = resolvePowerReading(
      equipment("water_heater"),
      binding({ lastUpdated: null }),
      NOW,
    );

    expect(r.verdict).toBe("current");
    expect(r.watts).toBe(560);
  });

  it("withholds a non-numeric value rather than rendering it", () => {
    const r = resolvePowerReading(
      equipment("water_heater"),
      binding({ value: "unavailable" }),
      NOW,
    );

    expect(r.verdict).toBe("missing");
    expect(r.watts).toBeNull();
  });
});

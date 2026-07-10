import { describe, expect, it } from "vitest";
import type {
  DataBindingWithValue,
  EquipmentStatus,
  EquipmentWithDetails,
} from "../../types";
import { pickSubmeterColor, SUBMETER_PALETTE } from "./submeterPalette";
import {
  buildSubmeterRows,
  computeOther,
  readSubmeterPower,
} from "./submeter-helpers";

function makeBinding(
  partial: Partial<DataBindingWithValue> & { alias: string },
): DataBindingWithValue {
  return {
    id: "b-" + partial.alias,
    equipmentId: "eq",
    deviceDataId: "dd",
    deviceId: "d1",
    deviceName: "Device",
    key: partial.alias,
    type: "number",
    category: "power",
    value: 0,
    lastUpdated: "2026-05-27 08:00:00Z",
    lastChanged: "2026-05-27 08:00:00Z",
    stale: false,
    ...partial,
  };
}

function makeEquipment(
  id: string,
  name: string,
  opts: {
    type?: EquipmentWithDetails["type"];
    status?: EquipmentStatus;
    power?: number | null;
    offlineSince?: string | null;
  } = {},
): EquipmentWithDetails {
  const bindings: DataBindingWithValue[] = [];
  if (opts.power !== undefined && opts.power !== null) {
    bindings.push(makeBinding({ alias: "power", value: opts.power }));
  }
  return {
    id,
    name,
    zoneId: "z",
    type: opts.type ?? "energy_meter",
    enabled: true,
    createdAt: "2026-05-01 00:00:00Z",
    updatedAt: "2026-05-01 00:00:00Z",
    dataBindings: bindings,
    orderBindings: [],
    status: opts.status ?? "online",
    statusReason:
      opts.status && opts.status !== "online"
        ? {
            offlineDevices: [],
            staleBindings: [],
            offlineSince: opts.offlineSince ?? null,
          }
        : undefined,
  };
}

describe("pickSubmeterColor", () => {
  it("returns the palette color at the given index", () => {
    expect(pickSubmeterColor(0)).toBe(SUBMETER_PALETTE[0]);
    expect(pickSubmeterColor(5)).toBe(SUBMETER_PALETTE[5]);
    expect(pickSubmeterColor(7)).toBe(SUBMETER_PALETTE[7]);
  });

  it("wraps modulo the palette length", () => {
    expect(pickSubmeterColor(8)).toBe(SUBMETER_PALETTE[0]);
    expect(pickSubmeterColor(17)).toBe(SUBMETER_PALETTE[1]);
  });
});

describe("readSubmeterPower", () => {
  it("returns the power binding value for an online equipment", () => {
    const eq = makeEquipment("a", "PAC", { power: 1200 });
    expect(readSubmeterPower(eq)).toBe(1200);
  });

  it("returns the absolute value when power is negative (clamp wired backwards)", () => {
    const eq = makeEquipment("a", "PAC", { power: -50 });
    expect(readSubmeterPower(eq)).toBe(50);
  });

  it("returns null when no power binding exists", () => {
    const eq = makeEquipment("a", "PAC", { power: null });
    expect(readSubmeterPower(eq)).toBeNull();
  });

  it("returns null when the equipment is offline, even with a power binding", () => {
    const eq = makeEquipment("a", "PAC", { power: 500, status: "offline" });
    expect(readSubmeterPower(eq)).toBeNull();
  });

  it("returns the power for a degraded equipment (stale value still counts)", () => {
    const eq = makeEquipment("a", "Piscine", { power: 800, status: "degraded" });
    expect(readSubmeterPower(eq)).toBe(800);
  });
});

describe("buildSubmeterRows", () => {
  it("filters main/production meters out", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Shelly Grid", { type: "main_energy_meter", power: 200 }),
      makeEquipment("c", "Shelly Solar", { type: "energy_production_meter", power: 300 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["PAC"]);
  });

  it("includes metering switches, excludes bare relays (spec 129)", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 100 }),
      makeEquipment("b", "Prise Bureau", { type: "switch", power: 40 }),
      makeEquipment("c", "Relais nu", { type: "switch", power: null }),
    ]);
    // PAC (100) + metering switch (40), sorted by power desc; bare relay excluded.
    expect(rows.map((r) => r.name)).toEqual(["PAC", "Prise Bureau"]);
  });

  it("assigns colors by sorted-id index (stable across power reorders)", () => {
    const a = makeEquipment("aaa-id", "Z-last", { power: 100 });
    const b = makeEquipment("bbb-id", "A-first", { power: 9999 });
    const rows = buildSubmeterRows([b, a]);
    const rowA = rows.find((r) => r.id === "aaa-id");
    const rowB = rows.find((r) => r.id === "bbb-id");
    expect(rowA?.color).toBe(SUBMETER_PALETTE[0]);
    expect(rowB?.color).toBe(SUBMETER_PALETTE[1]);
  });

  it("sorts rows by power descending for display", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "Low", { power: 50 }),
      makeEquipment("b", "High", { power: 2000 }),
      makeEquipment("c", "Mid", { power: 500 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("places null-power rows last (offline / no data)", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "Online1", { power: 100 }),
      makeEquipment("b", "OfflineOne", { power: 500, status: "offline" }),
      makeEquipment("c", "Online2", { power: 50 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Online1", "Online2", "OfflineOne"]);
    expect(rows[2].power).toBeNull();
  });

  it("wraps palette when more than 8 submeters", () => {
    const inputs = Array.from({ length: 9 }, (_, i) =>
      makeEquipment(`id-${i}`, `S${i}`, { power: 100 - i }),
    );
    const rows = buildSubmeterRows(inputs);
    const ninth = rows.find((r) => r.id === "id-8");
    expect(ninth?.color).toBe(SUBMETER_PALETTE[0]);
  });

  it("returns an empty array when no submeters exist", () => {
    expect(buildSubmeterRows([])).toEqual([]);
  });
});

describe("computeOther", () => {
  it("returns house minus the sum of submeter powers", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 1200 }),
      makeEquipment("b", "Pool", { power: 800 }),
      makeEquipment("c", "EV", { power: 570 }),
    ]);
    expect(computeOther(3200, rows)).toBe(630);
  });

  it("clamps to 0 when the submeters overshoot the house total", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 2000 }),
      makeEquipment("b", "Pool", { power: 1500 }),
    ]);
    expect(computeOther(3200, rows)).toBe(0);
  });

  it("returns 0 when house and submeters are both empty", () => {
    expect(computeOther(0, [])).toBe(0);
  });

  it("returns 0 when submeter sum equals the house value", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 1000 }),
    ]);
    expect(computeOther(1000, rows)).toBe(0);
  });

  it("ignores null-power rows in the sum", () => {
    const rows = buildSubmeterRows([
      makeEquipment("a", "PAC", { power: 1200 }),
      makeEquipment("b", "Pool", { power: null, status: "offline" }),
    ]);
    expect(computeOther(2000, rows)).toBe(800);
  });
});

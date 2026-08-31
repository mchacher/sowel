import { describe, it, expect } from "vitest";
import { render, screen } from "../../test-utils";
import { ElectricalMeteringPanel } from "./ElectricalMeteringPanel";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";

// Issue #839 — freshness is a property of the reading GROUP. These four
// measures come off one meter through one radio, so the silence that aged the
// power aged the volts and amps beside it. Dashing the power alone would leave
// `231.0 V / 5.40 A / 0.98` drawn at full strength on the strength of a reading
// the panel just refused.

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function binding(
  over: Partial<DataBindingWithValue> & { alias: string },
): DataBindingWithValue {
  return {
    id: `b-${over.alias}`,
    equipmentId: "em-1",
    deviceDataId: `d-${over.alias}`,
    deviceId: "dev-1",
    deviceName: "Meter",
    key: over.alias,
    type: "number",
    category: over.alias,
    unit: "",
    lastUpdated: agoIso(10),
    lastChanged: agoIso(10),
    stale: false,
    ...over,
  } as DataBindingWithValue;
}

function meter(age: number, over: Partial<EquipmentWithDetails> = {}): EquipmentWithDetails {
  return {
    id: "em-1",
    name: "Compteur",
    zoneId: "z-1",
    type: "energy_meter",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings: [
      binding({ alias: "power", value: 1240, lastUpdated: agoIso(age) }),
      binding({ alias: "voltage", value: 231, lastUpdated: agoIso(age) }),
      binding({ alias: "current", value: 5.4, lastUpdated: agoIso(age) }),
    ],
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

describe("ElectricalMeteringPanel — stale readings (#839)", () => {
  it("draws every measure while the group is current", () => {
    render(<ElectricalMeteringPanel equipment={meter(10)} />);

    expect(screen.getByText("1.2")).toBeTruthy();
    expect(screen.getByText("231.0")).toBeTruthy();
    expect(screen.getByText("5.40")).toBeTruthy();
  });

  it("blanks the whole group once the power reading has aged", () => {
    render(<ElectricalMeteringPanel equipment={meter(940)} />);

    expect(screen.queryByText("1.2")).toBeNull();
    expect(screen.queryByText("231.0")).toBeNull();
    expect(screen.queryByText("5.40")).toBeNull();
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.getAllByText(/reading outdated/).length).toBe(3);
  });

  it("spares a measure that comes from a different device", () => {
    // A meter fed by two devices only blanks the half that went quiet.
    const eq = meter(940);
    eq.dataBindings[1] = binding({
      alias: "voltage",
      value: 231,
      lastUpdated: agoIso(10),
      deviceId: "dev-2",
    });

    render(<ElectricalMeteringPanel equipment={eq} />);

    expect(screen.getByText("231.0")).toBeTruthy();
    expect(screen.queryByText("5.40")).toBeNull();
  });
});

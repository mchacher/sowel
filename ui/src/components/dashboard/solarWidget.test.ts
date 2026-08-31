import { describe, it, expect } from "vitest";
import { solarWidgetState } from "./solarWidget";
import type { DataBindingWithValue, EquipmentWithDetails } from "../../types";

// Issue #839 — the solar tile's freshness is a property of the reading GROUP.
// Power, current and voltage come from one inverter, so a stale wattage means
// the amps and volts beside it are stale too. Withholding only the wattage
// would leave `— · 5.4 A · 231.0 V`, presenting two figures as live on the
// strength of a reading just refused. And a tile that merely goes quiet is
// indistinguishable from "standby", which means night.

const NOW = Date.parse("2026-08-31T12:00:00Z");
const t = (key: string) => (key === "solar.standby" ? "Standby" : key);

function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

function binding(
  category: string,
  value: unknown,
  lastUpdated: string = ago(5),
): DataBindingWithValue {
  return {
    id: `b-${category}`,
    equipmentId: "e1",
    deviceDataId: `d-${category}`,
    alias: category,
    deviceId: "inv-1",
    deviceName: "Inverter",
    key: category,
    type: "number",
    category,
    value,
    lastUpdated,
    lastChanged: lastUpdated,
    stale: false,
  } as DataBindingWithValue;
}

function panel(
  dataBindings: DataBindingWithValue[],
  over: Partial<EquipmentWithDetails> = {},
): EquipmentWithDetails {
  return {
    id: "e1",
    name: "Panneaux sud",
    zoneId: "z1",
    type: "solar_panel",
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    status: "online",
    dataBindings,
    orderBindings: [],
    ...over,
  } as EquipmentWithDetails;
}

describe("solarWidgetState", () => {
  it("renders power, current and voltage while producing", () => {
    const state = solarWidgetState(
      panel([
        binding("power", 1240),
        binding("current", 5.4),
        binding("voltage", 231),
      ]),
      t,
      NOW,
    );

    expect(state).toEqual({
      producing: true,
      lines: ["1.24 kW", "5.4 A", "231.0 V"],
      outdatedSince: null,
    });
  });

  it("drops the whole line when the reading is past budget, not just the wattage", () => {
    const state = solarWidgetState(
      panel([
        binding("power", 1240, ago(940)),
        binding("current", 5.4, ago(940)),
        binding("voltage", 231, ago(940)),
      ]),
      t,
      NOW,
    );

    expect(state.lines).toEqual(["—"]);
    expect(state.lines.join(" ")).not.toMatch(/A|V/);
    expect(state.outdatedSince).toBe(ago(940));
    expect(state.producing).toBe(false);
  });

  it("separates an outdated tile from a panel that is simply not producing", () => {
    const night = solarWidgetState(panel([binding("power", 0)]), t, NOW);
    const dead = solarWidgetState(panel([binding("power", 1240, ago(940))]), t, NOW);

    expect(night.lines).toEqual(["Standby"]);
    expect(night.outdatedSince).toBeNull();
    expect(dead.lines).not.toEqual(["Standby"]);
    expect(dead.outdatedSince).not.toBeNull();
  });

  it("still reports standby for an offline panel rather than an age", () => {
    const state = solarWidgetState(
      panel([binding("power", 1240, ago(940))], { status: "offline" }),
      t,
      NOW,
    );

    expect(state.lines).toEqual(["Standby"]);
    expect(state.outdatedSince).toBeNull();
  });

  it("reports standby when no power channel is bound at all", () => {
    const state = solarWidgetState(panel([binding("voltage", 231)]), t, NOW);

    expect(state.lines).toEqual(["Standby"]);
    expect(state.outdatedSince).toBeNull();
  });
});

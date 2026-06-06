import { describe, it, expect } from "vitest";
import { freeCandidates, buildBoundDataKeysByDevice } from "./binding-utils";
import type { BindingCandidate } from "./binding-candidates";
import type { EquipmentWithDetails } from "../types";

/** Two PV channel candidates sharing `inverter_temp` (spec 125 shape). */
const SOLAR: BindingCandidate[] = [
  {
    id: "ch1",
    label: "Panel 1",
    dataKeys: ["ch1_voltage", "ch1_current", "ch1_power", "ch1_energy", "inverter_temp"],
    orderKeys: [],
  },
  {
    id: "ch2",
    label: "Panel 2",
    dataKeys: ["ch2_voltage", "ch2_current", "ch2_power", "ch2_energy", "inverter_temp"],
    orderKeys: [],
  },
];

describe("freeCandidates", () => {
  it("nothing bound → both channels free", () => {
    expect(freeCandidates(SOLAR, undefined, undefined).map((c) => c.id)).toEqual(["ch1", "ch2"]);
  });

  it("channel 1 taken → only channel 2 offered (shared inverter_temp ignored)", () => {
    const bound = new Set(["ch1_voltage", "ch1_current", "ch1_power", "ch1_energy", "inverter_temp"]);
    const free = freeCandidates(SOLAR, undefined, bound);
    expect(free.map((c) => c.id)).toEqual(["ch2"]);
  });

  it("both channels taken → none offered", () => {
    const bound = new Set([
      "ch1_voltage", "ch1_current", "ch1_power", "ch1_energy",
      "ch2_voltage", "ch2_current", "ch2_power", "ch2_energy",
      "inverter_temp",
    ]);
    expect(freeCandidates(SOLAR, undefined, bound)).toHaveLength(0);
  });

  it("shared inverter_temp bound alone does NOT consume a channel", () => {
    const bound = new Set(["inverter_temp"]);
    expect(freeCandidates(SOLAR, undefined, bound).map((c) => c.id)).toEqual(["ch1", "ch2"]);
  });

  it("order-based candidates: dropped only when all their order keys are bound", () => {
    const relays: BindingCandidate[] = [
      { id: "R1", label: "R1", dataKeys: ["R1"], orderKeys: ["R1"] },
      { id: "R2", label: "R2", dataKeys: ["R2"], orderKeys: ["R2"] },
    ];
    const free = freeCandidates(relays, new Set(["R1"]), undefined);
    expect(free.map((c) => c.id)).toEqual(["R2"]);
  });
});

describe("buildBoundDataKeysByDevice", () => {
  it("collects bound data keys per device across equipments", () => {
    const equipments = [
      {
        dataBindings: [
          { deviceId: "inv", key: "ch1_power" },
          { deviceId: "inv", key: "inverter_temp" },
        ],
      },
    ] as unknown as EquipmentWithDetails[];
    const map = buildBoundDataKeysByDevice(equipments);
    expect([...map.inv].sort()).toEqual(["ch1_power", "inverter_temp"]);
  });
});

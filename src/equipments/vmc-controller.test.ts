import { describe, it, expect } from "vitest";
import {
  normalizeVmcSpeed,
  planSpeedTransition,
  deriveVmcSpeed,
  VmcHighSpeedUnavailableError,
  VmcSpeedTracker,
  type VmcRelayStep,
} from "./vmc-controller.js";

describe("normalizeVmcSpeed", () => {
  it("accepts canonical off/v1/v2 case-insensitively", () => {
    expect(normalizeVmcSpeed("off")).toBe("off");
    expect(normalizeVmcSpeed("V1")).toBe("v1");
    expect(normalizeVmcSpeed("v2")).toBe("v2");
  });

  it("accepts on/off, low/high and numeric forms", () => {
    expect(normalizeVmcSpeed("on")).toBe("v1");
    expect(normalizeVmcSpeed("low")).toBe("v1");
    expect(normalizeVmcSpeed("high")).toBe("v2");
    expect(normalizeVmcSpeed(false)).toBe("off");
    expect(normalizeVmcSpeed(true)).toBe("v1");
    expect(normalizeVmcSpeed(2)).toBe("v2");
    expect(normalizeVmcSpeed("2")).toBe("v2");
  });

  it("returns null for anything unknown", () => {
    expect(normalizeVmcSpeed("turbo")).toBeNull();
    expect(normalizeVmcSpeed(null)).toBeNull();
    expect(normalizeVmcSpeed({})).toBeNull();
  });
});

/** The safety invariant: no prefix of the steps commands both relays on. */
function neverBothOn(steps: VmcRelayStep[]): boolean {
  const state = { low: false, high: false };
  for (const s of steps) {
    state[s.relay] = s.value;
    if (state.low && state.high) return false;
  }
  return true;
}

describe("planSpeedTransition", () => {
  it("OFF turns both relays off (never both on)", () => {
    const steps = planSpeedTransition("off", true);
    expect(steps).toEqual([
      { relay: "high", value: false },
      { relay: "low", value: false },
    ]);
    expect(neverBothOn(steps)).toBe(true);
  });

  it("V1 breaks high before making low", () => {
    const steps = planSpeedTransition("v1", true);
    expect(steps).toEqual([
      { relay: "high", value: false },
      { relay: "low", value: true },
    ]);
    // high off precedes low on
    expect(steps[0]).toEqual({ relay: "high", value: false });
    expect(neverBothOn(steps)).toBe(true);
  });

  it("V2 breaks low before making high", () => {
    const steps = planSpeedTransition("v2", true);
    expect(steps).toEqual([
      { relay: "low", value: false },
      { relay: "high", value: true },
    ]);
    expect(steps[0]).toEqual({ relay: "low", value: false });
    expect(neverBothOn(steps)).toBe(true);
  });

  it("rejects V2 when there is no high relay", () => {
    expect(() => planSpeedTransition("v2", false)).toThrow(VmcHighSpeedUnavailableError);
  });

  it("single-speed: OFF/V1 touch only the low relay", () => {
    expect(planSpeedTransition("off", false)).toEqual([{ relay: "low", value: false }]);
    expect(planSpeedTransition("v1", false)).toEqual([{ relay: "low", value: true }]);
  });

  it("never leaves both relays on for any reachable target", () => {
    for (const target of ["off", "v1", "v2"] as const) {
      expect(neverBothOn(planSpeedTransition(target, true))).toBe(true);
    }
  });
});

describe("deriveVmcSpeed", () => {
  it("maps observed relay states to a speed", () => {
    expect(deriveVmcSpeed(false, false)).toEqual({ speed: "off", bothOn: false });
    expect(deriveVmcSpeed(true, false)).toEqual({ speed: "v1", bothOn: false });
    expect(deriveVmcSpeed(false, true)).toEqual({ speed: "v2", bothOn: false });
  });

  it("flags both-on as an out-of-spec V2", () => {
    expect(deriveVmcSpeed(true, true)).toEqual({ speed: "v2", bothOn: true });
  });

  it("returns null when no relay reports state", () => {
    expect(deriveVmcSpeed(null, null)).toBeNull();
  });

  it("treats a single reporting relay as feedback", () => {
    expect(deriveVmcSpeed(true, null)).toEqual({ speed: "v1", bothOn: false });
    expect(deriveVmcSpeed(null, true)).toEqual({ speed: "v2", bothOn: false });
  });
});

describe("VmcSpeedTracker", () => {
  const makeDeps = (
    type: string,
    bindings: { alias: string; value: unknown }[],
    warns: unknown[] = [],
  ) => ({
    getById: () => ({ type }),
    getDataBindingsWithValues: () => bindings as never,
    logger: { warn: (obj: Record<string, unknown>) => warns.push(obj) },
  });

  it("computes speed from low/high state bindings", () => {
    const tracker = new VmcSpeedTracker(
      makeDeps("vmc", [
        { alias: "low", value: true },
        { alias: "high", value: false },
      ]),
    );
    expect(tracker.getComputedDataForEquipment("e1")).toEqual([
      { alias: "speed", value: "v1", lastUpdated: null },
    ]);
  });

  it("returns nothing for a non-vmc equipment", () => {
    const tracker = new VmcSpeedTracker(makeDeps("switch", [{ alias: "low", value: true }]));
    expect(tracker.getComputedDataForEquipment("e1")).toEqual([]);
  });

  it("returns nothing when there is no relay state feedback", () => {
    const tracker = new VmcSpeedTracker(makeDeps("vmc", []));
    expect(tracker.getComputedDataForEquipment("e1")).toEqual([]);
  });

  it("warns and reports v2 when both relays are on", () => {
    const warns: unknown[] = [];
    const tracker = new VmcSpeedTracker(
      makeDeps(
        "vmc",
        [
          { alias: "low", value: "ON" },
          { alias: "high", value: "ON" },
        ],
        warns,
      ),
    );
    expect(tracker.getComputedDataForEquipment("e1")).toEqual([
      { alias: "speed", value: "v2", lastUpdated: null },
    ]);
    expect(warns).toHaveLength(1);
  });
});

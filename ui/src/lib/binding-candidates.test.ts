import { describe, it, expect } from "vitest";
import { computeBindingCandidates } from "./binding-candidates";
import type { DeviceData, DeviceOrder } from "../types";

function order(key: string, extra: Partial<DeviceOrder> = {}): DeviceOrder {
  return { id: key, deviceId: "DEV", key, type: "boolean", ...extra };
}
function data(key: string, extra: Partial<DeviceData> = {}): DeviceData {
  return {
    id: key,
    deviceId: "DEV",
    key,
    type: "number",
    category: "generic",
    value: null,
    lastUpdated: null,
    ...extra,
  };
}

// SONOFF S60ZBTPF: single on/off `state` (light_toggle) + power/energy metering.
describe("computeBindingCandidates — metering switch (spec 129)", () => {
  it("binds on/off + power/energy/voltage/current on a metering plug", () => {
    const orders = [
      order("state", { category: "light_toggle" }),
      order("max_power", { category: undefined }), // config order, ignored
    ];
    const datas = [
      data("state", { type: "boolean", category: "light_state", value: "ON" }),
      data("power", { category: "power", value: 42 }),
      data("energy", { category: "energy", value: 1.5 }),
      data("voltage", { category: "voltage", value: 238 }),
      data("current", { category: "current", value: 0.2 }),
      data("energy_today", { category: "generic", value: 0.3 }), // not a metering category
      data("linkquality", { category: "generic", value: 120 }),
    ];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].orderKeys).toEqual(["state"]);
    expect(result[0].dataKeys.sort()).toEqual(["current", "energy", "power", "state", "voltage"]);
  });

  it("bare relay (state only) → no metering attached", () => {
    const orders = [order("state", { category: "light_toggle" })];
    const datas = [data("state", { type: "boolean", category: "light_state", value: "OFF" })];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result[0].dataKeys).toEqual(["state"]);
  });

  it("multi-gang (2 channels) → metering NOT auto-attached", () => {
    const orders = [
      order("state_left", { category: "light_toggle" }),
      order("state_right", { category: "light_toggle" }),
    ];
    const datas = [
      data("state_left", { type: "boolean", category: "light_state" }),
      data("state_right", { type: "boolean", category: "light_state" }),
      data("power", { category: "power", value: 10 }),
    ];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(2);
    expect(result.flatMap((c) => c.dataKeys)).not.toContain("power");
  });
});

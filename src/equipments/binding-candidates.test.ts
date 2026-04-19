import { describe, it, expect } from "vitest";
import {
  computeBindingCandidates,
  hasFreeCandidates,
  inferBindingCategory,
} from "./binding-candidates.js";
import type { DeviceData, DeviceOrder } from "../shared/types.js";

function order(
  key: string,
  type: DeviceOrder["type"],
  extra: Partial<DeviceOrder> = {},
): DeviceOrder {
  return {
    id: key,
    deviceId: "DEV",
    key,
    type,
    ...extra,
  };
}

function data(key: string, type: DeviceData["type"], extra: Partial<DeviceData> = {}): DeviceData {
  return {
    id: key,
    deviceId: "DEV",
    key,
    type,
    category: "generic",
    value: null,
    lastUpdated: null,
    ...extra,
  };
}

describe("computeBindingCandidates", () => {
  it("pool_pump on a 4-relay enum device → one candidate per relay", () => {
    const orders = [
      order("R1", "enum", { enumValues: ["ON", "OFF"] }),
      order("R2", "enum", { enumValues: ["ON", "OFF"] }),
      order("R3", "enum", { enumValues: ["ON", "OFF"] }),
      order("R4", "enum", { enumValues: ["ON", "OFF"] }),
    ];
    const datas = orders.map((o) => data(o.key, "enum"));
    const result = computeBindingCandidates("pool_pump", datas, orders);
    expect(result).toHaveLength(4);
    expect(result.map((c) => c.id)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(result[0].orderKeys).toEqual(["R1"]);
    expect(result[0].dataKeys).toEqual(["R1"]);
  });

  it("pool_cover with shutter_state + shutter_position → one candidate", () => {
    const orders = [
      order("shutter_state", "enum", { enumValues: ["OPEN", "CLOSE", "STOP"] }),
      order("shutter_position", "number", { min: 0, max: 100 }),
    ];
    const datas = [data("shutter_state", "enum"), data("shutter_position", "number")];
    const result = computeBindingCandidates("pool_cover", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("shutter1");
    expect(result[0].orderKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
    expect(result[0].dataKeys.sort()).toEqual(["shutter_position", "shutter_state"]);
  });

  it("switch on a single-relay device → one candidate", () => {
    const orders = [order("R1", "enum", { enumValues: ["ON", "OFF"] })];
    const datas = [data("R1", "enum")];
    const result = computeBindingCandidates("switch", datas, orders);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("R1");
  });

  it("sensor on a multi-data device → one all-data candidate", () => {
    const datas = [
      data("temperature", "number", { category: "temperature" }),
      data("humidity", "number", { category: "humidity" }),
      data("pressure", "number", { category: "pressure" }),
    ];
    const result = computeBindingCandidates("sensor", datas, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("all");
    expect(result[0].dataKeys).toEqual(["temperature", "humidity", "pressure"]);
    expect(result[0].orderKeys).toEqual([]);
  });
});

describe("hasFreeCandidates", () => {
  const orders = [
    order("R1", "enum", { enumValues: ["ON", "OFF"] }),
    order("R2", "enum", { enumValues: ["ON", "OFF"] }),
    order("R3", "enum", { enumValues: ["ON", "OFF"] }),
    order("R4", "enum", { enumValues: ["ON", "OFF"] }),
  ];
  const datas = orders.map((o) => data(o.key, "enum"));

  it("returns true when nothing is bound", () => {
    expect(hasFreeCandidates("pool_pump", datas, orders, new Set())).toBe(true);
  });

  it("returns true when only some candidates are bound", () => {
    const bound = new Set<string>(["R1", "R2"]);
    expect(hasFreeCandidates("pool_pump", datas, orders, bound)).toBe(true);
  });

  it("returns false when every candidate is bound", () => {
    const bound = new Set<string>(["R1", "R2", "R3", "R4"]);
    expect(hasFreeCandidates("pool_pump", datas, orders, bound)).toBe(false);
  });
});

describe("inferBindingCategory", () => {
  it("pool_pump + enum [ON,OFF] → pool_pump_toggle", () => {
    expect(inferBindingCategory("pool_pump", { type: "enum", enumValues: ["ON", "OFF"] })).toBe(
      "pool_pump_toggle",
    );
  });

  it("pool_cover + enum [OPEN,CLOSE,STOP] → pool_cover_move", () => {
    expect(
      inferBindingCategory("pool_cover", {
        type: "enum",
        enumValues: ["OPEN", "CLOSE", "STOP"],
      }),
    ).toBe("pool_cover_move");
  });

  it("pool_cover + number → pool_cover_position", () => {
    expect(inferBindingCategory("pool_cover", { type: "number", min: 0, max: 100 })).toBe(
      "pool_cover_position",
    );
  });

  it("switch + enum [ON,OFF] → null (no override)", () => {
    expect(inferBindingCategory("switch", { type: "enum", enumValues: ["ON", "OFF"] })).toBe(null);
  });
});

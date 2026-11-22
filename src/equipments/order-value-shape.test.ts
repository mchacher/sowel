import { describe, it, expect } from "vitest";
import { orderValueShapeError } from "./order-value-shape.js";

const state = [{ key: "state", type: "boolean" }];

describe("orderValueShapeError (issue #1310)", () => {
  it("accepts every primitive and the empty values", () => {
    for (const v of ["ON", "OFF", true, false, 0, 42.5, "", null, undefined]) {
      expect(orderValueShapeError(state, v), String(v)).toBeNull();
    }
  });

  it("accepts the timed composite on the order's own key", () => {
    expect(orderValueShapeError(state, { state: "ON", on_time: 600 })).toBeNull();
    expect(orderValueShapeError(state, { state: "ON" })).toBeNull();
    expect(orderValueShapeError(state, { state: "ON", on_time: 60, off_wait_time: 0 })).toBeNull();
  });

  it("refuses device attributes smuggled as an object", () => {
    expect(orderValueShapeError(state, { overload_protection: 0 })).toMatch(/needs 'state'/);
    expect(orderValueShapeError(state, { state: "ON", child_lock: "LOCK" })).toMatch(
      /unexpected field 'child_lock'/,
    );
  });

  it("refuses a nested or malformed timed composite", () => {
    expect(orderValueShapeError(state, { state: { x: 1 } })).not.toBeNull();
    expect(orderValueShapeError(state, { state: "ON", on_time: "600" })).toMatch(/seconds/);
    expect(orderValueShapeError(state, { state: "ON", on_time: -1 })).toMatch(/seconds/);
    expect(orderValueShapeError(state, { state: "ON", on_time: Infinity })).toMatch(/seconds/);
  });

  it("refuses arrays and non-plain objects", () => {
    expect(orderValueShapeError(state, ["ON"])).not.toBeNull();
    expect(orderValueShapeError(state, new Date())).not.toBeNull();
  });

  it("does not let a prototype key through", () => {
    const v = JSON.parse('{"state":"ON","__proto__":{"admin":true}}') as unknown;
    expect(orderValueShapeError(state, v)).toMatch(/unexpected field '__proto__'/);
  });

  it("leaves json orders free to take an object", () => {
    expect(orderValueShapeError([{ key: "color", type: "json" }], { x: 0.3, y: 0.4 })).toBeNull();
  });

  it("checks every binding of the alias: the key must match each of them", () => {
    const two = [
      { key: "state_l1", type: "enum" },
      { key: "state_l2", type: "enum" },
    ];
    expect(orderValueShapeError(two, "ON")).toBeNull();
    expect(orderValueShapeError(two, { state_l1: "ON", on_time: 5 })).toMatch(/needs 'state_l2'/);
  });
});

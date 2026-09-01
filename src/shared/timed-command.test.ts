import { describe, it, expect } from "vitest";
import { isTimedCommandEligible } from "./timed-command.js";

/**
 * Spec 174 FR-11. The half worth testing is the state reading: without one,
 * a hand-revert can never disarm the window, so the deadline acts on an
 * equipment that has moved since — on a sequential impulse, by re-opening it.
 */
function equipment(orders: string[], readings: { alias?: string; category?: string }[]) {
  return {
    orderBindings: orders.map((alias) => ({ alias })),
    dataBindings: readings,
  };
}

describe("isTimedCommandEligible (spec 174 FR-11)", () => {
  it("accepts an impulse gate: the command, and the contact that reads it", () => {
    const gate = equipment(["command"], [{ alias: "state", category: "gate_state" }]);
    expect(isTimedCommandEligible(gate, "command")).toBe(true);
  });

  it("accepts a light through its own mirror reading", () => {
    const light = equipment(["state"], [{ alias: "state", category: "light_state" }]);
    expect(isTimedCommandEligible(light, "state")).toBe(true);
  });

  it("refuses a blind relay, which nothing could disarm early", () => {
    const relay = equipment(["state"], [{ alias: "power", category: "power" }]);
    expect(isTimedCommandEligible(relay, "state")).toBe(false);
  });

  it("refuses an order the equipment does not carry", () => {
    const gate = equipment(["command"], [{ alias: "state", category: "gate_state" }]);
    expect(isTimedCommandEligible(gate, "open")).toBe(false);
  });

  it("falls back to the configured alias, and answers false with nothing to judge", () => {
    const gate = {
      ...equipment(["command"], [{ alias: "state", category: "gate_state" }]),
      timedCommand: { alias: "command" },
    };
    expect(isTimedCommandEligible(gate)).toBe(true);
    expect(isTimedCommandEligible(equipment(["command"], []))).toBe(false);
  });

  it("does not count a sensor reading as the state of an actuator", () => {
    const heater = equipment(["state"], [{ alias: "temperature", category: "temperature" }]);
    expect(isTimedCommandEligible(heater, "state")).toBe(false);
  });
});

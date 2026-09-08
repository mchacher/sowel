import { describe, it, expect } from "vitest";
import {
  hasTimedCommandCandidate,
  isTimedCommandEligible,
  nextStep,
  resolveStep,
  validateDurationSteps,
} from "./timed-command.js";

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

describe("hasTimedCommandCandidate", () => {
  it("is what a surface asks before any configuration exists", () => {
    // isTimedCommandEligible answers about ONE named order and would say no on
    // an equipment nobody has configured yet, which is every equipment at first.
    const gate = equipment(["command"], [{ alias: "state", category: "gate_state" }]);
    expect(isTimedCommandEligible(gate)).toBe(false);
    expect(hasTimedCommandCandidate(gate)).toBe(true);
  });

  it("is false when no order on the equipment could be armed", () => {
    expect(hasTimedCommandCandidate(equipment(["state"], [{ category: "power" }]))).toBe(false);
    expect(hasTimedCommandCandidate(equipment([], [{ category: "gate_state" }]))).toBe(false);
  });
});

// ============================================================
// Spec 178 — the ladder
// ============================================================

const MIN = 10_000;
const MAX = 24 * 3_600_000;
const LADDER = [15 * 60_000, 30 * 60_000, 60 * 60_000];

describe("validateDurationSteps", () => {
  it("accepts a plain increasing ladder", () => {
    expect(validateDurationSteps(LADDER, MIN, MAX)).toEqual([]);
  });

  it("refuses a ladder of one, which would give the deadline up instantly", () => {
    // The foot-gun this rule exists for: one rung means the SECOND press walks
    // off the top, so a gate would stop counting on a press meant to extend it.
    expect(validateDurationSteps([15 * 60_000], MIN, MAX)[0]).toMatch(/between 2 and 6/);
  });

  it("refuses more rungs than anybody can aim at", () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map((n) => n * 60_000);
    expect(validateDurationSteps(seven, MIN, MAX)[0]).toMatch(/between 2 and 6/);
  });

  it("refuses a rung that does not grow", () => {
    expect(validateDurationSteps([60_000, 60_000], MIN, MAX)[0]).toMatch(/longer than step 1/);
    expect(validateDurationSteps([120_000, 60_000], MIN, MAX)[0]).toMatch(/longer than step 1/);
  });

  it("refuses a rung outside the window bounds, naming it", () => {
    expect(validateDurationSteps([1_000, 60_000], MIN, MAX)[0]).toMatch(/Step 1/);
    expect(validateDurationSteps([60_000, 48 * 3_600_000], MIN, MAX)[0]).toMatch(/Step 2/);
    expect(validateDurationSteps([60_000, Number.NaN], MIN, MAX)[0]).toMatch(/Step 2/);
  });
});

describe("resolveStep", () => {
  it("trusts the stored rung while it still describes the same length", () => {
    expect(resolveStep(LADDER, 1, 30 * 60_000)).toBe(1);
  });

  it("re-places a window when the ladder was edited under it", () => {
    // FR-6. The stored index still exists but now means something else, so
    // trusting it would make the next press jump to a rung nobody asked for.
    const edited = [10 * 60_000, 20 * 60_000, 40 * 60_000];
    expect(resolveStep(edited, 1, 30 * 60_000)).toBe(2); // nearest rung not shorter
  });

  it("lands past the end when the window is longer than every rung", () => {
    expect(resolveStep(LADDER, 0, 120 * 60_000)).toBe(LADDER.length);
  });

  it("survives a nonsense stored index", () => {
    expect(resolveStep(LADDER, -1, 15 * 60_000)).toBe(0);
    expect(resolveStep(LADDER, 99, 15 * 60_000)).toBe(0);
    // An unknown length (a row from before the column existed) falls on rung 1.
    expect(resolveStep(LADDER, 0, 0)).toBe(0);
  });

  it("answers 0 on an empty ladder rather than throwing", () => {
    expect(resolveStep([], 3, 900_000)).toBe(0);
  });
});

describe("nextStep", () => {
  it("gives the next rung's length", () => {
    expect(nextStep(LADDER, 0)).toBe(30 * 60_000);
    expect(nextStep(LADDER, 1)).toBe(60 * 60_000);
  });

  it("gives null on the top rung, which is the way out", () => {
    expect(nextStep(LADDER, 2)).toBeNull();
    expect(nextStep(LADDER, LADDER.length)).toBeNull();
  });
});

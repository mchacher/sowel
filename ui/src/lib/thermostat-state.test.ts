import { describe, it, expect } from "vitest";
import { thermostatPowerStateBinding } from "./thermostat-state";
import type { DataBindingWithValue } from "../types";

function binding(alias: string, value: unknown): DataBindingWithValue {
  return { alias, value } as unknown as DataBindingWithValue;
}

describe("thermostatPowerStateBinding", () => {
  it("prefers the powerState alias over a numeric power reading", () => {
    const bindings = [binding("power", 2974), binding("powerState", true)];
    expect(thermostatPowerStateBinding(bindings)?.value).toBe(true);
  });

  it("falls back to a legacy boolean power binding", () => {
    const bindings = [binding("power", false)];
    expect(thermostatPowerStateBinding(bindings)?.alias).toBe("power");
  });

  it("never mistakes a clamp wattage for a run state", () => {
    // The PAC regression: `power` bound to a submeter clamp made
    // `value === true` read as permanently off (issue #901 follow-up).
    const bindings = [binding("power", 2974)];
    expect(thermostatPowerStateBinding(bindings)).toBeUndefined();
  });

  it("returns undefined when nothing reports a state", () => {
    expect(thermostatPowerStateBinding([binding("temperature", 21)])).toBeUndefined();
  });
});

import type { DataBindingWithValue } from "../types";

/**
 * The data binding that reports a thermostat's boolean on/off state.
 *
 * On a submetered thermostat the `power` alias is the wattage read from a
 * clamp (the metering convention `pickLivePowerW` relies on), so the run
 * state reported by the device itself lives under `powerState`. Legacy
 * thermostats bound before that alias existed still carry the boolean under
 * `power`; the fallback keeps them working, but only when the value really
 * is a boolean — a wattage compared to `true` reads as permanently off,
 * which is exactly the bug this helper removes (issue #901 follow-up).
 */
export function thermostatPowerStateBinding(
  bindings: DataBindingWithValue[],
): DataBindingWithValue | undefined {
  const powerState = bindings.find((b) => b.alias === "powerState");
  if (powerState) return powerState;
  const power = bindings.find((b) => b.alias === "power");
  if (power && typeof power.value === "boolean") return power;
  return undefined;
}

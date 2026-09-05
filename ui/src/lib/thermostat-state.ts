import type { DataBindingWithValue } from "../types";
import { POWER_STATE_ALIAS } from "./binding-candidates";

/**
 * The data binding that reports a thermostat's boolean on/off state.
 *
 * On a submetered thermostat the `power` alias is the wattage read from a
 * clamp (the metering convention `pickLivePowerW` relies on), so the run
 * state reported by the device itself lives under `powerState` (spec 176).
 * Legacy thermostats bound before that alias existed still carry the boolean
 * under `power`; the fallback keeps them working, keyed on the DECLARED type
 * so a value-less binding (fresh restart, first poll pending) is still
 * recognized — but never a wattage, which compared to `true` reads as
 * permanently off (issue #901).
 */
export function thermostatPowerStateBinding(
  bindings: DataBindingWithValue[],
): DataBindingWithValue | undefined {
  const powerState = bindings.find((b) => b.alias === POWER_STATE_ALIAS);
  if (powerState) return powerState;
  const power = bindings.find((b) => b.alias === "power");
  if (power && (power.type === "boolean" || typeof power.value === "boolean")) return power;
  return undefined;
}

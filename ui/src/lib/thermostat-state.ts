import type { DataBindingWithValue } from "../types";
import { THERMOSTAT_STATE_ALIAS } from "./binding-candidates";

/**
 * The data binding that reports a thermostat's boolean on/off state.
 *
 * On a submetered thermostat the `power` alias is the wattage read from a
 * clamp (the metering convention `pickLivePowerW` relies on), so the run
 * state reported by the device itself lives under the `state` alias, the
 * same on/off alias every relay-style equipment uses (spec 176). Legacy
 * thermostats bound before that convention still carry the boolean
 * under `power`; the fallback keeps them working, keyed on the DECLARED type
 * so a value-less binding (fresh restart, first poll pending) is still
 * recognized — but never a wattage, which compared to `true` reads as
 * permanently off (issue #901).
 */
export function thermostatPowerStateBinding(
  bindings: DataBindingWithValue[],
): DataBindingWithValue | undefined {
  const state = bindings.find((b) => b.alias === THERMOSTAT_STATE_ALIAS);
  if (state) return state;
  const power = bindings.find((b) => b.alias === "power");
  if (power && (power.type === "boolean" || typeof power.value === "boolean")) return power;
  return undefined;
}

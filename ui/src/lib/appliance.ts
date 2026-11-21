import type { DataBindingWithValue } from "../types";

/**
 * Spec 213 — an appliance's run state, whether a device reports it (SmartThings
 * `running`, `paused`…) or Sowel derives it from a metering plug
 * (`off` / `ready` / `running` / `finished`).
 */
export function applianceState(bindings: readonly DataBindingWithValue[]): string | null {
  const state = bindings.find((b) => b.alias === "state")?.value;
  return typeof state === "string" ? state : null;
}

/**
 * Whether the machine is on. A known state says it; without one, the `power`
 * binding does: a boolean switch reading, or watts from a plug (1 W and up: a
 * plug reads 0 W on a machine switched off, ~6 W on its idle display).
 */
export function applianceIsOn(bindings: readonly DataBindingWithValue[]): boolean {
  const state = applianceState(bindings);
  if (state !== null) return state !== "off";
  const power = bindings.find((b) => b.alias === "power")?.value;
  if (typeof power === "boolean") return power;
  if (typeof power === "number") return power >= 1;
  return false;
}

/** The i18n key of a run state Sowel knows, or `null` to show the raw value. */
export function applianceStateLabelKey(state: string): string | null {
  switch (state) {
    case "running":
      return "common.running";
    case "paused":
      return "common.paused";
    case "ready":
      return "appliance.state.ready";
    case "finished":
      return "appliance.state.finished";
    case "off":
      return "controls.off";
    default:
      return null;
  }
}

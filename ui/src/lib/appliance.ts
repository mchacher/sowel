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
 * Whether the machine is on. The power says it when there is one: a boolean
 * switch reading, or watts from a plug (1 W and up: a plug reads 0 W on a
 * machine switched off, ~6 W on its idle display, never 0 W inside a cycle).
 * Only without a power does the state decide. Power first, because a reported
 * state can sit on a resting value while the machine is off (SmartThings keeps
 * `ready` on a washer switched off).
 */
export function applianceIsOn(bindings: readonly DataBindingWithValue[]): boolean {
  const power = bindings.find((b) => b.alias === "power")?.value;
  if (typeof power === "boolean") return power;
  if (typeof power === "number") return power >= 1;
  const state = applianceState(bindings);
  return state !== null && state !== "off";
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

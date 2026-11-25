import { isHeaterRunning, type HeaterState, type PilotWireMode } from "../../lib/heater-contract";

/** i18n key of a heater mode; null is an unknown one. */
export function heaterModeKey(mode: PilotWireMode | null): string {
  return `controls.heater.${mode ?? "unknown"}`;
}

/** Warm for the comforts, primary for the reduced modes, neutral when off or unknown. */
export function heaterModeTint(state: HeaterState): string {
  if (isHeaterRunning(state)) return "bg-heat/10 text-heat";
  if (state.mode === "off" || state.mode === null) return "bg-border-light text-text-secondary";
  return "bg-primary/10 text-primary";
}

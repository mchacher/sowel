import type { SharedAccessGateInput, SharedAccessGateSummary, SharedAccessState } from "../../types";

/**
 * R2.5 — a gate whose command offers a CHOICE opens with « open » unless told
 * otherwise. One value or none (an impulse gate, e.g. `["pulse"]`) stores no
 * value: a press sends what the gate's own button sends.
 */
export function defaultGateValue(gate: SharedAccessGateSummary | undefined): string | null {
  if (!gate || gate.commandValues.length <= 1) return null;
  return gate.commandValues.includes("open") ? "open" : gate.commandValues[0];
}

/** The plugin's display name, or its id when it is no longer installed. */
export function pluginName(state: SharedAccessState, id: string | null | undefined): string {
  if (!id) return "";
  return state.plugins.find((p) => p.id === id)?.name ?? id;
}

/**
 * The gates as sent: a `value` only where the command offers a choice. A gate
 * with one value or none (`["pulse"]`) sends none, whatever an older line held.
 */
export function gatesBody(
  gates: { equipmentId: string; value: string | null }[],
  byId: Map<string, SharedAccessGateSummary>,
): SharedAccessGateInput[] {
  return gates.map((g) => {
    const choice = (byId.get(g.equipmentId)?.commandValues.length ?? 0) > 1;
    return choice && g.value !== null ? { equipmentId: g.equipmentId, value: g.value } : { equipmentId: g.equipmentId };
  });
}

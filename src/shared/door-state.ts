// ============================================================
// Spec 190 — what state is a door in?
// ============================================================
//
// One rule for every place that asks: the zone aggregator counting open doors,
// and the tile, card, zone row and sheet drawing the pill and the picto. Two
// implementations would come to disagree about a door that says FAULT.
//
// The door's own end-state word wins (a LoRa coop door reports OPEN, CLOSED,
// OPENING, CLOSING, FAULT from its limit switches). Without a word it knows, the
// position decides. Without either, the state is unknown.

export type DoorState = "open" | "closed" | "moving" | "fault" | "unknown";

/** The binding fields the rule reads, shared by the backend and the UI shapes. */
export interface DoorStateBinding {
  alias: string;
  category: string;
  value: unknown;
}

const WORDS: Record<string, DoorState> = {
  OPEN: "open",
  CLOSED: "closed",
  OPENING: "moving",
  CLOSING: "moving",
  FAULT: "fault",
};

export function doorState(bindings: readonly DoorStateBinding[]): DoorState {
  const word = bindings.find((b) => b.alias === "state" && typeof b.value === "string");
  if (word) {
    const known = WORDS[(word.value as string).trim().toUpperCase()];
    if (known) return known;
  }
  const position = bindings.find(
    (b) =>
      (b.category === "shutter_position" || b.alias === "position") && typeof b.value === "number",
  );
  if (position) return (position.value as number) > 0 ? "open" : "closed";
  return "unknown";
}

/**
 * Whether a door counts as open in a zone: anything not proven closed. A door
 * moving or in fault is not shut; an unknown one is not claimed open either.
 */
export function isDoorOpenForCount(state: DoorState): boolean {
  return state === "open" || state === "moving" || state === "fault";
}

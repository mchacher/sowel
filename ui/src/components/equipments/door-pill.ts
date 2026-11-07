import type { EquipmentWithDetails } from "../../types";
import { doorState, type DoorState } from "../../../../src/shared/door-state";

// Spec 190 FR4 — the pill a door's own end-state word draws. The word (OPEN /
// CLOSED / OPENING / …) says more than the position, so it wins when the door
// rule knows it; otherwise the caller falls back to the position, as a shutter.
const DOOR_STATE_PILL: Record<Exclude<DoorState, "unknown">, DoorPill> = {
  // Open is a position, not a success: neutral, the word says it (spec 196).
  open: { key: "controls.doorOpen", className: "text-text-secondary bg-border-light" },
  closed: { key: "controls.doorClosed", className: "text-shutter-500 bg-shutter-50" },
  moving: { key: "controls.doorMoving", className: "text-text-secondary bg-border-light" },
  fault: { key: "controls.doorFault", className: "text-error bg-error/10" },
};

export interface DoorPill {
  /** i18n key of the label. */
  key: string;
  /** Text and background colour classes. */
  className: string;
}

/** The word pill of a door, or null when it is not a door or says nothing known. */
export function doorWordPill(equipment: EquipmentWithDetails): DoorPill | null {
  if (equipment.type !== "door") return null;
  const word = doorState(equipment.dataBindings.filter((db) => db.alias === "state"));
  return word === "unknown" ? null : DOOR_STATE_PILL[word];
}

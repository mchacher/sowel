// ============================================================
// Spec 190 — which types may the edit form offer?
// ============================================================
//
// Shutter, awning and door bind the same way (`shutter_move`, `set_shutter_position`,
// `shutter_position`): only their nature differs. Moving an equipment between them
// keeps every binding valid, so it keeps its id, history, recipes and widgets. The
// edit form offers that move and no other; for every other type the selector stays
// locked, as before. The API is not narrowed: specs 081 and 183 change a type
// through it on purpose.

import type { EquipmentType } from "./types.js";

export const COVER_FAMILY_TYPES: readonly EquipmentType[] = ["shutter", "awning", "door"];

/** The types an existing equipment may be switched to from its edit form. */
export function typesOfferedOnEdit(current: EquipmentType): readonly EquipmentType[] {
  return COVER_FAMILY_TYPES.includes(current) ? COVER_FAMILY_TYPES : [current];
}

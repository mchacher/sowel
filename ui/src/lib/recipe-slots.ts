import type { EquipmentType, RecipeSlotDef } from "../types";

/**
 * Whether a recipe-form slot should be hidden (not rendered) given the current
 * param values (spec 126). A slot declares `hiddenWhen: { slot, equals }`; it is
 * hidden when the referenced sibling slot's effective value (its current param,
 * or its `defaultValue` when untouched) is one of `equals`. Hidden slots are
 * removed from the layout so the remaining fields stay cleanly aligned.
 */
export function isSlotHidden(
  slot: RecipeSlotDef,
  params: Record<string, unknown>,
  allSlots: readonly RecipeSlotDef[],
): boolean {
  const rule = slot.hiddenWhen;
  if (!rule) return false;
  const ref = allSlots.find((s) => s.id === rule.slot);
  const value = params[rule.slot] ?? ref?.defaultValue;
  const expected = Array.isArray(rule.equals) ? rule.equals : [rule.equals];
  return expected.includes(value as string);
}

/** Whether an equipment type satisfies a slot's `equipmentType` constraint. */
export function matchesEquipmentType(
  eqType: string,
  constraint: EquipmentType | EquipmentType[],
): boolean {
  const types = Array.isArray(constraint) ? constraint : [constraint];
  return types.some((t) => t === eqType);
}

/** The little an equipment picker needs to know about an equipment. */
export interface EquipmentCandidate {
  id: string;
  type: string;
  zoneId: string;
}

/**
 * The equipments a zone/equipment picker may offer once a zone is picked: those
 * sitting in that zone, satisfying the slot's type constraint when it has one,
 * and not already taken by the slot.
 *
 * No zone picked means no candidates — the caller's second dropdown is empty and
 * disabled, so an empty `zoneId` is a legitimate state rather than "any zone".
 *
 * The pickers used to inline this predicate, once to decide which zones are
 * worth listing and once to fill the equipment dropdown, each closing over a
 * freshly-built `matchesConstraint` that no dependency array could track. Naming
 * it makes both call sites the same expression and lets the memos depend on
 * plain values.
 */
export function equipmentCandidates<T extends EquipmentCandidate>(
  equipments: readonly T[],
  zoneId: string,
  options: {
    constraint?: EquipmentType | EquipmentType[];
    /** Equipments already selected elsewhere in the slot. */
    excludeIds?: readonly string[];
  } = {},
): T[] {
  if (!zoneId) return [];
  const excluded = options.excludeIds?.length ? new Set(options.excludeIds) : null;
  return equipments.filter((eq) => {
    if (eq.zoneId !== zoneId) return false;
    if (excluded?.has(eq.id)) return false;
    if (options.constraint && !matchesEquipmentType(eq.type, options.constraint)) return false;
    return true;
  });
}

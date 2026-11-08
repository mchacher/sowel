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

/**
 * The equipments an instance acts on, as far as its row can tell (#1165): the
 * ones bound to the recipe's first `equipment` slot, in the order the user
 * picked them, resolved to names. Ids no longer in the store (a deleted
 * equipment) are skipped. A recipe without an equipment slot, or with that
 * slot empty, gives an empty list.
 *
 * A list slot is stored as an array; a single slot as a string. A legacy list
 * kept as a comma-joined string is split, since an id never holds a comma.
 */
export function instanceEquipmentNames(
  slots: readonly RecipeSlotDef[],
  params: Record<string, unknown>,
  equipments: readonly { id: string; name: string }[],
): string[] {
  const slot = slots.find((s) => s.type === "equipment");
  if (!slot) return [];
  const raw = params[slot.id];
  const ids = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const byId = new Map(equipments.map((e) => [e.id, e.name]));
  return ids.flatMap((id) => {
    const name = byId.get(id.trim());
    return name ? [name] : [];
  });
}

/**
 * A short list for a narrow line: the first `shown` names, and how many more
 * there are. Rendered « A, B +2 »; the count is kept apart so the caller can
 * truncate the names and never the count.
 */
export function shortNameList(names: readonly string[], shown = 2): { text: string; more: number } {
  return { text: names.slice(0, shown).join(", "), more: Math.max(0, names.length - shown) };
}

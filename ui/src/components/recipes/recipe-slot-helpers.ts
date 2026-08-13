import type { RecipeSlotDef } from "../../types";

/** A chunk is either a single ungrouped slot or a group of slots sharing the same group key. */
export interface SlotChunk {
  group: string | null;
  slots: RecipeSlotDef[];
}

/** Group consecutive slots by their `group` field. Ungrouped slots become individual chunks. */
export function groupSlots(slots: RecipeSlotDef[]): SlotChunk[] {
  const chunks: SlotChunk[] = [];
  for (const slot of slots) {
    const group = slot.group ?? null;
    const last = chunks[chunks.length - 1];
    if (last && last.group === group && group !== null) {
      last.slots.push(slot);
    } else {
      chunks.push({ group, slots: [slot] });
    }
  }
  return chunks;
}

/** Check if a group has meaningful data — the first slot in the group must have a value. */
export function isGroupFilled(group: string, allSlots: RecipeSlotDef[], paramsRecord: Record<string, string>): boolean {
  const firstSlot = allSlots.find((s) => s.group === group);
  if (!firstSlot) return false;
  return (paramsRecord[firstSlot.id] ?? "") !== "";
}

/** Check if a group contains at least one required slot — such groups are always visible. */
export function isGroupRequired(group: string, allSlots: RecipeSlotDef[]): boolean {
  return allSlots.some((s) => s.group === group && s.required);
}

/** Get all unique group keys from slots. */
export function getGroupKeys(slots: RecipeSlotDef[]): string[] {
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.group) seen.add(slot.group);
  }
  return [...seen];
}

/** Parse a duration string ("10m", "30s", "1h") to minutes. Returns NaN if invalid. */
export function durationToMinutes(value: string): number {
  if (!value) return NaN;
  const match = value.match(/^(\d+)\s*(s|m|h)$/);
  if (!match) return NaN;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return num / 60;
    case "m": return num;
    case "h": return num * 60;
    default: return NaN;
  }
}

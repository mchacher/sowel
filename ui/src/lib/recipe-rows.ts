import type { RecipeInstance } from "../types";

/**
 * The recipe rows of a zone (spec 198). Two or more instances of the same
 * recipe read as one group: the recipe name once, then one line per instance.
 * A group sits where its first instance was; everything keeps its order.
 */
export type RecipeBlock =
  | { kind: "single"; instance: RecipeInstance }
  | { kind: "group"; recipeId: string; instances: RecipeInstance[] };

export function groupZoneInstances(instances: readonly RecipeInstance[]): RecipeBlock[] {
  const count = new Map<string, number>();
  for (const inst of instances) count.set(inst.recipeId, (count.get(inst.recipeId) ?? 0) + 1);
  const blocks: RecipeBlock[] = [];
  const groups = new Map<string, Extract<RecipeBlock, { kind: "group" }>>();
  for (const inst of instances) {
    if ((count.get(inst.recipeId) ?? 0) < 2) {
      blocks.push({ kind: "single", instance: inst });
      continue;
    }
    const group = groups.get(inst.recipeId);
    if (group) {
      group.instances.push(inst);
      continue;
    }
    const created = { kind: "group" as const, recipeId: inst.recipeId, instances: [inst] };
    groups.set(inst.recipeId, created);
    blocks.push(created);
  }
  return blocks;
}

/**
 * An instance raises an alarm by publishing `state.alarm = true` (the
 * state-watch convention). A disabled instance raises nothing.
 */
export function isInstanceInAlarm(instance: RecipeInstance): boolean {
  return instance.enabled && instance.state?.alarm === true;
}

/**
 * The second line of a recipe row: what the instance acts on, then what the
 * recipe says about itself (`state.summary`), joined by a comma (never a
 * middle dot). « Poele, Erreur A01 après 1 min ».
 */
export function instanceContextLine(equipment: string, summary: string): string {
  return [equipment.trim(), summary.trim()].filter((s) => s.length > 0).join(", ");
}

/** The recipe's live status line, when it publishes one. */
export function instanceSummary(instance: RecipeInstance): string {
  const summary = instance.state?.summary;
  return typeof summary === "string" ? summary : "";
}

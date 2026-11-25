/**
 * Recipe outputs (spec 214) — the data running recipe instances publish on
 * equipments, held in memory for the EquipmentManager, which shows each one as
 * a virtual binding `virtual:recipe:<instanceId>:<alias>`.
 *
 * Nothing is persisted: an instance's outputs exist from its start to its
 * stop, `null` until its first publish. A recipe that wants its value back
 * after a restart republishes it from its own `ctx.state`.
 */

import type { RecipePublishDef } from "../shared/types.js";

export const RECIPE_OUTPUT_BINDING_PREFIX = "virtual:recipe:";

/**
 * Aliases the core itself derives on some equipment types (a gate's `state`
 * from its contacts, a pool cover's `cover_state`): a recipe may not publish
 * them, or the equipment would carry two values under one alias.
 */
export const CORE_VIRTUAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  gate: ["state"],
  pool_cover: ["cover_state"],
};

export function isCoreVirtualAlias(equipmentType: string, alias: string): boolean {
  return CORE_VIRTUAL_ALIASES[equipmentType]?.includes(alias) ?? false;
}

export function recipeOutputBindingId(instanceId: string, alias: string): string {
  return `${RECIPE_OUTPUT_BINDING_PREFIX}${instanceId}:${alias}`;
}

export interface RecipeOutputTarget {
  equipmentId: string;
  def: RecipePublishDef;
}

export interface RecipeOutput extends RecipeOutputTarget {
  instanceId: string;
  recipeName: string;
  value: unknown;
  lastUpdated: string | null;
  lastChanged: string | null;
}

/**
 * Why a value does not fit its declaration, or `null` when it does. `null` is
 * always accepted: "unknown".
 */
export function checkOutputValue(def: RecipePublishDef, value: unknown): string | null {
  if (value === null) return null;
  switch (def.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "not a finite number";
    case "boolean":
      return typeof value === "boolean" ? null : "not a boolean";
    case "enum":
      return typeof value === "string" && (def.enumValues ?? []).includes(value)
        ? null
        : `not one of ${(def.enumValues ?? []).join(", ")}`;
    case "text":
      return typeof value === "string" ? null : "not a string";
  }
}

/**
 * Why a recipe's `publishes` declaration is refused, or `null` (spec 214 FR1.2).
 * `equipmentSlots` are the ids of the recipe's `equipment` slots.
 */
export function checkPublishDeclaration(
  publishes: readonly RecipePublishDef[],
  equipmentSlots: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>();
  for (const def of publishes) {
    if (!equipmentSlots.has(def.slot)) {
      return `publishes "${def.alias}" on "${def.slot}", which is not an equipment slot`;
    }
    if (typeof def.alias !== "string" || def.alias === "") return "publishes an empty alias";
    if (def.type === "enum" && (!def.enumValues || def.enumValues.length === 0)) {
      return `publishes enum "${def.alias}" without enumValues`;
    }
    const key = `${def.slot}\u0000${def.alias}`;
    if (seen.has(key)) return `publishes "${def.alias}" twice on "${def.slot}"`;
    seen.add(key);
  }
  return null;
}

export class RecipeOutputs {
  /** equipmentId → alias → output. */
  private readonly byEquipment = new Map<string, Map<string, RecipeOutput>>();

  /** Register an instance's outputs, `null` until published. Returns the equipments touched. */
  attach(instanceId: string, recipeName: string, targets: readonly RecipeOutputTarget[]): string[] {
    const touched = new Set<string>();
    for (const { equipmentId, def } of targets) {
      let aliases = this.byEquipment.get(equipmentId);
      if (!aliases) {
        aliases = new Map();
        this.byEquipment.set(equipmentId, aliases);
      }
      aliases.set(def.alias, {
        instanceId,
        recipeName,
        equipmentId,
        def,
        value: null,
        lastUpdated: null,
        lastChanged: null,
      });
      touched.add(equipmentId);
    }
    return [...touched];
  }

  /** Drop every output of an instance. Returns the outputs removed. */
  detach(instanceId: string): RecipeOutput[] {
    const removed: RecipeOutput[] = [];
    for (const [equipmentId, aliases] of this.byEquipment) {
      for (const [alias, output] of aliases) {
        if (output.instanceId === instanceId) {
          aliases.delete(alias);
          removed.push(output);
        }
      }
      if (aliases.size === 0) this.byEquipment.delete(equipmentId);
    }
    return removed;
  }

  forEquipment(equipmentId: string): RecipeOutput[] {
    return [...(this.byEquipment.get(equipmentId)?.values() ?? [])];
  }

  /** The output publishing `alias` on that equipment, whichever instance owns it. */
  get(equipmentId: string, alias: string): RecipeOutput | undefined {
    return this.byEquipment.get(equipmentId)?.get(alias);
  }

  /**
   * Set a value. Refused when that instance does not publish that alias on that
   * equipment, or the value does not fit the declaration.
   */
  set(
    instanceId: string,
    equipmentId: string,
    alias: string,
    value: unknown,
    now: string,
  ): { ok: true; changed: boolean; previous: unknown } | { ok: false; reason: string } {
    const output = this.get(equipmentId, alias);
    if (!output || output.instanceId !== instanceId) {
      return { ok: false, reason: `"${alias}" is not declared for this equipment` };
    }
    const invalid = checkOutputValue(output.def, value);
    if (invalid) return { ok: false, reason: `"${alias}": ${invalid}` };
    const previous = output.value;
    const changed = previous !== value;
    output.value = value;
    output.lastUpdated = now;
    if (changed) output.lastChanged = now;
    return { ok: true, changed, previous };
  }
}

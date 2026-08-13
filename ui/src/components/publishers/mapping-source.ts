import type { EquipmentWithDetails, RecipeInstance } from "../../types";

// Universal "publisher mapping source" concepts (issue #457). Every publisher —
// MQTT, Telegram, Web Push, and any future transport — maps the same source
// space (an equipment / a zone / a recipe instance and one of its keys) onto a
// transport-specific payload. Only the source selection is shared here; the
// payload (a topic value, a message, ...) is owned by each transport.

export type MappingSourceType = "equipment" | "zone" | "recipe";

/** Aggregated keys a zone exposes, shared by every publisher's source picker. */
export const ZONE_AGG_KEYS = [
  "temperature",
  "humidity",
  "luminosity",
  "motion",
  "motionSensors",
  "openDoors",
  "openWindows",
  "waterLeak",
  "smoke",
  "lightsOn",
  "lightsTotal",
  "shuttersOpen",
  "shuttersTotal",
  "averageShutterPosition",
  "awningsDeployed",
  "awningsTotal",
  "isDaylight",
];

export interface MappingSourceContext {
  equipments: EquipmentWithDetails[];
  recipeInstances: RecipeInstance[];
}

/**
 * The keys selectable for a given source, identical across all publishers:
 * - zone: the aggregated ZONE_AGG_KEYS
 * - equipment: its data-binding aliases
 * - recipe: the keys of the running instance's state
 */
export function mappingSourceKeys(
  sourceType: MappingSourceType,
  sourceId: string,
  { equipments, recipeInstances }: MappingSourceContext,
): string[] {
  if (sourceType === "zone") return ZONE_AGG_KEYS;
  if (sourceType === "equipment" && sourceId) {
    const eq = equipments.find((e) => e.id === sourceId);
    if (eq) return eq.dataBindings.map((b) => b.alias);
  }
  if (sourceType === "recipe" && sourceId) {
    const inst = recipeInstances.find((i) => i.id === sourceId);
    if (inst?.state) return Object.keys(inst.state);
  }
  return [];
}
